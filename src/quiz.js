import { generateJson } from './gemini.js';
import { renderMarkdown } from './markdown.js';

const LETTERS = ['A', 'B', 'C', 'D'];
const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const COUNTS = [5, 10];

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          question: { type: 'STRING' },
          options: { type: 'ARRAY', items: { type: 'STRING' } },
          answerIndex: { type: 'INTEGER' },
          explanation: { type: 'STRING' },
        },
        required: ['question', 'options', 'answerIndex', 'explanation'],
      },
    },
  },
  required: ['questions'],
};

// Small DOM helper — text goes in as text nodes, so nothing the model returns is parsed as HTML.
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  kids.flat().forEach((k) => k != null && k !== false && n.append(k));
  return n;
};
const md = (text, cls = '') => {
  const d = el('div', { class: `md ${cls}` });
  d.innerHTML = renderMarkdown(text); // renderMarkdown escapes before formatting
  return d;
};

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalise(raw) {
  const out = [];
  for (const q of raw?.questions || []) {
    if (typeof q?.question !== 'string' || !Array.isArray(q.options) || typeof q.explanation !== 'string') continue;
    const opts = q.options.map(String).slice(0, 4);
    if (opts.length < 2 || !Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex >= opts.length) continue;
    // Shuffle so the correct answer isn't biased toward one position.
    const tagged = shuffle(opts.map((text, i) => ({ text, correct: i === q.answerIndex })));
    out.push({
      question: q.question,
      options: tagged.map((o) => o.text),
      answer: tagged.findIndex((o) => o.correct),
      explanation: q.explanation,
    });
  }
  return out;
}

const freshState = (persona) => ({
  phase: 'setup', // setup | loading | active | results
  config: { topic: persona.quizTopics[0], difficulty: 'Medium', count: 5 },
  questions: [],
  index: 0,
  picked: null,
  answers: [],
  error: '',
  controller: null,
});

/**
 * Quiz mode. Each persona has its own quiz state, so switching roles never loses progress.
 * ctx: { root, getPersona(), personas, getApiKey(), onNeedKey(cancellable, msg), onDiscuss(text) }
 */
