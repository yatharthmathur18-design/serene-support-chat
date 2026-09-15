# Serene — Private, Comforting AI Support Companion 🤲

Calm pastel UI · Encrypted private chats · Adaptive personality & tone ·
Simple email login · Powered by your **OpenCode API** (`opencode serve`).

## ✨ What you get

- **Highest-level privacy**: bcrypt passwords, httpOnly sessions, AES-256-GCM encrypted messages, Helmet CSP/HSTS, rate-limits, no trackers, auto-delete + one-tap wipe & export.
- **Many conversations**: start fresh chats anytime, hop between them, delete individually — each with its own private context.
- **Honest privacy**: chats are encrypted at rest and never logged — but message text *is* sent to your configured AI backend (NVIDIA NIM) to generate replies.
- **Humanized active listening**: reflects → validates → asks ONE gentle question. Never robotic, never diagnosing.
- **Adaptive personality & tone**: `Auto-Adapt 🌊` senses anxious / sad / angry / tired / ashamed / hopeful / crisis and softens language automatically — plus 5 selectable companions (Calm, Warm Friend, Gentle Coach, Mindful Guide, Steady Listener).
- **Simple working auth**: email + password on a local SQLite DB — zero setup, works instantly.
- **OpenCode powered**: backend proxies to your `opencode serve` OpenAI-compatible `/v1/chat/completions`. Offline comforting mode keeps the demo alive when opencode is down.

## 🚀 Run (3 steps)

```bash
cd serene-support-chat
cp .env.example .env
# edit .env: set JWT_SECRET + DATA_ENCRYPTION_KEY (npm run gen-key) and OPENCODE_MODEL
npm install
npm start
# → http://localhost:8787
```

### 1. OpenCode API (the AI brain)

```bash
opencode auth login
opencode serve --port 4096
```

| `.env` key | Default | Meaning |
|---|---|---|
| `OPENCODE_BASE_URL` | `http://127.0.0.1:4096/v1` | Your opencode server |
| `OPENCODE_MODEL` | `openai/gpt-oss-20b` | Exact NIM model ID (see `GET /models`) |
| `OPENCODE_API_KEY` | _(empty)_ | Only if your server needs it |
| `OFFLINE_MODE` | `false` | `true` forces built-in comforting replies |

Check health: `curl localhost:8787/api/health`
Check AI backend (after signing in): sign in, then open `http://localhost:8787/api/ai/status` — `reachable: true` means live AI.

### 2. Email login — works immediately ✅
No setup. Register on the welcome screen → SQLite DB at `data/serene.db` (auto-created). Passwords = bcrypt(12), sessions = signed JWT in `Secure, HttpOnly, SameSite=Strict` cookie.


## 🔒 Privacy design

- At-rest encryption: every message AES-256-GCM (`DATA_ENCRYPTION_KEY`).
- Never logged: message plaintext is never `console.log`ged.
- Retention janitor: `RETENTION_DAYS` auto-purges (default 30, `0` = off).
- User controls: export JSON, delete chats, delete account (cascades).
- Prod checklist: `SECURE_COOKIES=true` + HTTPS, strong `JWT_SECRET`, `CLIENT_ORIGIN=https://yourdomain`.

## 🎭 Personalities & tone files

Logic lives in `server/chat.js`: `detectEmotion()` + `buildSystemPrompt()` + `PERSONALITIES`. Frontend mirrors instant feedback in `public/app.js` (`localEmotion()` → adapt pill). Tune words there — no retraining needed.

## 🧘 Calm theme

CSS variables in `public/styles.css` — dawn / sage / dusk dots. Serif `Fraunces` + breathing orb animation, rounded bubbles, soft gradients.

## 📁 Structure

```
serene-support-chat/
  server/index.js      # express + helmet + static
  server/db.js         # sqlite + AES-256-GCM
  server/auth.js       # email + password + JWT cookies
  server/chat.js       # emotion, personalities, prompts, history
  server/opencode.js   # OpenCode /v1/chat/completions client + offline fallback
  public/              # calm UI
```

Be kind to yourself — and to your users. 🕊️
