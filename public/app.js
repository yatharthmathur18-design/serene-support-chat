// Serene frontend — privacy-first: chat text only goes to YOUR backend.

const $ = (s) => document.querySelector(s);
let mode = 'login';
let personalities = { auto: { label: 'Auto-Adapt', desc: 'Reads your feelings and gently matches your energy.' } };
let currentConvId = localStorage.getItem('serene-conv') || null;
let convCache = [];

const EMOTION_LABEL = {
  anxious: 'sensing some anxiety — softening my tone',
  sad: 'sensing heaviness — staying close',
  angry: 'sensing frustration — no judgment here',
  tired: 'sensing exhaustion — keeping it gentle',
  shame: 'with extra gentleness',
  hopeful: 'sharing in this lighter moment',
  crisis: 'staying with you closely',
  neutral: 'listening'
};

function localEmotion(t = '') {
  t = ' ' + t.toLowerCase() + ' ';
  const has = (...ws) => ws.some((w) => t.includes(w));
  if (has('kill myself', 'suicide', 'self harm', 'self-harm', 'end my life', 'want to die')) return 'crisis';
  if (has('anxious', 'anxiety', 'panic', 'overwhelm', 'worried', 'stress', 'nervous', 'scared')) return 'anxious';
  if (has('sad', 'lonely', 'alone', 'cry', 'empty', 'depress', 'grief', 'hopeless', 'heartbroken')) return 'sad';
  if (has('angry', 'furious', 'frustrat', 'annoyed', 'hate', 'unfair')) return 'angry';
  if (has('tired', 'exhaust', 'burnout', 'drained', 'insomnia', 'sleep')) return 'tired';
  if (has('ashamed', 'guilty', 'worthless', 'failure', 'useless', 'embarrass')) return 'shame';
  if (has('hopeful', 'grateful', 'thankful', 'proud', 'excited')) return 'hopeful';
  return 'neutral';
}

async function api(path, opts = {}) {
  const r = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

const fmtTime = (ts) =>
  new Date(ts || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/* ---------- palette (light only, persisted) ---------- */
function setPalette(p) {
  if (!['meadow', 'mist', 'oat'].includes(p)) p = 'meadow';
  document.documentElement.dataset.palette = p;
  localStorage.setItem('serene-palette', p);
  document.querySelectorAll('.palette').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.palette === p))
  );
}
document.querySelectorAll('.palette').forEach((b) => (b.onclick = () => setPalette(b.dataset.palette)));
setPalette(localStorage.getItem('serene-palette') || 'meadow');

/* ---------- drawer (mobile) ---------- */
const drawer = $('#drawer'), scrim = $('#scrim');
function openDrawer() {
  drawer.classList.add('open');
  scrim.hidden = false;
  $('#closeDrawer').focus();
}
function closeDrawer() {
  drawer.classList.remove('open');
  scrim.hidden = true;
}
$('#menuBtn').onclick = openDrawer;
$('#closeDrawer').onclick = closeDrawer;
scrim.onclick = closeDrawer;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
});

/* ---------- auth ---------- */
$('#tabLogin').onclick = () => { mode = 'login'; syncTabs(); };
$('#tabRegister').onclick = () => { mode = 'register'; syncTabs(); };
function syncTabs() {
  $('#tabLogin').classList.toggle('active', mode === 'login');
  $('#tabRegister').classList.toggle('active', mode === 'register');
  $('#nameWrap').hidden = mode !== 'register';
  $('#authTitle').textContent = mode === 'register' ? 'Begin somewhere softer' : 'Welcome back';
  $('#emailBtn').textContent = mode === 'register' ? 'Create my private space' : 'Continue with email';
}
$('#emailBtn').onclick = async () => {
  const btn = $('#emailBtn');
  btn.disabled = true;
  $('#authMsg').textContent = 'One moment…';
  try {
    const body = { email: $('#authEmail').value, password: $('#authPass').value, name: $('#authName').value };
    const { user } = await api(mode === 'register' ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST', body
    });
    enterChat(user);
  } catch (e) {
    $('#authMsg').textContent = e.message;
  }
  btn.disabled = false;
};

/* ---------- conversations ---------- */
function persistConv() {
  if (currentConvId) localStorage.setItem('serene-conv', currentConvId);
  else localStorage.removeItem('serene-conv');
}

async function loadConversations() {
  try {
    const { conversations } = await api('/api/chat/conversations');
    convCache = conversations;
  } catch { convCache = []; }
  if (currentConvId && !convCache.some((c) => c.id === currentConvId)) currentConvId = null;
  if (!currentConvId && convCache.length) currentConvId = convCache[0].id;
  persistConv();
  renderConvs();
}

