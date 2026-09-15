// OpenCode API client — talks to `opencode serve` (OpenAI-compatible /v1).
// Start it with:  opencode auth login  →  opencode serve --port 4096
// If unreachable and OFFLINE_MODE!=false, falls back to a local comforting responder
// so the app (auth + UI + privacy) keeps working as a demo.

import { buildSystemPrompt, detectEmotion, crisisResources } from './chat.js';

const BASE = (process.env.OPENCODE_BASE_URL || 'http://127.0.0.1:4096/v1').replace(/\/$/, '');
const MODEL = process.env.OPENCODE_MODEL || 'openai/gpt-oss-20b';

export async function completeWithOpenCode({ history = [], userText = '', personality = 'auto' }) {
  const emotion = detectEmotion(userText);
  const system = buildSystemPrompt({ personality, emotion });

  const messages = [
    { role: 'system', content: system },
    ...history.slice(-14).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    { role: 'user', content: userText }
  ];

  if (process.env.OFFLINE_MODE === 'true') return { text: offlineReply(userText, emotion), emotion, offline: true };

  // Retry on transient congestion (429/503 are common on free NIM capacity).
  let lastErr = new Error('unknown');
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.OPENCODE_API_KEY ? { Authorization: `Bearer ${process.env.OPENCODE_API_KEY}` } : {})
        },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.8, max_tokens: 450, stream: false })
      }).finally(() => clearTimeout(t));

      if (res.status === 429 || res.status === 503) {
        lastErr = new Error(`backend busy ${res.status}: ${await res.text().catch(() => '')}`);
        await new Promise((r) => setTimeout(r, attempt * 2000));
        continue;
      }
      if (!res.ok) throw new Error(`backend ${res.status}: ${await res.text().catch(() => '')}`);
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error('empty completion');
      if (emotion === 'crisis') return { text: `${text}\n\n---\n${crisisResources()}`, emotion, offline: false };
      return { text, emotion, offline: false };
    } catch (err) {
      lastErr = err;
      const retryable = /backend busy|fetch failed|aborted|ECONN|ETIMEDOUT|ENOTFOUND/i.test(err.message || '');
      if (!retryable || attempt >= 2) break;
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  // Log status only — backend error bodies can echo user content into logs.
  console.warn('[ai] backend unreachable after retries, using offline comforting mode:', String(lastErr.message || lastErr).slice(0, 160));
  const text = offlineReply(userText, emotion);
  return { text: emotion === 'crisis' ? `${text}\n\n---\n${crisisResources()}` : text, emotion, offline: true };
}

function offlineReply(userText, emotion) {
  const t = (userText || '').slice(0, 120);
  const openers = {
    anxious: `It makes complete sense to feel on edge about this — your mind is trying to protect you, even if it's exhausting right now.`,
    sad: `Thank you for trusting me with this. It sounds like you've been carrying something heavy and lonely.`,
    angry: `That sounds genuinely frustrating — of course it got under your skin. Your reaction makes sense.`,
    tired: `You sound so tired, and it makes sense — you've been pushing through a lot.`,
    shame: `Thank you for saying that out loud. That took courage, and you deserve kindness here — not judgment.`,
    hopeful: `I can feel a little lightness in what you shared — I'm really glad for that.`,
    crisis: `I'm really glad you told me. You matter, and this pain deserves care and human support with you right now.`,
    neutral: `Thank you for sharing that with me — I'm here, listening.`
  };
  const closers = [
    '',
    '',
    '',
    `We can go slowly, one breath at a time.`,
    `Would it help to try a grounding breath together?`,
    `No rush at all — I'm right here.`
  ];
  const middles = [
    `From what you shared — "${t}${userText.length > 120 ? '…' : ''}" — there's clearly more beneath the surface. What's the heaviest part?`,
    `I hear you. If you had to name the hardest piece of this, what would it be?`,
    `That took honesty to say out loud. Want to unpack it a little, or just sit with it for now?`,
    `Got it. No need to explain perfectly — just tell me whatever comes first.`
  ];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const opener = openers[emotion] || openers.neutral;
  const chosenCloser = pick(closers);
  const tail = chosenCloser ? `\n\n${chosenCloser}` : '';
  return `${opener}\n\n${pick(middles)}${tail}\n\n_(Offline mode — live AI reconnects when the backend responds.)_`;
}
