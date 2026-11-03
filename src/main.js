import './style.css';
import { personas } from './personas.js';
import { streamChat, MODEL } from './gemini.js';
import { renderMarkdown } from './markdown.js';
import { createQuiz } from './quiz.js';

const $ = (id) => document.getElementById(id);
const els = {
  jobs: $('jobs'),
  chatView: $('chat-view'),
  quizView: $('quiz-view'),
  toBottom: $('to-bottom'),
  modes: document.querySelectorAll('.mode'),
  messages: $('messages'),
  suggestions: $('suggestions'),
  composer: $('composer'),
  input: $('input'),
  send: $('send'),
  clear: $('clear-btn'),
  keyBtn: $('key-btn'),
  modal: $('key-modal'),
  keyForm: $('key-form'),
  keyInput: $('key-input'),
  keyRemember: $('key-remember'),
  keyError: $('key-error'),
  keyCancel: $('key-cancel'),
};

const KEY_STORE = 'gemini_api_key';
const safe = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};
const loadKey = () => safe(() => sessionStorage.getItem(KEY_STORE) || localStorage.getItem(KEY_STORE) || '', '');
const saveKey = (key, remember) =>
  safe(() => {
    sessionStorage.removeItem(KEY_STORE);
    localStorage.removeItem(KEY_STORE);
    (remember ? localStorage : sessionStorage).setItem(KEY_STORE, key);
  });

let apiKey = loadKey();
let activeId = personas[0].id;
let mode = 'chat';

// Per-persona conversation state, so each role keeps its own chat.
const state = Object.fromEntries(
  personas.map((p) => [p.id, { messages: [{ role: 'bot', text: p.greeting, greeting: true }], busy: false, controller: null }]),
);
const active = () => personas.find((p) => p.id === activeId);

/* ---------- theme & tabs ---------- */
function applyTheme(p) {
  const r = document.documentElement.style;
  r.setProperty('--accent', p.theme.accent);
  r.setProperty('--accent-2', p.theme.accent2);
  r.setProperty('--bg-1', p.theme.bg1);
  r.setProperty('--bg-2', p.theme.bg2);
  document.documentElement.dataset.persona = p.id;
}

function renderJobs() {
  els.jobs.innerHTML = '';
  personas.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'job' + (p.id === activeId ? ' active' : '');
    b.setAttribute('aria-pressed', String(p.id === activeId));
    b.innerHTML = `<span class="job-label">${p.label}</span>`;
    b.addEventListener('click', () => selectPersona(p.id));
    els.jobs.appendChild(b);
  });
}

function selectPersona(id) {
  if (id === activeId) return;
  activeId = id;
  applyTheme(active());
  renderJobs();
  renderChat();
  quiz.render();
  window.scrollTo({ top: mode === 'chat' ? document.documentElement.scrollHeight : 0 });
  if (mode === 'chat') els.input.focus();
}

/* ---------- mode (chat / quiz) ---------- */
function setMode(next) {
  mode = next;
  els.chatView.hidden = mode !== 'chat';
  els.quizView.hidden = mode !== 'quiz';
  els.clear.hidden = mode !== 'chat';
  els.modes.forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  if (mode === 'quiz') quiz.render();
  window.scrollTo({ top: mode === 'chat' ? document.documentElement.scrollHeight : 0 });
  updateFab();
}
els.modes.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

/* ---------- page scroll helpers ---------- */
const distFromBottom = () => document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
function updateFab() {
  els.toBottom.hidden = !(mode === 'chat' && distFromBottom() > 320);
}
window.addEventListener('scroll', updateFab, { passive: true });
window.addEventListener('resize', updateFab);
els.toBottom.addEventListener('click', () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }));

/* ---------- chat rendering ---------- */
function bubbleEl(m) {
  const row = document.createElement('div');
  row.className = `row ${m.role}`;
  const b = document.createElement('div');
  b.className = `bubble ${m.error ? 'error' : ''}`;
  if (m.role === 'user') b.textContent = m.text;
  else if (m.pending && !m.text) b.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  else b.innerHTML = renderMarkdown(m.text);
  row.appendChild(b);
  return { row, b };
}

function renderChat({ scroll = true } = {}) {
  const s = state[activeId];
  els.messages.innerHTML = '';
  s.messages.forEach((m) => {
    const { row, b } = bubbleEl(m);
    m.el = b;
    els.messages.appendChild(row);
  });
  if (scroll && mode === 'chat') scrollDown();
  renderSuggestions();
  els.send.disabled = s.busy;
}

