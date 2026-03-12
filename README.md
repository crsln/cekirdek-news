# çekirdek — sade haberler

A minimal Turkish news aggregator. Pulls RSS feeds from 10 sources, extracts article summaries server-side, and presents them in a clean split-panel reader — desktop and mobile.

🗞️ **[View Live](https://cigdem.xyz)**

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
| Frontend | [Render](https://render.com) Static Site | Deploys the `public/` directory |
| Backend | [Render](https://render.com) Web Service | Node.js service for RSS fetching, article extraction, and CORS |

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Injected automatically by Render |
| `ALLOWED_ORIGIN` | `https://cigdem.xyz,https://www.cigdem.xyz,http://localhost:3001,http://127.0.0.1:3001` | Comma-separated allowed frontend origins for CORS (`*` also supported) |

### Custom domain (Dynadot + Render) for `cigdem.xyz`

1. Push this repo to GitHub (`master` branch).
2. In Render, create a **Static Site** from this repo.
3. Configure static site:
   - Build command: empty
   - Publish directory: `public`
4. In Render static site settings, add custom domains:
   - `cigdem.xyz`
   - `www.cigdem.xyz`
5. In Dynadot DNS, add records using the exact values Render shows:
   - `@` -> `ANAME` to your Render static hostname (or apex `A` records if Render gives those)
   - `www` -> `CNAME` to your Render static hostname
6. In Render backend service, set:
   - `ALLOWED_ORIGIN=https://cigdem.xyz,https://www.cigdem.xyz`
7. Redeploy the backend service after saving env vars.
8. Keep GitHub for source control, and disable GitHub Pages for this repo to avoid domain conflicts.

> **Note:** On Render's free tier the service sleeps after 15 minutes of inactivity. The first request after sleep takes a few seconds while the feeds are re-fetched.

### Closing source access

To fully close source access, make the GitHub repository private in:
`Settings -> General -> Change repository visibility`.

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
- **Codex** — deployment and infrastructure setup

---

## 📄 License

[All Rights Reserved](LICENSE).

---

**Last updated:** March 2026
