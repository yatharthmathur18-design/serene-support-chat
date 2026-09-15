import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db, uid, now } from './db.js';

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.SECURE_COOKIES === 'true',
  sameSite: 'strict',
  path: '/',
  maxAge: 12 * 3600 * 1000
};

const fails = new Map();

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, v: user.token_version || 0 },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );
}

export async function authMiddleware(req, res, next) {
  const token = req.cookies?.serene_token;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET);
    const user = await db.prepare('SELECT id, email, name, provider, token_version, created_at FROM users WHERE id = ?').get(p.sub);
    if (!user || (p.v || 0) !== (user.token_version || 0)) {
      return res.status(401).json({ error: 'Session expired — please sign in again' });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired — please sign in again' });
  }
}

async function loginFail(res, email) {
  const f = fails.get(email) || { count: 0, first: Date.now() };
  f.count += 1;
  fails.set(email, f);
  if (f.count > 10 && Date.now() - f.first < 15 * 60 * 1000) {
    return res.status(429).json({ error: 'Too many attempts — wait a bit and try again.' });
  }
  await new Promise((r) => setTimeout(r, Math.min(300 * f.count, 3000)));
  return res.status(401).json({ error: 'Email or password didn’t match — take a breath and try again.' });
}

export function authRoutes(app) {
  app.post('/api/auth/register', async (req, res) => {
    const { email = '', password = '', name = '' } = req.body || {};
    const cleanEmail = String(email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) return res.status(400).json({ error: 'Please enter a valid email.' });
    if (String(password).length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ error: 'Use at least 8 characters with a letter and a number.' });
    }
    const exists = await db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (exists) return res.status(409).json({ error: 'That email is already registered — try signing in.' });
    const hash = await bcrypt.hash(String(password), 12);
    const user = { id: uid(), email: cleanEmail, name: String(name).slice(0, 60), password_hash: hash, provider: 'email', token_version: 0, created_at: now() };
    await db.prepare('INSERT INTO users (id, email, name, password_hash, provider, token_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.id, user.email, user.name, user.password_hash, 'email', 0, user.created_at);
    const token = signToken(user);
    res.cookie('serene_token', token, COOKIE_OPTS);
    res.json({ user: { id: user.id, email: user.email, name: user.name } });
  });

  app.post('/api/auth/login', async (req, res) => {
    const { email = '', password = '' } = req.body || {};
    const cleanEmail = String(email).trim().toLowerCase();
    const row = await db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    if (!row || !row.password_hash) return loginFail(res, cleanEmail);
    const ok = await bcrypt.compare(String(password), row.password_hash);
    if (!ok) return loginFail(res, cleanEmail);
    fails.delete(cleanEmail);
    await db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(now(), row.id);
    const token = signToken(row);
    res.cookie('serene_token', token, COOKIE_OPTS);
    res.json({ user: { id: row.id, email: row.email, name: row.name } });
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      const token = req.cookies?.serene_token;
      if (token) {
        const p = jwt.verify(token, process.env.JWT_SECRET);
        await db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(p.sub);
      }
    } catch { /* already invalid — just clear */ }
    res.clearCookie('serene_token', { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', authMiddleware, (req, res) => res.json({ user: req.user }));

  app.delete('/api/auth/account', authMiddleware, async (req, res) => {
    const { password = '' } = req.body || {};
    const row = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!row?.password_hash || !(await bcrypt.compare(String(password), row.password_hash))) {
      return res.status(401).json({ error: 'Please enter your password to confirm.' });
    }
    await db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    res.clearCookie('serene_token', { path: '/' });
    res.json({ ok: true });
  });
}
