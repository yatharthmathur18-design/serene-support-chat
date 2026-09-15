import './env.js';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { PERSONALITIES } from './chat.js';
import { completeWithOpenCode } from './opencode.js';

export const app = express();

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
app.use(express.json({ limit: '32kb' }));
app.use(cors({ origin: (process.env.CLIENT_ORIGIN || 'http://localhost:8787').split(','), credentials: true }));
app.disable('x-powered-by');

app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false }));

app.get('/api/personalities', (req, res) => res.json(PERSONALITIES));

app.post('/api/chat', async (req, res) => {
  const { message = '', personality = 'auto', history = [] } = req.body || {};
  const text = String(message).slice(0, 2000).trim();
  if (!text) return res.status(400).json({ error: 'Please write a little something first.' });
  if (!PERSONALITIES[personality]) return res.status(400).json({ error: 'Unknown personality.' });
  const safeHistory = Array.isArray(history) ? history.slice(-20).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 2000)
  })) : [];
  const { text: reply, emotion, offline } = await completeWithOpenCode({ history: safeHistory, userText: text, personality });
  res.json({ reply, emotion, personality, offline });
});

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/api/ai/status', async (req, res) => {
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

const pub = path.join(process.cwd(), 'public');
if (!process.env.NETLIFY) {
  app.use(express.static(pub));
  app.get('*', (req, res) => res.sendFile(path.join(pub, 'index.html')));
}

export default app;
