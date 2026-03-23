import { XMLParser } from 'fast-xml-parser';
import { SOURCES, MAX_ITEMS_PER_SOURCE } from './sources.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['item', 'category'].includes(name),
  processEntities: true,
});

function stripHtml(str) {
  return String(str ?? '').replace(/<[^>]*>/g, '');
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

// Source: origin/master:serve.mjs lines 89-119
function cleanSummary(raw, sourceId) {
  let s = raw.replace(/<[^>]*>/g, '');

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

// Source: origin/master + fix/hurriyet-resmi-ilanlar:serve.mjs
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

async function fetchSource(source) {
  try {
    const resp = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TurkishNewsBot/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return [];
    const xml = await resp.text();
    const parsed = xmlParser.parse(xml);
    const items = parsed?.rss?.channel?.item ?? [];
    return items.slice(0, MAX_ITEMS_PER_SOURCE).map(item => {
      const title = decodeEntities(String(item.title ?? '').trim());
      const link = String(item.link ?? '');
      const rawDesc = String(item.description ?? '');
      const rawEncoded = String(item['content:encoded'] ?? '');
      const s1 = stripHtml(rawDesc);
      const s2 = stripHtml(rawEncoded);
      let rawSnippet;
      if (source.id === 'diken') {
        // Diken description has junk outside <p> — extract <p> content from raw HTML
        const pText = extractParagraphs(rawDesc) || extractParagraphs(rawEncoded);
        rawSnippet = pText.length > 20 ? pText : (s2.length > 20 ? s2 : s1);
      } else {
        rawSnippet = s1.length >= s2.length ? s1 : s2;
      }
      let summary = cleanSummary(decodeEntities(rawSnippet), source.id);
      // Fallback: if summary is too short after cleanup, try the other field
      if (summary.length < 20 && s2.length > 20 && rawSnippet !== s2) {
        summary = cleanSummary(decodeEntities(s2), source.id);
      }
      const categories = Array.isArray(item.category) ? item.category.map(String) : [];
      const guidRaw = item.guid;
      const guid = typeof guidRaw === 'object' ? guidRaw?.['#text'] : guidRaw;
      if (isBlocked(title, summary) || isSourceSectionBlocked(source.id, link, categories)) {
        return null;
      }
      return {
        id: `${source.id}::${link || guid || title}`,
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

async function refreshFeeds() {
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
  return {
    items: allItems,
    lastUpdated: new Date().toISOString(),
    count: allItems.length,
  };
}

export { fetchSource, refreshFeeds, cleanSummary, isBlocked, isSourceSectionBlocked };
