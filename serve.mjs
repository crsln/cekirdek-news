import express from 'express';
import Parser from 'rss-parser';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'url';
import path from 'path';
import { isIP } from 'node:net';
import { SOURCES, REFRESH_INTERVAL_MS, MAX_ITEMS_PER_SOURCE } from './sources.mjs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3001;
const DEFAULT_ALLOWED_ORIGINS = [
  'https://cigdem.xyz',
  'https://www.cigdem.xyz',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
];
const configuredOrigins = (process.env.ALLOWED_ORIGIN ?? '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)
  .map(origin => origin.replace(/\/$/, ''));
const ALLOW_ALL_ORIGINS = configuredOrigins.includes('*');
const ALLOWED_ORIGINS = new Set(configuredOrigins.filter(origin => origin !== '*'));
if (!ALLOW_ALL_ORIGINS && ALLOWED_ORIGINS.size === 0) {
  DEFAULT_ALLOWED_ORIGINS.forEach(origin => ALLOWED_ORIGINS.add(origin));
}

function normalizeOrigin(origin) {
  return String(origin ?? '').trim().replace(/\/$/, '');
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "https://cekirdek-news.onrender.com", "https://api.cigdem.xyz"],
      imgSrc: ["'self'", "data:"],
    },
  },
}));

app.use((req, res, next) => {
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  const requestOrigin = normalizeOrigin(req.headers.origin);
  if (requestOrigin && (ALLOW_ALL_ORIGINS || ALLOWED_ORIGINS.has(requestOrigin))) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  }
  if (req.method === 'OPTIONS') {
    if (requestOrigin && !ALLOW_ALL_ORIGINS && !ALLOWED_ORIGINS.has(requestOrigin)) {
      return res.sendStatus(403);
    }
    return res.sendStatus(204);
  }
  next();
});

app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, reason: 'rate_limited' },
}));

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

