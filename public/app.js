// Serene — local login (like bemineai) + local storage, no DB.

const $ = (s) => document.querySelector(s);
let personalities = { auto: { label: 'Auto-Adapt', desc: 'Reads your feelings and gently matches your energy.' } };

const LS_KEY = 'serene:convs';
const LS_CURRENT = 'serene:current';
const LS_USER = 'serene:user';
let convs = [];
let currentId = null;
let mode = 'login';

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
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
const fmtTime = (ts) => new Date(ts || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function loadStore() {
  try { convs = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { convs = []; }
  currentId = localStorage.getItem(LS_CURRENT) || null;
  if (currentId && !convs.some(c => c.id === currentId)) currentId = convs[0]?.id || null;
}
function saveStore() {
  localStorage.setItem(LS_KEY, JSON.stringify(convs));
  if (currentId) localStorage.setItem(LS_CURRENT, currentId);
  else localStorage.removeItem(LS_CURRENT);
}
function getCurrent() { return convs.find(c => c.id === currentId) || null; }
function newId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function getUser() { try { return JSON.parse(localStorage.getItem(LS_USER) || 'null'); } catch { return null; } }

/* palette */
function setPalette(p) {
  if (!['meadow', 'mist', 'oat'].includes(p)) p = 'meadow';
  document.documentElement.dataset.palette = p;
  localStorage.setItem('serene-palette', p);
  document.querySelectorAll('.palette').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.palette === p)));
}
document.querySelectorAll('.palette').forEach((b) => (b.onclick = () => setPalette(b.dataset.palette)));
setPalette(localStorage.getItem('serene-palette') || 'meadow');

/* drawer */
const drawer = $('#drawer'), scrim = $('#scrim');
function openDrawer() { drawer.classList.add('open'); scrim.hidden = false; $('#closeDrawer').focus(); }
function closeDrawer() { drawer.classList.remove('open'); scrim.hidden = true; }
$('#menuBtn').onclick = openDrawer;
$('#closeDrawer').onclick = closeDrawer;
scrim.onclick = closeDrawer;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer(); });

/* auth — local, bemineai-style */
function syncTabs() {
  $('#tabLogin').classList.toggle('active', mode === 'login');
  $('#tabRegister').classList.toggle('active', mode === 'register');
  $('#nameWrap').hidden = mode !== 'register';
  $('#authTitle').textContent = mode === 'register' ? 'Create your space' : 'Welcome back';
  $('#emailBtn').textContent = mode === 'register' ? 'Create & enter' : 'Sign in';
}
$('#tabLogin').onclick = () => { mode = 'login'; syncTabs(); };
$('#tabRegister').onclick = () => { mode = 'register'; syncTabs(); };

