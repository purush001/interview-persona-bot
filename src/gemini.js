// Model name is configurable: set VITE_GEMINI_MODEL in .env to override.
export const MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-3.8-flash';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function toContents(history) {
  return history.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }],
  }));
}

async function errorFromResponse(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message || '';
  } catch {
    /* ignore */
  }
  if (res.status === 400 && /api key/i.test(detail)) return new Error('Invalid API key. Please check it and try again.');
  if (res.status === 401 || res.status === 403) return new Error(detail || 'The API key was rejected (permission denied).');
  if (res.status === 404) return new Error(`Model "${MODEL}" was not found for this API key. ${detail}`.trim());
  if (res.status === 429) return new Error('Rate limit or quota reached. Wait a moment and try again.');
  return new Error(detail || `Request failed (HTTP ${res.status}).`);
}

/** Streams the model reply, calling onChunk(textDelta). Resolves with the full text. */
export async function streamChat({ apiKey, system, history, onChunk, signal }) {
  const res = await fetch(`${BASE}/${MODEL}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: toContents(history),
      generationConfig: { temperature: 0.8 },
    }),
  });
  if (!res.ok) throw await errorFromResponse(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let blocked = '';

  const handleLine = (line) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      const json = JSON.parse(payload);
      if (json.promptFeedback?.blockReason) blocked = json.promptFeedback.blockReason;
      const parts = json.candidates?.[0]?.content?.parts || [];
      const text = parts.filter((p) => !p.thought).map((p) => p.text || '').join('');
      if (text) {
        full += text;
        onChunk(text);
      }
    } catch {
      /* partial JSON — ignore */
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    lines.forEach(handleLine);
  }
  if (buffer) handleLine(buffer);

  if (!full) throw new Error(blocked ? `The request was blocked (${blocked}).` : 'The model returned an empty response.');
  return full;
}

/** One-shot JSON generation (non-streaming), constrained by a response schema. */
export async function generateJson({ apiKey, system, prompt, schema, signal }) {
  const res = await fetch(`${BASE}/${MODEL}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, responseMimeType: 'application/json', responseSchema: schema },
    }),
  });
  if (!res.ok) throw await errorFromResponse(res);
  const json = await res.json();
  const text = (json.candidates?.[0]?.content?.parts || [])
    .filter((p) => !p.thought)
    .map((p) => p.text || '')
    .join('')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  if (!text) {
    const blocked = json.promptFeedback?.blockReason;
    throw new Error(blocked ? `The request was blocked (${blocked}).` : 'The model returned an empty response.');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The model returned malformed data. Please try again.');
  }
}
