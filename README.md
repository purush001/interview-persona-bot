# AI Interview Agent

A Vite + vanilla JS chatbot that helps you prepare for AI roles. Pick the role you're interviewing for and the bot switches persona, starter questions and UI colours:

- **AI Product Manager**
- **Forward Deployed Engineer**
- **AI Researcher**

Each role keeps its own conversation. Replies stream from the Gemini API directly from your browser.

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