function showAuth() {
  $('#authView').classList.remove('hidden');
  $('#chatView').classList.add('hidden');
  syncTabs();
}
function showChat(user) {
  $('#authView').classList.add('hidden');
  $('#chatView').classList.remove('hidden');
  const name = user.name || user.email.split('@')[0];
  $('#meName').textContent = name;
  $('#meEmail').textContent = user.email;
  $('#avatar').textContent = (name[0] || 'S').toUpperCase();
  const h = new Date().getHours();
  $('#greet').textContent = (h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') + `, ${name} — take a breath…`;
}

$('#emailBtn').onclick = () => {
  const email = $('#authEmail').value.trim().toLowerCase();
  const pass = $('#authPass').value;
  const name = $('#authName').value.trim();
  $('#authMsg').textContent = '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('#authMsg').textContent = 'Please enter a valid email.'; return; }
  if (pass.length < 8) { $('#authMsg').textContent = 'Password needs at least 8 characters.'; return; }
  if (mode === 'register' && !name) { $('#authMsg').textContent = 'Please enter what we should call you.'; return; }

  const existing = getUser();
  if (mode === 'login') {
    if (!existing || existing.email !== email) { $('#authMsg').textContent = 'No account with that email on this device — try Create account.'; return; }
    if (existing.password !== pass) { $('#authMsg').textContent = 'Wrong password — take a breath and try again.'; return; }
    enterChat(existing);
  } else {
    if (existing && existing.email === email) { $('#authMsg').textContent = 'That email already exists on this device — try Sign in.'; return; }
    const user = { email, password: pass, name: name || email.split('@')[0] };
    localStorage.setItem(LS_USER, JSON.stringify(user));
    enterChat(user);
  }
};

function enterChat(user) {
  showChat(user);
  loadStore();
  loadPersonalities().then(() => {
    renderConvs();
    renderMessages();
  });
}

/* conversations */
function renderConvs() {
  const list = $('#convList');
  list.innerHTML = '';
  if (!convs.length) { list.innerHTML = '<p class="conv-empty">No chats yet — begin below.</p>'; return; }
  for (const c of convs) {
    const item = document.createElement('div');
    item.className = 'conv-item' + (c.id === currentId ? ' active' : '');
    const open = document.createElement('button');
    open.className = 'conv-open';
    open.title = c.title || 'New conversation';
    const label = document.createElement('span');
    label.className = 't';
    label.textContent = c.title || 'New conversation';
    open.appendChild(label);
    open.onclick = () => { currentId = c.id; saveStore(); renderConvs(); renderMessages(); if (innerWidth < 920) closeDrawer(); $('#input').focus(); };
    const del = document.createElement('button');
    del.className = 'x';
    del.textContent = '×';
    del.setAttribute('aria-label', `Delete “${c.title || 'conversation'}”`);
    del.onclick = (e) => {
      e.stopPropagation();
      if (!confirm('Delete this conversation?')) return;
      convs = convs.filter(x => x.id !== c.id);
      if (currentId === c.id) currentId = convs[0]?.id || null;
      saveStore(); renderConvs(); renderMessages();
    };
    item.append(open, del);
    list.appendChild(item);
  }
}
function renderMessages() {
  $('#messages').innerHTML = '';
  const cur = getCurrent();
  if (!cur || !cur.messages.length) {
    pushBot('Welcome in. I\'m Serene — I listen first, and I don\'t rush.\n\nWhatever\'s on your heart today, share it at your own pace. What\'s been sitting with you?', 'neutral', Date.now(), true);
    return;
  }
  for (const m of cur.messages.slice(-50)) bubble(m.content, m.role === 'assistant' ? 'bot' : 'user', m.emotion || '', m.created_at);
}
function ensureCurrent() {
  if (!getCurrent()) {
    const c = { id: newId(), title: 'New conversation', messages: [], created_at: Date.now(), updated_at: Date.now() };
    convs.unshift(c);
    currentId = c.id;
    saveStore();
    renderConvs();
  }
}
$('#newChatBtn').onclick = () => {
  const c = { id: newId(), title: 'New conversation', messages: [], created_at: Date.now(), updated_at: Date.now() };
  convs.unshift(c);
  currentId = c.id;
  saveStore(); renderConvs(); renderMessages();
  if (innerWidth < 920) closeDrawer();
  $('#input').focus();
};

/* personalities */
async function loadPersonalities() {
  try { personalities = await api('/api/personalities'); } catch {}
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
      $('#adaptPill').textContent = key === 'auto' ? 'Auto-adapt is listening…' : `${short} is with you — steady and warm.`;
      if (innerWidth < 920) closeDrawer();
    };
    list.appendChild(label);
  }
}
function selectedPersona() { return document.querySelector('input[name="persona"]:checked')?.value || 'auto'; }