// ── HTML entity decoding ────────────────────────────────────────────────────────
function decodeEntities(str) {
  return String(str ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// Extract text from <p> tags only — useful when description has junk outside <p>
function extractParagraphs(str) {
  const raw = String(str ?? '');
  const matches = [];
  const re = /<p[^>]*>(.*?)<\/p>/gis;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const text = m[1].replace(/<[^>]*>/g, '').trim();
    if (text.length > 10) matches.push(text);
  }
  return matches.join(' ');
}

// ── RSS summary cleanup ────────────────────────────────────────────────────────
function cleanSummary(raw, sourceId) {
  let s = raw.replace(/<[^>]*>/g, ''); // strip HTML tags

  // Universal WordPress artifact cleanup (all sources)
  s = s.replace(/The post .+? appeared first on .+?\.?$/s, '');
  s = s.replace(/appeared first on\s*\.?/gi, '');
  s = s.replace(/#\w+/g, '');
  s = s.replace(/\bsite_linkat\b/gi, '');

  if (sourceId === 'diken') {
    s = s.replace(/^[^\n]+\n/, '');       // remove first line (title repeat)
    s = s.replace(/\n[^\n]+$/,  '');       // remove last line (title + WP artifacts)
    s = s.replace(/\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/g, '');
    s = s.replace(/\bDiken\b/gi, '');
  }

  if (sourceId === 'bianet') {
    s = s.replace(/\s*\([A-ZÇĞİÖŞÜ]{2,3}\)\s*$/gm, '');
  }

  if (sourceId === 'medyascope') {
    s = s.replace(/\bMedyascope\b/gi, '');
    const lines = s.split(/\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 1 && lines[lines.length - 1].length < 120) {
      s = lines.slice(0, -1).join(' ');
    }
  }

  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > 600) {
    const cut = s.lastIndexOf('. ', 600);
    s = cut > 200 ? s.slice(0, cut + 1) : s.slice(0, 600);
  }
  return s;
}

// ── Content filter (blocked topics) ────────────────────────────────────────────
const BLOCKED_KEYWORDS = [
  'burç', 'burc', 'burçlar', 'burclar',
  'astroloji',
  'haftalık burç', 'günlük burç', 'aylık burç',
  'koç burcu', 'boğa burcu', 'ikizler burcu', 'yengeç burcu',
  'aslan burcu', 'başak burcu', 'terazi burcu', 'akrep burcu',
  'yay burcu', 'oğlak burcu', 'kova burcu', 'balık burcu',
  'zodyak', 'horoscope',
];

const BLOCKED_SOURCE_SECTIONS = [
  {
    sourceId: 'cumhuriyet',
    pathContains: '/resmi-ilanlar/',
    categoryIncludes: ['resmi ilanlar', 'resmî ilanlar'],
  },
  {
    sourceId: 'cumhuriyet',
    pathContains: '/cizerler/',
    categoryIncludes: ['çizerler', 'cizerler'],
  },
  {
    sourceId: 'cumhuriyet',
    pathContains: '/yazarlar/',
    categoryIncludes: ['köşe yazıları', 'kose yazilari', 'yazarlar'],
  },
  {
    sourceId: 'cumhuriyet',
    pathContains: '/gurme/',
    categoryIncludes: ['gurme', 'yemek tarifleri'],
  },
  {
    sourceId: 'cumhuriyet',
    pathContains: '/tv-rehberi/',
    categoryIncludes: ['tv rehberi'],
  },
  {
    sourceId: 'hurriyet',
    pathContains: '/resmi-ilanlar/',
    categoryIncludes: ['resmi ilanlar', 'resmî ilanlar'],
  },
];

function isBlocked(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();
  return BLOCKED_KEYWORDS.some(kw => text.includes(kw));
}

function isSourceSectionBlocked(sourceId, link, categories = []) {
  const linkText = String(link ?? '').toLowerCase();
  const categoryTexts = Array.isArray(categories)
    ? categories.map(category => String(category ?? '').toLowerCase())
    : [];

  return BLOCKED_SOURCE_SECTIONS.some(rule => {
    if (rule.sourceId !== sourceId) return false;
    if (rule.pathContains && linkText.includes(rule.pathContains)) return true;
    if (!Array.isArray(rule.categoryIncludes) || rule.categoryIncludes.length === 0) return false;
    return categoryTexts.some(text => rule.categoryIncludes.some(keyword => text.includes(keyword)));
  });
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
      const s1 = item.contentSnippet || '';
      const s2 = item['content:encodedSnippet'] || item.summary || '';
      let rawSnippet;
      if (source.id === 'diken') {
        // Diken description has junk outside <p> — extract <p> content from raw HTML
        const rawHtml = item.content || item['content:encoded'] || '';
        const pText = extractParagraphs(rawHtml);
        rawSnippet = pText.length > 20 ? pText : (s2.length > 20 ? s2 : s1);
      } else {
        rawSnippet = s1.length >= s2.length ? s1 : s2;
      }
      let summary = cleanSummary(decodeEntities(rawSnippet), source.id);
      // Fallback: if summary is too short after cleanup, try the other field
      if (summary.length < 20 && s2.length > 20 && rawSnippet !== s2) {
        summary = cleanSummary(decodeEntities(s2), source.id);
      }
      const title = decodeEntities(item.title?.trim() ?? '');
      const link = item.link ?? '';

      if (
        isBlocked(title, summary) ||
        isSourceSectionBlocked(source.id, link, item.categories)
      ) {
        return null;
      }

      // Pre-populate article cache if RSS snippet is rich enough (saves a fetch on click)
      const articleUrl = link;
      if (articleUrl && rawSnippet.length > 300 && !articleCache.has(articleUrl)) {
        // Apply source-specific pre-processing before extracting summary
        let snippetForCache = rawSnippet;
        if (source.id === 'diken') snippetForCache = rawSnippet.replace(/^[^\n]+\n/, '').replace(/\n[^\n]+$/, '');
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
        title,
        link,
        pubDate: (() => { const d = item.pubDate ? new Date(item.pubDate) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null; })(),
        summary,
        source: source.id,
        sourceLabel: source.label,
        sourceColor: source.color,
      };
    }).filter(Boolean);
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

const firstRefresh = refreshAllFeeds().catch(err => {
  console.error('[startup] initial feed fetch failed:', err.message);
});

setInterval(() => {
  refreshAllFeeds().catch(err => {
    console.error('[refresh] interval fetch failed:', err.message);
  });
}, REFRESH_INTERVAL_MS);

// ── Extractive summarization ───────────────────────────────────────────────────
function extractSummary(text) {
  const paragraphs = text
    .replace(/[ \t]+/g, ' ')
    .split(/\n+/)
    .map(p => p.trim())
    .filter(p =>
      p.length >= 60 &&         // skip short nav/byline fragments
      p.length <= 800 &&        // skip absurdly long single lines
      !/^\d+[\.\)]\s/.test(p) &&                // skip numbered list items
      !/internet sitesinde yayınlanan/i.test(p) &&  // skip copyright notices
      !/izin alınmadan|tüm hakları saklıdır|iktibas edilemez|\.com\.tr'ye aittir|Tic\. A\.Ş/i.test(p)
    );
  return paragraphs.slice(0, 3).join('\n\n');
}

// ── Article content extraction cache ──────────────────────────────────────────
const articleCache = new Map(); // url → { ok, content, excerpt }
const MAX_ARTICLE_CACHE = 300;
const MAX_ARTICLE_HTML_BYTES = 5_000_000;
const inFlightArticleFetches = new Map(); // url → Promise<{ok:boolean, reason?:string}>

// Additional article hosts not directly visible from RSS feed hostnames.
const EXTRA_ALLOWED_DOMAINS_BY_SOURCE = {
  bbc: ['bbc.com', 'bbc.co.uk', 'bbci.co.uk'],
  dw: ['dw.com'],
};

