# AI Interview Agent

A Vite + vanilla JS chatbot that helps you prepare for AI roles. Pick the role you're interviewing for and the bot switches persona, starter questions and UI colours:

- **AI Product Manager**
- **Forward Deployed Engineer**
- **AI Researcher**

Each role keeps its own conversation. Replies stream from the Gemini API directly from your browser.

## Modes

- **Chat** — talk to the role-specific coach. The whole page scrolls (no nested scroll box); the role/mode bar stays pinned at the top, the input floats at the bottom, and a ↓ button jumps back to the latest message.
- **Quiz** — pick a topic, difficulty (Easy/Medium/Hard) and length (5 or 10), and Gemini generates multiple-choice questions for that role. You get instant right/wrong feedback with explanations, a running score, and a review screen. Keyboard: `A–D`/`1–4` to answer, `Enter` for next. "Discuss in chat" sends your missed questions to the coach. Each role keeps its own quiz progress.

## Run

```bash
npm install
npm run dev
```

On first load you'll be asked for a [Gemini API key](https://aistudio.google.com/apikey). It is kept in `sessionStorage` (cleared when the tab closes) unless you tick "Remember on this device" (`localStorage`). Use the **API key** button to change it.

## Model

Defaults to `gemini-3.8-flash` (see `src/gemini.js`). Override without code changes via a `.env` file:

```
VITE_GEMINI_MODEL=gemini-2.5-flash
```

## Customising

- `src/personas.js` — system prompts, greetings, starter questions and theme colours per role.
- `src/style.css` — the background gradient/grid and neon styling driven by CSS variables.
