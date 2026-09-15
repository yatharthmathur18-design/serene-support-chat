import './env.js'; // private secrets first, local .env second + auto-migration
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { authRoutes, authMiddleware } from './auth.js';
import { db } from './db.js';
import { saveMessage, getHistory, purgeOld, PERSONALITIES, createConversation, getConversation, listConversations, touchConversation, deleteConversation } from './chat.js';
import { completeWithOpenCode } from './opencode.js';

const app = express();
const PORT = process.env.PORT || 8787;

// ---------- Highest-level security headers ----------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com']
    }
  },
  hsts: true,
  referrerPolicy: { policy: 'no-referrer' }
}));
app.use(express.json({ limit: '32kb' })); // small body = less abuse surface
app.use(cookieParser());
app.use(cors({ origin: (process.env.CLIENT_ORIGIN || 'http://localhost:8787').split(','), credentials: true }));
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render terminates TLS at its proxy; keeps rate limits per-user

// ---------- Rate limits (brute-force + spam protection) ----------
app.use('/api/auth/', rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false }));
app.use('/api/chat', rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }));
// Backstop for every other /api route (status, personalities, …).
app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false }));
// Per-IP concurrency guard: one slow AI reply must not let a client stack up many.
const inFlight = new Map();
app.use('/api/chat', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const n = (inFlight.get(req.ip) || 0) + 1;
  if (n > 3) return res.status(429).json({ error: 'Slow down — one reply at a time, like a real conversation.' });
  inFlight.set(req.ip, n);
  res.on('finish', () => inFlight.set(req.ip, Math.max(0, (inFlight.get(req.ip) || 1) - 1)));
  next();
});

authRoutes(app);

app.get('/api/personalities', (req, res) => res.json(PERSONALITIES));

// ---------- Chat (login required = private per-user history) ----------
// ---------- Conversations (many chats per user) ----------
app.get('/api/chat/conversations', authMiddleware, (req, res) => {
  res.json({ conversations: listConversations(req.user.id) });
});

app.post('/api/chat/conversations', authMiddleware, (req, res) => {
  const { title = '' } = req.body || {};
  res.json({ conversation: createConversation(req.user.id, title || 'New conversation') });
});

app.patch('/api/chat/conversations/:id', authMiddleware, (req, res) => {
  const conv = getConversation(req.user.id, req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
  const { title = '' } = req.body || {};
  touchConversation(conv.id, String(title).slice(0, 80) || conv.title);
  res.json({ conversation: getConversation(req.user.id, conv.id) });
});

app.delete('/api/chat/conversations/:id', authMiddleware, (req, res) => {
  deleteConversation(req.user.id, req.params.id);
  res.json({ ok: true });
});

app.get('/api/chat/history', authMiddleware, (req, res) => {
  const cid = String(req.query.conversationId || '') || null;
  res.json({ messages: getHistory(req.user.id, 50, cid) });
});

app.post('/api/chat', authMiddleware, async (req, res) => {
  const { message = '', personality = 'auto', conversationId = '' } = req.body || {};
  const text = String(message).slice(0, 2000).trim();
  if (!text) return res.status(400).json({ error: 'Please write a little something first.' });
  if (!PERSONALITIES[personality]) return res.status(400).json({ error: 'Unknown personality.' });

  let conv = String(conversationId) ? getConversation(req.user.id, String(conversationId)) : null;
  if (!conv) conv = createConversation(req.user.id);

  const history = getHistory(req.user.id, 30, conv.id);
  const { text: reply, emotion, offline } = await completeWithOpenCode({ history, userText: text, personality });

  // Encrypted at rest (AES-256-GCM). Plaintext never logged.
  saveMessage(req.user.id, 'user', text, emotion, personality, conv.id);
  saveMessage(req.user.id, 'assistant', reply, emotion, personality, conv.id);
  // Auto-title from the first message so the list reads naturally.
  if (conv.title === 'New conversation') touchConversation(conv.id, text.slice(0, 42));
  else touchConversation(conv.id);
  res.json({ reply, emotion, personality, offline, conversation: getConversation(req.user.id, conv.id) });
});

app.delete('/api/chat/history', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM messages WHERE user_id = ?').run(req.user.id);
  db.prepare('DELETE FROM conversations WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});


app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Which AI backend is configured, and is it reachable? (login required)
app.get('/api/ai/status', authMiddleware, async (req, res) => {
  const base = (process.env.OPENCODE_BASE_URL || 'http://127.0.0.1:4096/v1').replace(/\/$/, '');
  const out = { base, model: process.env.OPENCODE_MODEL || 'openai/gpt-oss-20b', reachable: false, error: '' }; 
  try {
    const r = await fetch(`${base}/models`, {
      headers: process.env.OPENCODE_API_KEY ? { Authorization: `Bearer ${process.env.OPENCODE_API_KEY}` } : {},
      signal: AbortSignal.timeout(10000)
    });
    out.reachable = r.ok;
    if (!r.ok) out.error = `HTTP ${r.status}`;
  } catch (e) { out.error = e.message; }
  res.json(out);
});

// ---------- Static frontend ----------
const pub = path.join(process.cwd(), 'public');
app.use(express.static(pub));
app.get('*', (req, res) => res.sendFile(path.join(pub, 'index.html')));

// ---------- Retention janitor (privacy: auto-delete old messages) ----------
const days = Number(process.env.RETENTION_DAYS || 30);
setInterval(() => purgeOld(days), 24 * 3600 * 1000);
purgeOld(days);

// Fail closed: never boot on placeholder or missing signing/encryption secrets.
{
  const jwt = (process.env.JWT_SECRET || '').trim();
  if (!jwt || jwt.length < 32 || /change-me|dev-only-secret/i.test(jwt)) {
    console.error('[security] JWT_SECRET missing, short, or placeholder — refusing to start. See .env.example.');
    process.exit(1);
  }
  const dk = (process.env.DATA_ENCRYPTION_KEY || '').trim();
  const dkOk = /^[0-9a-fA-F]{64}$/.test(dk) || (dk.length >= 16 && !/change-me|dev-only-secret/i.test(dk));
  if (!dkOk) {
    console.error('[security] DATA_ENCRYPTION_KEY missing or placeholder — refusing to start. See .env.example.');
    process.exit(1);
  }
}

// Localhost by default; hosts like Render need HOST=0.0.0.0 (their proxy guards the edge).
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`\n🤲 Serene running → http://localhost:${PORT}`);
  console.log(`   AI backend → ${process.env.OPENCODE_BASE_URL || 'http://127.0.0.1:4096/v1'}`);
  console.log(`   Model → ${process.env.OPENCODE_MODEL || 'openai/gpt-oss-20b'}`);
});