/* bubbles */
function bubble(text, who, emotion = '', ts) {
  const row = document.createElement('div');
  row.className = `msg-row ${who}`;
  const b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = text;
  const t = document.createElement('div');
  t.className = 'time';
  t.textContent = who === 'bot' && emotion && emotion !== 'neutral' ? `${EMOTION_LABEL[emotion] || 'listening'} · ${fmtTime(ts)}` : fmtTime(ts);
  row.append(b, t);
  $('#messages').appendChild(row);
  $('#messages').scrollTop = $('#messages').scrollHeight;
}
function pushBot(t, emo, ts, isWelcome) {
  if (isWelcome && $('#messages').querySelector('.msg-row')) return;
  bubble(t, 'bot', emo || '', ts || Date.now());
}
const pushUser = (t, ts) => bubble(t, 'user', '', ts || Date.now());

/* composer */
$('#composer').onsubmit = async (e) => {
  e.preventDefault();
  const ta = $('#input');
  const text = ta.value.trim();
  if (!text) return;
  ta.value = ''; ta.style.height = 'auto';
  ensureCurrent();
  const cur = getCurrent();
  if (cur.messages.length === 0) $('#messages').innerHTML = '';
  const userMsg = { role: 'user', content: text, created_at: Date.now() };
  cur.messages.push(userMsg);
  if (cur.title === 'New conversation') cur.title = text.slice(0, 42);
  cur.updated_at = Date.now();
  saveStore(); renderConvs();
  pushUser(text);
  const emo = localEmotion(text);
  $('#adaptPill').textContent = selectedPersona() === 'auto' && emo !== 'neutral' ? `Auto-adapt: ${EMOTION_LABEL[emo]}.` : 'Serene is listening…';
  $('#typing').classList.remove('hidden');
  try {
    const history = cur.messages.slice(-20).map(m => ({ role: m.role, content: m.content }));
    history.pop();
    const { reply, emotion, offline } = await api('/api/chat', {
      method: 'POST',
      body: { message: text, personality: selectedPersona(), history }
    });
    $('#typing').classList.add('hidden');
    $('#offlineBadge').classList.toggle('hidden', !offline);
    cur.messages.push({ role: 'assistant', content: reply, emotion, created_at: Date.now() });
    cur.updated_at = Date.now();
    saveStore(); renderConvs();
    bubble(reply, 'bot', emotion);
  } catch (err) {
    $('#typing').classList.add('hidden');
    bubble(`I'm still here — but that message couldn't go through (${err.message}). Take a breath, and try again when you're ready.`, 'bot');
  }
};
$('#input').addEventListener('input', (e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(132, e.target.scrollHeight) + 'px'; });
$('#input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); } });
document.querySelectorAll('.quick button').forEach((b) => (b.onclick = () => { $('#input').value = b.dataset.q; $('#composer').requestSubmit(); $('#input').focus(); }));

/* keyboard-aware */
(function keyboardAware() {
  const vv = window.visualViewport;
  const msgs = () => $('#messages');
  function sync() {
    if (!vv) return;
    const overlap = Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0));
    document.documentElement.style.setProperty('--kb', Math.round(overlap) + 'px');
  }
  if (vv) { vv.addEventListener('resize', () => { sync(); msgs().scrollTop = msgs().scrollHeight; }); vv.addEventListener('scroll', sync); sync(); }
  $('#input').addEventListener('focus', () => { setTimeout(() => { sync(); msgs().scrollTop = msgs().scrollHeight; }, 350); });
})();

/* data */
$('#wipeBtn').onclick = () => {
  if (!confirm('Erase all conversations on this device? This cannot be undone.')) return;
  convs = []; currentId = null; saveStore(); renderConvs(); renderMessages();
  if (innerWidth < 920) closeDrawer();
};
$('#logoutBtn').onclick = () => {
  if (!confirm('Sign out? Your chats stay on this device, you can sign back in with the same email.')) return;
  localStorage.removeItem(LS_USER);
  location.reload();
};

/* boot */
{
  loadStore();
  const user = getUser();
  if (user) enterChat(user);
  else showAuth();
}
