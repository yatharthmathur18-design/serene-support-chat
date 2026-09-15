import { app } from './app.js';

const PORT = process.env.PORT || 8787;

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

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🤲 Serene running → http://localhost:${PORT}`);
  console.log(`   AI backend → ${process.env.OPENCODE_BASE_URL || 'http://127.0.0.1:4096/v1'}`);
  console.log(`   Model → ${process.env.OPENCODE_MODEL || 'openai/gpt-oss-20b'}`);
});