export function createQuiz(ctx) {
  const states = Object.fromEntries(ctx.personas.map((p) => [p.id, freshState(p)]));
  const st = () => states[ctx.getPersona().id];

  function chips(label, items, current, onPick) {
    return el(
      'div',
      { class: 'field' },
      el('div', { class: 'field-label' }, label),
      el(
        'div',
        { class: 'chips', role: 'radiogroup', 'aria-label': label },
        items.map((it) =>
          el(
            'button',
            {
              type: 'button',
              role: 'radio',
              'aria-checked': String(it === current),
              class: 'chip' + (it === current ? ' sel' : ''),
              onclick: () => onPick(it),
            },
            String(it),
          ),
        ),
      ),
    );
  }

  function viewSetup(s, p) {
    return el(
      'div',
      { class: 'quiz-card' },
      el('h2', {}, `${p.short} quiz`),
      el('p', { class: 'muted' }, 'Multiple-choice questions generated for this role, with instant feedback and explanations.'),
      chips('Topic', p.quizTopics, s.config.topic, (v) => ((s.config.topic = v), render())),
      chips('Difficulty', DIFFICULTIES, s.config.difficulty, (v) => ((s.config.difficulty = v), render())),
      chips('Questions', COUNTS, s.config.count, (v) => ((s.config.count = v), render())),
      s.error && el('p', { class: 'error-text', role: 'alert' }, `⚠️ ${s.error}`),
      el('div', { class: 'quiz-actions' }, el('button', { type: 'button', class: 'send', onclick: start }, 'Start quiz')),
    );
  }

  function viewLoading(s, p) {
    return el(
      'div',
      { class: 'quiz-card center' },
      el('span', { class: 'typing' }, el('i'), el('i'), el('i')),
      el('p', {}, `Writing ${s.config.count} ${s.config.difficulty.toLowerCase()} questions on ${s.config.topic}…`),
      el('button', { type: 'button', class: 'ghost', onclick: cancel }, 'Cancel'),
    );
  }

  function scoreSoFar(s) {
    return s.answers.filter((a, i) => a === s.questions[i].answer).length;
  }

  function viewActive(s) {
    const q = s.questions[s.index];
    const answered = s.picked !== null;
    const total = s.questions.length;
    const last = s.index === total - 1;

    const options = q.options.map((text, i) => {
      let cls = 'opt';
      if (answered) {
        if (i === q.answer) cls += ' correct';
        else if (i === s.picked) cls += ' wrong';
        else cls += ' dim';
      }
      return el(
        'button',
        { type: 'button', class: cls, disabled: answered, onclick: () => pick(i) },
        el('span', { class: 'letter' }, LETTERS[i]),
        md(text, 'opt-text'),
      );
    });

    return el(
      'div',
      { class: 'quiz-card' },
      el(
        'div',
        { class: 'quiz-head' },
        el('span', {}, `Question ${s.index + 1} of ${total}`),
        el('span', { class: 'score' }, `Score ${scoreSoFar(s)}/${s.answers.length}`),
      ),
      el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': s.index + (answered ? 1 : 0) }, el('div', { class: 'bar', style: `width:${((s.index + (answered ? 1 : 0)) / total) * 100}%` })),
      md(q.question, 'q-text'),
      el('div', { class: 'opts' }, options),
      answered &&
        el(
          'div',
          { class: 'feedback ' + (s.picked === q.answer ? 'ok' : 'bad'), role: 'status' },
          el('strong', {}, s.picked === q.answer ? '✅ Correct' : `❌ Not quite — the answer is ${LETTERS[q.answer]}`),
          md(q.explanation),
        ),
      el(
        'div',
        { class: 'quiz-actions' },
        el('button', { type: 'button', class: 'ghost', onclick: quit }, 'Quit'),
        answered && el('button', { type: 'button', class: 'send', onclick: next }, last ? 'See results' : 'Next question →'),
      ),
      !answered && el('p', { class: 'hint' }, 'Tip: press A–D or 1–4 to answer, Enter for next.'),
    );
  }

  function viewResults(s, p) {
    const total = s.questions.length;
    const score = scoreSoFar(s);
    const pct = Math.round((score / total) * 100);
    const verdict = pct >= 90 ? 'Outstanding! 🔥' : pct >= 70 ? 'Solid work 👍' : pct >= 50 ? 'Getting there — review the misses below.' : 'Worth another pass — see the explanations below.';
    const review = s.questions.map((q, i) => {
      const ok = s.answers[i] === q.answer;
      return el(
        'details',
        { class: 'review ' + (ok ? 'ok' : 'bad'), open: !ok },
        el('summary', {}, `${ok ? '✅' : '❌'} Q${i + 1}. `, el('span', {}, q.question.replace(/[`*]/g, '').slice(0, 110) + (q.question.length > 110 ? '…' : ''))),
        md(q.question),
        el('p', { class: 'ans' }, ok ? `Your answer: ${LETTERS[q.answer]}. ${q.options[q.answer]}` : `Your answer: ${LETTERS[s.answers[i]]}. ${q.options[s.answers[i]]}`),
        !ok && el('p', { class: 'ans good' }, `Correct: ${LETTERS[q.answer]}. ${q.options[q.answer]}`),
        md(q.explanation, 'expl'),
      );
    });
    return el(
      'div',
      { class: 'quiz-card' },
      el('div', { class: 'result-hero' }, el('div', { class: 'big' }, `${score}/${total}`), el('div', {}, `${pct}% · ${s.config.topic} · ${s.config.difficulty}`), el('p', { class: 'muted' }, verdict)),
      el('div', { class: 'quiz-actions wrap' },
        el('button', { type: 'button', class: 'send', onclick: start }, 'New quiz, same settings'),
        el('button', { type: 'button', class: 'ghost lg', onclick: () => ((s.phase = 'setup'), render()) }, 'Change settings'),
        el('button', { type: 'button', class: 'ghost lg', onclick: () => discuss(s, p) }, '💬 Discuss in chat'),
      ),
      el('h3', {}, 'Review'),
      review,
    );
  }

  function render() {
    const p = ctx.getPersona();
    const s = st();
    const view = { setup: viewSetup, loading: viewLoading, active: viewActive, results: viewResults }[s.phase](s, p);
    ctx.root.replaceChildren(view);
  }

  async function start() {
    const p = ctx.getPersona();
    const s = st();
    if (!ctx.getApiKey()) return ctx.onNeedKey(false);
    s.phase = 'loading';
    s.error = '';
    s.controller = new AbortController();
    const mine = s.controller;
    if (ctx.getPersona() === p) render();
    const { topic, difficulty, count } = s.config;
    const topicLine = topic === 'Mixed' ? `a balanced mix of these areas: ${p.quizTopics.slice(1).join(', ')}` : `the topic "${topic}"`;
    try {
      const raw = await generateJson({
        apiKey: ctx.getApiKey(),
        system: `You write accurate, interview-relevant multiple-choice quizzes for candidates preparing for ${p.label} roles. Never invent facts; prefer well-established concepts and practices.`,
        prompt: `Write ${count} ${difficulty.toLowerCase()}-difficulty multiple-choice questions for a ${p.label} interview, covering ${topicLine}.
Rules: exactly 4 options per question; exactly one correct option; plausible distractors based on real misconceptions; options must not include letter prefixes like "A)"; answerIndex is the 0-based index of the correct option; the explanation is 1-3 sentences saying why the answer is right and why a tempting wrong one is not. Questions should be distinct, practical and scenario-based where sensible. Use \`backticks\` for code or identifiers.`,
        schema: SCHEMA,
        signal: mine.signal,
      });
      const questions = normalise(raw).slice(0, count);
      if (!questions.length) throw new Error('Could not generate a valid quiz. Please try again.');
      Object.assign(s, { phase: 'active', questions, index: 0, picked: null, answers: [], error: '' });
    } catch (err) {
      if (err.name === 'AbortError') {
        if (s.controller === mine) s.phase = 'setup';
      } else {
        Object.assign(s, { phase: 'setup', error: err.message });
        if (/api key|rejected|permission/i.test(err.message)) ctx.onNeedKey(true, err.message);
      }
    } finally {
      if (s.controller === mine) s.controller = null;
      if (ctx.getPersona() === p) render();
    }
  }

  function cancel() {
    const s = st();
    s.controller?.abort();
  }

  function pick(i) {
    const s = st();
    if (s.phase !== 'active' || s.picked !== null) return;
    s.picked = i;
    s.answers[s.index] = i;
    render();
    // Bring the feedback into view on short screens.
    ctx.root.querySelector('.feedback')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function next() {
    const s = st();
    if (s.picked === null) return;
    if (s.index + 1 < s.questions.length) {
      s.index++;
      s.picked = null;
    } else {
      s.phase = 'results';
    }
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function quit() {
    const s = st();
    if (s.answers.length && !confirm('Quit this quiz? Your progress will be lost.')) return;
    s.phase = 'setup';
    render();
  }

  function discuss(s, p) {
    const missed = s.questions
      .map((q, i) => ({ q, i }))
      .filter(({ q, i }) => s.answers[i] !== q.answer)
      .map(({ q, i }) => `${i + 1}. ${q.question}\n   My answer: ${q.options[s.answers[i]]}\n   Correct: ${q.options[q.answer]}`);
    const head = `I just took a ${s.config.difficulty.toLowerCase()} ${p.short} quiz on "${s.config.topic}" and scored ${scoreSoFar(s)}/${s.questions.length}.`;
    ctx.onDiscuss(
      missed.length
        ? `${head} Please walk me through the ones I missed, then tell me what to study next:\n\n${missed.join('\n\n')}`
        : `${head} I got everything right — give me a harder follow-up question in mock-interview style.`,
    );
  }

  // Keyboard shortcuts while a quiz question is on screen.
  document.addEventListener('keydown', (e) => {
    if (ctx.root.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!document.getElementById('key-modal').hidden) return;
    if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
    const s = st();
    if (s.phase !== 'active') return;
    const idx = '1234'.indexOf(e.key) >= 0 ? '1234'.indexOf(e.key) : 'abcd'.indexOf(e.key.toLowerCase());
    if (e.key.length === 1 && idx >= 0 && idx < s.questions[s.index].options.length) {
      e.preventDefault();
      pick(idx);
    } else if (e.key === 'Enter' && s.picked !== null && document.activeElement?.tagName !== 'BUTTON') {
      e.preventDefault();
      next();
    }
  });

  return { render };
}
