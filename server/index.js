import { app } from './app.js';
const PORT = process.env.PORT || 8787;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🤲 Serene running → http://localhost:${PORT}`);
  console.log(`   AI backend → ${process.env.OPENCODE_BASE_URL || 'http://127.0.0.1:4096/v1'}`);
  console.log(`   Model → ${process.env.OPENCODE_MODEL || 'openai/gpt-oss-20b'}`);
  console.log(`   Storage → local only (browser), no DB`);
});
