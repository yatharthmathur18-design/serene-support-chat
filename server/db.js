import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { DB_PATH } from './paths.js';

export const db = new DatabaseSync(DB_PATH);
db.exec(`PRAGMA journal_mode = WAL;`);
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT DEFAULT '',
  password_hash TEXT DEFAULT '',
  provider TEXT DEFAULT 'email',
  google_sub TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  last_login INTEGER
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  emotion TEXT DEFAULT '',
  personality TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_user_time ON messages(user_id, created_at);
`);

// ---- AES-256-GCM at-rest encryption ----
function getKey() {
  const raw = (process.env.DATA_ENCRYPTION_KEY || '').trim();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  if (raw.length >= 16 && !/change-me|dev-only/i.test(raw)) {
    // Platform-generated secrets (e.g. Render) are stretched to a full 256-bit key.
    return crypto.createHash('sha256').update(raw, 'utf8').digest();
  }
  console.warn('[privacy] DATA_ENCRYPTION_KEY missing/invalid — using ephemeral key. Set it in .env for persistent history.');
  return crypto.randomBytes(32);
}
let _key = null;
export function encKey() {
  if (!_key) _key = getKey();
  return _key;
}

export function encryptText(plain) {
  const key = encKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), ciphertext: ct.toString('hex'), auth_tag: cipher.getAuthTag().toString('hex') };
}

export function decryptText({ iv, ciphertext, auth_tag }) {
  const key = encKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(auth_tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'hex')), decipher.final()]).toString('utf8');
}

export const uid = () => crypto.randomUUID();
export const now = () => Date.now();

// ---- Conversations (v2) ----
db.exec(`
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT DEFAULT 'New conversation',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_user_time ON conversations(user_id, updated_at);
`);
try { db.exec(`ALTER TABLE messages ADD COLUMN conversation_id TEXT`); } catch { /* already migrated */ }
// House pre-existing messages into one archive chat per user.
for (const u of db.prepare(`SELECT DISTINCT user_id AS uid FROM messages WHERE conversation_id IS NULL`).all()) {
  const first = db.prepare(`SELECT iv, ciphertext, auth_tag FROM messages WHERE user_id = ? AND conversation_id IS NULL ORDER BY created_at ASC LIMIT 1`).get(u.uid);
  let title = 'Earlier chats';
  try { const t = decryptText(first).slice(0, 42).trim(); if (t) title = t; } catch { /* keep default */ }
  const cid = uid();
  const tnow = now();
  db.prepare(`INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(cid, u.uid, title, tnow, tnow);
  db.prepare(`UPDATE messages SET conversation_id = ? WHERE user_id = ? AND conversation_id IS NULL`).run(cid, u.uid);
}
try { db.exec(`ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0`); } catch { /* already migrated */ }
try { db.exec(`ALTER TABLE users DROP COLUMN google_sub`); } catch { /* kept or already gone */ }
