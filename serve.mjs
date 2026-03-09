import express from 'express';
import Parser from 'rss-parser';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'url';
import path from 'path';
import { SOURCES, REFRESH_INTERVAL_MS, MAX_ITEMS_PER_SOURCE } from './sources.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3001;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
};

const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; TurkishNewsBot/1.0)',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  },
  timeout: 10000,
  customFields: {
    item: [['media:content', 'mediaContent'], ['enclosure', 'enclosure']],
  },
});

// ── RSS summary cleanup ────────────────────────────────────────────────────────
function cleanSummary(raw, sourceId) {
  let s = raw.replace(/<[^>]*>/g, ''); // strip HTML tags

  if (sourceId === 'diken') {
    // First line is always the article title — remove it
    s = s.replace(/^[^\n]+\n/, '');
    s = s.replace(/#\w+/g, '');                                      // remove #site_linkat etc
    s = s.replace(/\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/g, '');          // remove dates like 10.03.2026
    s = s.replace(/\bDiken\b/gi, '');                                 // remove "Diken" brand noise
    s = s.replace(/\bsite_linkat\b/gi, '');
    s = s.replace(/appeared first on\s*\.?/gi, '');                  // WordPress RSS artifact
    s = s.replace(/The post .+? appeared first on .+?\.?$/s, '');    // full WordPress postfix
  }

  if (sourceId === 'medyascope') {
    s = s.replace(/\bMedyascope\b/gi, '');                           // remove brand noise
    s = s.replace(/appeared first on\s*\.?/gi, '');                  // WordPress artifact
    s = s.replace(/The post .+? appeared first on .+?\.?$/s, '');
    // Remove duplicate trailing title (WordPress appends "Title Source" after description)
    const lines = s.split(/\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 1 && lines[lines.length - 1].length < 120) {
      s = lines.slice(0, -1).join(' ');
    }
  }

  return s.replace(/\s+/g, ' ').trim().slice(0, 600);
}

// ── RSS feed cache ─────────────────────────────────────────────────────────────
const cache = {
  items: [],
  lastUpdated: null,
};

async function fetchSource(source) {
  try {
    const feed = await parser.parseURL(source.url);
    return feed.items.slice(0, MAX_ITEMS_PER_SOURCE).map(item => {
      const rawSnippet = item.contentSnippet || item.summary || item['content:encodedSnippet'] || '';
      const summary = cleanSummary(rawSnippet, source.id);

      // Pre-populate article cache if RSS snippet is rich enough (saves a fetch on click)
      const articleUrl = item.link ?? '';
      if (articleUrl && rawSnippet.length > 300 && !articleCache.has(articleUrl)) {
        // Apply source-specific pre-processing before extracting summary
        let snippetForCache = rawSnippet;
        if (source.id === 'diken') snippetForCache = rawSnippet.replace(/^[^\n]+\n/, '');
        const content = extractSummary(snippetForCache);
        if (content && content.length >= 60) {
          if (articleCache.size >= MAX_ARTICLE_CACHE) {
            articleCache.delete(articleCache.keys().next().value);
          }
          articleCache.set(articleUrl, { ok: true, content, excerpt: '' });
        }
      }

      return {
        id: `${source.id}::${item.link ?? item.guid ?? item.title}`,
        title: item.title?.trim() ?? '',
        link: item.link ?? '',
        pubDate: item.pubDate ? new Date(item.pubDate).toISOString() : null,
        summary,
        source: source.id,
        sourceLabel: source.label,
        sourceColor: source.color,
      };
    });
  } catch (err) {
    console.error(`[${source.id}] fetch failed: ${err.message}`);
    return [];
  }
}

async function refreshAllFeeds() {
  console.log(`[refresh] starting at ${new Date().toISOString()}`);
  const results = await Promise.allSettled(SOURCES.map(s => fetchSource(s)));

  const allItems = [];
  results.forEach(result => {
    if (result.status === 'fulfilled') allItems.push(...result.value);
  });

  allItems.sort((a, b) => {
    if (!a.pubDate) return 1;
    if (!b.pubDate) return -1;
    return new Date(b.pubDate) - new Date(a.pubDate);
  });

  cache.items = allItems;
  cache.lastUpdated = new Date().toISOString();
  console.log(`[refresh] done — ${allItems.length} items cached`);
}

let firstRefresh = refreshAllFeeds();
setInterval(refreshAllFeeds, REFRESH_INTERVAL_MS);

// ── Extractive summarization ───────────────────────────────────────────────────
function extractSummary(text) {
  const paragraphs = text
    .replace(/[ \t]+/g, ' ')
    .split(/\n+/)
    .map(p => p.trim())
    .filter(p =>
      p.length >= 60 &&         // skip short nav/byline fragments
      p.length <= 800 &&        // skip absurdly long single lines
      !/^\d+[\.\)]\s/.test(p)   // skip numbered list items
    );
  return paragraphs.slice(0, 3).join('\n\n');
}

// ── Article content extraction cache ──────────────────────────────────────────
const articleCache = new Map(); // url → { ok, content, excerpt }
const MAX_ARTICLE_CACHE = 300;

app.get('/api/article', async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const url = req.query.url;
  if (!url) return res.status(400).json({ ok: false, reason: 'missing url' });

  if (articleCache.has(url)) return res.json(articleCache.get(url));

  try {
    const response = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return res.json({ ok: false, reason: `http_${response.status}` });
    }

    const html = await response.text();
    const finalUrl = response.url; // after redirects

    const dom = new JSDOM(html, { url: finalUrl });
    const reader = new Readability(dom.window.document, {
      charThreshold: 100,
    });
    const article = reader.parse();

    if (!article || !article.textContent || article.textContent.trim().length < 80) {
      return res.json({ ok: false, reason: 'no_content' });
    }

    const summary = extractSummary(
      article.textContent.replace(/\n{3,}/g, '\n\n').trim()
    );

    if (!summary || summary.length < 60) {
      return res.json({ ok: false, reason: 'no_content' });
    }

    const result = { ok: true, content: summary, excerpt: article.excerpt ?? '' };

    // LRU-style: evict oldest if too large
    if (articleCache.size >= MAX_ARTICLE_CACHE) {
      articleCache.delete(articleCache.keys().next().value);
    }
    articleCache.set(url, result);

    res.json(result);
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'timeout' : 'error';
    console.error(`[article] ${reason}: ${url} — ${err.message}`);
    res.json({ ok: false, reason });
  }
});

// ── News feed endpoint ─────────────────────────────────────────────────────────
app.get('/api/news', async (_req, res) => {
  await firstRefresh;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json({
    items: cache.items,
    lastUpdated: cache.lastUpdated,
    count: cache.items.length,
  });
});

app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