function normalizeHostname(hostname) {
  return String(hostname ?? '')
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '');
}

const ALLOWED_DOMAINS = new Set();
for (const source of SOURCES) {
  const feedHost = normalizeHostname(new URL(source.url).hostname);
  if (feedHost) ALLOWED_DOMAINS.add(feedHost);

  const extraHosts = EXTRA_ALLOWED_DOMAINS_BY_SOURCE[source.id] ?? [];
  for (const host of extraHosts) {
    const normalized = normalizeHostname(host);
    if (normalized) ALLOWED_DOMAINS.add(normalized);
  }
}

function isAllowedHostname(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (isIP(host)) return false;

  for (const allowed of ALLOWED_DOMAINS) {
    if (host === allowed || host.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

function isAllowedUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return isAllowedHostname(u.hostname);
  } catch {
    return false;
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECT_HOPS = 3;

async function fetchArticleHtml(initialUrl) {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const response = await fetch(currentUrl, {
      headers: FETCH_HEADERS,
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      if (!location) return { ok: false, reason: 'redirect_blocked' };

      const nextUrl = new URL(location, currentUrl).href;
      if (!isAllowedUrl(nextUrl)) return { ok: false, reason: 'redirect_blocked' };

      currentUrl = nextUrl;
      continue;
    }

    if (!response.ok) return { ok: false, reason: `http_${response.status}` };
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (
      !contentType.includes('text/html') &&
      !contentType.includes('application/xhtml+xml')
    ) {
      return { ok: false, reason: 'not_html' };
    }

    const contentLengthHeader = response.headers.get('content-length');
    const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : NaN;
    if (Number.isFinite(contentLength) && contentLength > MAX_ARTICLE_HTML_BYTES) {
      return { ok: false, reason: 'too_large' };
    }

    // Stream body with byte counter — abort early if too large
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of response.body) {
      totalBytes += chunk.length;
      if (totalBytes > MAX_ARTICLE_HTML_BYTES) {
        response.body.destroy();
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(chunk);
    }
    const html = Buffer.concat(chunks).toString('utf-8');
    return { ok: true, html, finalUrl: currentUrl };
  }

  return { ok: false, reason: 'too_many_redirects' };
}

app.get('/api/article', async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const url = req.query.url;
  if (!url) return res.status(400).json({ ok: false, reason: 'missing url' });
  if (!isAllowedUrl(url)) return res.status(403).json({ ok: false, reason: 'domain_not_allowed' });

  if (articleCache.has(url)) return res.json(articleCache.get(url));
  if (inFlightArticleFetches.has(url)) {
    const result = await inFlightArticleFetches.get(url);
    if (!result.ok && result.reason === 'redirect_blocked') {
      return res.status(403).json(result);
    }
    return res.json(result);
  }

  const fetchPromise = (async () => {
    try {
      const fetched = await fetchArticleHtml(url);
      if (!fetched.ok) {
        return { ok: false, reason: fetched.reason };
      }

      const { html, finalUrl } = fetched;

      const dom = new JSDOM(html, { url: finalUrl });
      const reader = new Readability(dom.window.document, {
        charThreshold: 100,
      });
      const article = reader.parse();

      if (!article || !article.textContent || article.textContent.trim().length < 80) {
        return { ok: false, reason: 'no_content' };
      }

      const summary = extractSummary(
        article.textContent.replace(/\n{3,}/g, '\n\n').trim()
      );

      if (!summary || summary.length < 60) {
        return { ok: false, reason: 'no_content' };
      }

      const result = { ok: true, content: summary, excerpt: article.excerpt ?? '' };

      // LRU-style: evict oldest if too large
      if (articleCache.size >= MAX_ARTICLE_CACHE) {
        articleCache.delete(articleCache.keys().next().value);
      }
      articleCache.set(url, result);

      return result;
    } catch (err) {
      const reason = err.name === 'TimeoutError' ? 'timeout' : 'error';
      console.error(`[article] ${reason}: ${url} — ${err.message}`);
      return { ok: false, reason };
    } finally {
      inFlightArticleFetches.delete(url);
    }
  })();

  inFlightArticleFetches.set(url, fetchPromise);
  const result = await fetchPromise;
  if (!result.ok && result.reason === 'redirect_blocked') {
    return res.status(403).json(result);
  }
  return res.json(result);
});

// ── News feed endpoint ─────────────────────────────────────────────────────────
app.get('/api/news', async (_req, res) => {
  await firstRefresh;
  if (cache.lastUpdated && Date.now() - new Date(cache.lastUpdated).getTime() > REFRESH_INTERVAL_MS) {
    await refreshAllFeeds().catch(err => console.error('[stale-refresh]', err.message));
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    items: cache.items,
    lastUpdated: cache.lastUpdated,
    count: cache.items.length,
  });
});

app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

function shutdown(signal) {
  console.log(`[shutdown] received ${signal}, closing server…`);
  server.close(() => {
    console.log('[shutdown] HTTP server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
