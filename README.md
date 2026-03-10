# çekirdek — türkiye haberleri

A minimal Turkish news aggregator. Pulls RSS feeds from 10 sources, extracts article summaries server-side, and presents them in a clean split-panel reader — desktop and mobile.

🗞️ **[View Live](https://jeepso.github.io/cekirdek-news)**

---

## 📰 Sources

Diken · Medyascope · Cumhuriyet · Sözcü · NTV · Bianet · BBC Türkçe · DW Türkçe · Sputnik TR · Hürriyet

All sources use direct RSS feeds.

---

## ⚙️ How It Works

### Feed aggregation
- Express backend parses all 10 RSS feeds on startup and refreshes every 20 minutes
- Up to 30 items cached per source, sorted by publication date
- All state is in-memory — cache resets on restart

### Article summaries
- When you click an article, the server fetches the page, runs it through **Mozilla Readability**, and returns the first 2–3 meaningful paragraphs
- For sources with rich RSS content (NTV, Bianet), summaries are **pre-populated from the feed itself** — no extra fetch needed on click
- Each source has a cleanup pass to strip WordPress artifacts, brand noise, author initials, and date stamps
- Summaries are cached (up to 300 articles) so repeat clicks are instant

### Frontend
- Vanilla JS, no framework
- Split-panel layout on desktop: news list on the left, reader on the right
- Full-screen reader on mobile with a back button to return to the list
- Filter pills per source, live time-ago timestamps

---

## 🚀 Running Locally

```bash
npm install
npm start
```

Server runs at `http://localhost:3001`.

For mobile preview: open Chrome DevTools → `Ctrl+Shift+M` → select a device.

---

## 🌐 Deployment

| Layer | Platform | Details |
|-------|----------|---------|
| Frontend | GitHub Pages | Static `index.html` at [jeepso.github.io/cekirdek-news](https://jeepso.github.io/cekirdek-news) |
| Backend | [Render](https://render.com) | Node.js web service — RSS fetching, article extraction, CORS |

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Injected automatically by Render |
| `ALLOWED_ORIGIN` | `*` | Set to your frontend domain to restrict CORS |

> **Note:** On Render's free tier the service sleeps after 15 minutes of inactivity. The first request after sleep takes a few seconds while the feeds are re-fetched.

---

## 🛠️ Stack

### Backend
- **Node.js + Express** — HTTP server and API
- **rss-parser** — RSS/Atom feed parsing
- **@mozilla/readability + jsdom** — Server-side article extraction

### Frontend
- **Vanilla JS** — No framework
- **Tailwind CSS** (CDN) — Utility styling
- **Google Fonts** — Newsreader (serif, display) + DM Mono (mono, UI)

---

## ⚠️ Known Limitations

- **Medyascope** article pages are behind a cookie consent wall — summaries fall back to the RSS snippet (1–2 sentences)
- **Hürriyet** article pages may occasionally hit Cloudflare protection — same fallback behaviour
- **T24 and Gazete Duvar** were evaluated but blocked by Cloudflare on all RSS paths; not included
- Cache is in-memory only — a Render restart clears all cached articles

---

## 🙏 Acknowledgements

Built with [Claude Code](https://claude.ai/code) (Anthropic) and [Codex](https://openai.com/codex) (OpenAI).

- **Claude Code** — backend architecture, RSS feed engineering, article extraction, source research, mobile layout
- **Codex** — GitHub Pages and Render deployment setup

---

**Last updated:** March 2026
