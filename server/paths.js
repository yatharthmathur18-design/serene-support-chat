// Private filesystem paths: database + logs live in Termux-private home,
// NEVER on shared storage (any app with storage permission could read them).
// Migrates a legacy ./data DB forward once, preserving accounts and chats.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PRIVATE_DIR = path.join(os.homedir(), '.serene');
fs.mkdirSync(PRIVATE_DIR, { recursive: true, mode: 0o700 });

export const DB_PATH = process.env.DB_PATH || path.join(PRIVATE_DIR, 'serene.db');
export const LOG_PATH = path.join(PRIVATE_DIR, 'serene.log');

const legacy = path.join(process.cwd(), 'data', 'serene.db');
if (DB_PATH !== legacy && !fs.existsSync(DB_PATH) && fs.existsSync(legacy)) {
  for (const suffix of ['', '-wal', '-shm']) {
    const src = legacy + suffix;
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, DB_PATH + suffix);
      fs.unlinkSync(src);
    }
  }
  console.log('[privacy] moved database to private storage');
}
