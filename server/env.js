// Private env bootstrap: secrets live in Termux-private home (~/.serene),
// NEVER on shared storage. The sdcard .env keeps only non-secret config.
// Load order: private first (wins), local second (fills gaps, never overrides).
import dotenv from 'dotenv';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PRIVATE_DIR = path.join(os.homedir(), '.serene');
fs.mkdirSync(PRIVATE_DIR, { recursive: true, mode: 0o700 });
const PRIVATE_ENV = path.join(PRIVATE_DIR, 'secrets.env');
const LOCAL_ENV = path.join(process.cwd(), '.env');

const SECRET_KEYS = ['JWT_SECRET', 'DATA_ENCRYPTION_KEY', 'OPENCODE_API_KEY'];

function parseEnvFile(p) {
  const out = {};
  try {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('=');
      out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch { /* file may not exist yet */ }
  return out;
}

const isRealSecret = (v) => Boolean(v) && !/change-me|dev-only-secret/i.test(v);

// 1–2. Load private first, local second (dotenv never overrides existing vars).
dotenv.config({ path: PRIVATE_ENV });
dotenv.config({ path: LOCAL_ENV });

// 3. One-time migration: rescue real secrets out of shared storage.
const local = parseEnvFile(LOCAL_ENV);
const priv = parseEnvFile(PRIVATE_ENV);
const toMove = SECRET_KEYS.filter((k) => isRealSecret(local[k]) && !isRealSecret(priv[k]));
if (toMove.length) {
  fs.appendFileSync(
    PRIVATE_ENV,
    toMove.map((k) => `${k}=${local[k]}`).join('\n') + '\n',
    { mode: 0o600 }
  );
  try { fs.chmodSync(PRIVATE_ENV, 0o600); } catch { /* best effort */ }
  const blanked = fs.readFileSync(LOCAL_ENV, 'utf8')
    .split('\n')
    .map((line) => {
      const t = line.trim();
      for (const k of toMove) {
        if (t === `${k}=${local[k]}` || t.startsWith(`${k}=`)) return `${k}=`;
      }
      return line;
    })
    .join('\n');
  fs.writeFileSync(LOCAL_ENV, blanked);
  for (const k of toMove) process.env[k] = local[k]; // keep runtime consistent
  console.log(`[privacy] moved ${toMove.join(', ')} to private storage`);
}