function renderSuggestions() {
  const s = state[activeId];
  els.suggestions.innerHTML = '';
  if (s.messages.length > 1) return; // only before the first user message
  active().suggestions.forEach((q) => {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'chip';
    c.textContent = q;
    c.addEventListener('click', () => send(q));
    els.suggestions.appendChild(c);
  });
}

const scrollDown = () => {
  window.scrollTo({ top: document.documentElement.scrollHeight });
};

/* ---------- sending ---------- */
async function send(text) {
  text = text.trim();
  const persona = active();
  const s = state[persona.id];
  if (!text || s.busy) return;
  if (!apiKey) return openKeyModal(false);

  s.messages.push({ role: 'user', text });
  const reply = { role: 'bot', text: '', pending: true };
  s.messages.push(reply);
  s.busy = true;
  s.controller = new AbortController();
  els.input.value = '';
  autosize();
  renderChat();

  // History for the model: skip the canned greeting, errors and the pending reply.
  const history = s.messages
    .filter((m) => !m.greeting && !m.error && m !== reply)
    .map((m) => ({ role: m.role, text: m.text }));

  const paint = () => {
    if (activeId !== persona.id || !reply.el) return;
    const stick = distFromBottom() < 140;
    reply.el.innerHTML = reply.text ? renderMarkdown(reply.text) : '<span class="typing"><i></i><i></i><i></i></span>';
    if (stick) scrollDown();
  };

  try {
    await streamChat({
      apiKey,
      system: persona.system,
      history,
      signal: s.controller.signal,
      onChunk: (t) => {
        reply.text += t;
        paint();
      },
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      if (!reply.text) s.messages.splice(s.messages.indexOf(reply), 1);
    } else {
      // Drop the failed turn's reply; show an error bubble (not sent to the model later).
      const i = s.messages.indexOf(reply);
      const msg = reply.text ? `${reply.text}\n\n_(interrupted: ${err.message})_` : `⚠️ ${err.message}`;
      s.messages[i] = { role: 'bot', text: msg, error: !reply.text };
      if (/api key|rejected|permission/i.test(err.message)) openKeyModal(true, err.message);
    }
  } finally {
    reply.pending = false;
    s.busy = false;
    s.controller = null;
    if (activeId === persona.id) {
      const y = window.scrollY;
      const follow = distFromBottom() < 140;
      renderChat({ scroll: follow });
      if (!follow) window.scrollTo({ top: y });
    }
  }
}

/* ---------- composer ---------- */
function autosize() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 160) + 'px';
}
els.input.addEventListener('input', autosize);
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send(els.input.value);
  }
});
els.composer.addEventListener('submit', (e) => {
  e.preventDefault();
  send(els.input.value);
});

els.clear.addEventListener('click', () => {
  const s = state[activeId];
  s.controller?.abort();
  s.messages = [{ role: 'bot', text: active().greeting, greeting: true }];
  s.busy = false;
  renderChat();
});

/* ---------- API key modal ---------- */
function openKeyModal(cancellable, errorMsg) {
  els.keyInput.value = '';
  els.keyError.hidden = !errorMsg;
  els.keyError.textContent = errorMsg || '';
  els.keyCancel.hidden = !cancellable;
  els.modal.hidden = false;
  els.keyInput.focus();
}
els.keyBtn.addEventListener('click', () => openKeyModal(true));
els.keyCancel.addEventListener('click', () => (els.modal.hidden = true));
els.keyForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const key = els.keyInput.value.trim();
  if (!key) return;
  apiKey = key;
  saveKey(key, els.keyRemember.checked);
  els.modal.hidden = true;
  els.input.focus();
});

/* ---------- quiz ---------- */
const quiz = createQuiz({
  root: els.quizView,
  personas,
  getPersona: active,
  getApiKey: () => apiKey,
  onNeedKey: (cancellable, msg) => openKeyModal(cancellable, msg),
  onDiscuss: (text) => {
    setMode('chat');
    send(text);
  },
});

/* ---------- init ---------- */
applyTheme(active());
renderJobs();
renderChat();
setMode('chat');
document.title = `AI Interview Agent`;
els.input.title = `Model: ${MODEL}`;
if (!apiKey) openKeyModal(false);
