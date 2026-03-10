# çekirdek

A minimal Turkish news aggregator. Pulls RSS feeds from five sources, extracts article summaries server-side, and presents them in a split-panel reader.

**Live:** [jeepso.github.io/cekirdek-news](https://jeepso.github.io/cekirdek-news)

---

## Sources

| Source | Feed |
|--------|------|
| Diken | Direct RSS |
| Medyascope | Direct RSS |
| Cumhuriyet | Direct RSS |
| Sözcü | Direct RSS |
| NTV | Direct RSS (dünya) |

---

## How it works

- Express backend parses RSS feeds and caches up to 30 items per source
- Feeds refresh every 20 minutes
- When you click an article, the server fetches the page, runs it through Mozilla Readability, and returns the first 2–3 meaningful paragraphs
- For sources with rich RSS content (NTV), summaries are pre-populated from the feed itself — no extra fetch needed
- All state is in-memory; cache resets on restart

---

## Running locally

```bash
npm install
npm start
```

Server runs at `http://localhost:3001`.

---

## Deployment

- **Frontend:** GitHub Pages — static `index.html` served at [jeepso.github.io/cekirdek-news](https://jeepso.github.io/cekirdek-news)
- **Backend:** [Render](https://render.com) — Node.js web service handling RSS fetching and article extraction

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Injected automatically by Render |
| `ALLOWED_ORIGIN` | `*` | Set to your frontend domain to restrict CORS |

> **Note:** On Render's free tier the service sleeps after 15 minutes of inactivity. First request after sleep takes a few seconds while feeds are fetched.

---

## Stack

- **Backend:** Node.js, Express, rss-parser, @mozilla/readability, jsdom
- **Frontend:** Vanilla JS, Tailwind CSS (CDN), Google Fonts (Newsreader + DM Mono)

---

## Acknowledgements

Built with [Claude Code](https://claude.ai/code) (Anthropic) and [Codex](https://openai.com/codex) (OpenAI) — Claude handled the backend architecture, RSS feed engineering, and article extraction; Codex assisted with the GitHub and Render deployment setup.