function renderConvs() {
  const list = $('#convList');
  list.innerHTML = '';
  if (!convCache.length) {
    list.innerHTML = '<p class="conv-empty">No chats yet — begin below.</p>';
    return;
  }
  for (const c of convCache) {
    const item = document.createElement('div');
    item.className = 'conv-item' + (c.id === currentConvId ? ' active' : '');
    const open = document.createElement('button');
    open.className = 'conv-open';
    open.title = c.title || 'New conversation';
    const label = document.createElement('span');
    label.className = 't';
    label.textContent = c.title || 'New conversation';
    open.appendChild(label);
    open.onclick = () => switchConv(c.id);
    const del = document.createElement('button');
    del.className = 'x';
    del.textContent = '×';
    del.setAttribute('aria-label', `Delete “${c.title || 'conversation'}”`);
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this conversation and all its messages?')) return;
      await api(`/api/chat/conversations/${c.id}`, { method: 'DELETE' });
      if (currentConvId === c.id) currentConvId = null;
      await loadConversations();
      await openCurrent(true);
    };
    item.append(open, del);
    list.appendChild(item);
  }
}

async function openCurrent(showStarter = true) {
  $('#messages').innerHTML = '';
  if (!currentConvId) {
    if (showStarter) pushBot('A fresh, quiet page — just for us. What’s on your heart today?');
    return false;
  }
  try {
    const { messages } = await api(`/api/chat/history?conversationId=${encodeURIComponent(currentConvId)}`);
    for (const m of messages.slice(-30)) bubble(m.content, m.role === 'assistant' ? 'bot' : 'user', '', m.created_at);
    if (!messages.length && showStarter) pushBot('A fresh, quiet page — just for us. What’s on your heart today?');
    return messages.length > 0;
  } catch {
    return false;
  }
}

async function switchConv(id) {
  currentConvId = id;
  persistConv();
  renderConvs();
  await openCurrent();
  if (window.innerWidth < 920) closeDrawer();
  $('#input').focus();
}

async function newChat() {
  currentConvId = null;
  persistConv();
  renderConvs();
  await openCurrent();
  if (window.innerWidth < 920) closeDrawer();
  $('#input').focus();
}
$('#newChatBtn').onclick = newChat;

/* ---------- chat ---------- */
function greetingFor(user) {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const name = user.name || user.email.split('@')[0];
  return `${part}, ${name}.`;
}

async function enterChat(user) {
  $('#authView').classList.add('hidden');
  $('#chatView').classList.remove('hidden');
  $('#meName').textContent = user.name || user.email.split('@')[0];
  $('#meEmail').textContent = user.email;
  const first = (user.name || 'friend').trim().split(/\s+/)[0];
  $('#avatar').textContent = (first[0] || 'S').toUpperCase();
  $('#greet').textContent = greetingFor(user);
  await loadPersonalities();
  await loadConversations();
  const hadConvs = convCache.length > 0;
  const hasHistory = await openCurrent(false);
  if (!hadConvs) {
    pushBot(
      `Welcome in. I'm Serene — I listen first, and I don't rush.\n\nWhatever's on your heart today, share it at your own pace. What's been sitting with you?`,
      'neutral',
      Date.now()
    );
  } else if (!hasHistory) {
    pushBot('A fresh, quiet page — just for us. What’s on your heart today?');
  }
}

async function loadPersonalities() {
  try {
    personalities = await api('/api/personalities');
  } catch { /* keep default */ }
  const saved = localStorage.getItem('serene-persona') || 'auto';
  const list = $('#personaList');
  list.innerHTML = '';
  for (const [key, p] of Object.entries(personalities)) {
    const label = document.createElement('label');
    label.className = 'persona';
    const short = p.label.replace(/\s*[^\w\s].*$/, '');
    label.innerHTML = `<input type="radio" name="persona" value="${key}"><span class="p-card"><b>${short}</b><small>${p.desc}</small></span>`;
    const input = label.querySelector('input');
    input.checked = key === saved;
    input.onchange = () => {
      localStorage.setItem('serene-persona', key);
      $('#adaptPill').textContent =
        key === 'auto' ? 'Auto-adapt is listening…' : `${short} is with you — steady and warm.`;
      if (window.innerWidth < 920) closeDrawer();
    };
    list.appendChild(label);
  }
}

function selectedPersona() {
  return document.querySelector('input[name="persona"]:checked')?.value || 'auto';
}

function bubble(text, who, emotion = '', ts) {
  const row = document.createElement('div');
  row.className = `msg-row ${who}`;
  const b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = text;
  const t = document.createElement('div');
  t.className = 'time';
  t.textContent = who === 'bot' && emotion && emotion !== 'neutral'
    ? `${EMOTION_LABEL[emotion] || 'listening'} · ${fmtTime(ts)}`
    : fmtTime(ts);
  row.append(b, t);
  $('#messages').appendChild(row);
  $('#messages').scrollTop = $('#messages').scrollHeight;
}
const pushUser = (t, ts) => bubble(t, 'user', '', ts || Date.now());
const pushBot = (t, emo, ts) => bubble(t, 'bot', emo || '', ts || Date.now());

function upsertConv(conv) {
  if (!conv) return;
  currentConvId = conv.id;
  persistConv();
  const i = convCache.findIndex((c) => c.id === conv.id);
  if (i >= 0) convCache[i] = conv;
  else convCache.unshift(conv);
  convCache.sort((a, b) => b.updated_at - a.updated_at);
  renderConvs();
}

$('#composer').onsubmit = async (e) => {
  e.preventDefault();
  const ta = $('#input');
  const text = ta.value.trim();
  if (!text) return;
  ta.value = '';
  ta.style.height = 'auto';
  // remove the unsaved starter note once real words arrive
  if (!currentConvId && !$('#messages').querySelector('.msg-row.user')) $('#messages').innerHTML = '';
  pushUser(text);
  const emo = localEmotion(text);
  $('#adaptPill').textContent =
    selectedPersona() === 'auto' && emo !== 'neutral'
      ? `Auto-adapt: ${EMOTION_LABEL[emo]}.`
      : 'Serene is listening…';
  $('#typing').classList.remove('hidden');
  try {
    const { reply, emotion, offline, conversation } = await api('/api/chat', {
      method: 'POST',
      body: { message: text, personality: selectedPersona(), conversationId: currentConvId }
    });
    $('#typing').classList.add('hidden');
    $('#offlineBadge').classList.toggle('hidden', !offline);
    upsertConv(conversation);
    pushBot(reply, emotion);
  } catch (err) {
    $('#typing').classList.add('hidden');
    pushBot(`I'm still here — but that message couldn't go through (${err.message}). Take a breath, and try again when you're ready.`);
  }
};
$('#input').addEventListener('input', (e) => {
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(132, e.target.scrollHeight) + 'px';
});
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('#composer').requestSubmit();
  }
});
document.querySelectorAll('.quick button').forEach(
  (b) => (b.onclick = () => {
    $('#input').value = b.dataset.q;
    $('#composer').requestSubmit();
    $('#input').focus();
  })
);

/* ---------- keyboard-aware composer (mobile) ---------- */
(function keyboardAware() {
  const vv = window.visualViewport;
  const msgs = () => $('#messages');
  function sync() {
    if (!vv) return;
    // gap between layout viewport and visible area = keyboard height
    const overlap = Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0));
    document.documentElement.style.setProperty('--kb', Math.round(overlap) + 'px');
  }
  if (vv) {
    vv.addEventListener('resize', () => { sync(); msgs().scrollTop = msgs().scrollHeight; });
    vv.addEventListener('scroll', sync);
    sync();
  }
  $('#input').addEventListener('focus', () => {
    // after the keyboard finishes opening, lift + reveal latest message
    setTimeout(() => { sync(); msgs().scrollTop = msgs().scrollHeight; }, 350);
  });
})();

/* ---------- data controls ---------- */
$('#wipeBtn').onclick = async () => {
  if (!confirm('Erase all your conversations? Your account stays. This cannot be undone.')) return;
  await api('/api/chat/history', { method: 'DELETE' });
  currentConvId = null;
  convCache = [];
  persistConv();
  renderConvs();
  $('#messages').innerHTML = '';
  pushBot('All clear — a fresh, quiet page. Whatever you share next stays only between us.');
  if (window.innerWidth < 920) closeDrawer();
};
$('#logoutBtn').onclick = async () => {
  await api('/api/auth/logout', { method: 'POST' });
  location.reload();
};
$('#delAccountBtn').onclick = async () => {
  if (!confirm('Delete your account and every word? This is permanent.')) return;
  if (!confirm('Take a breath — really erase everything?')) return;
  const pw = prompt('Last step — enter your password to confirm it’s you:');
  if (pw === null) return;
  try {
    await api('/api/auth/account', { method: 'DELETE', body: { password: pw } });
    location.reload();
  } catch (e) { alert(e.message); }
};

/* ---------- boot ---------- */
(async () => {
  syncTabs();
  try {
    const { user } = await api('/api/auth/me');
    enterChat(user);
  } catch {
    $('#authView').classList.remove('hidden');
  }
})();
