import { SOURCES } from './sources.js';

// ── Domain allowlist ────────────────────────────────────────────────────────────
const EXTRA_ALLOWED_DOMAINS_BY_SOURCE = {
  bbc: ['bbc.com', 'bbc.co.uk', 'bbci.co.uk'],
  dw: ['dw.com'],
  sputnik: ['anlatilaninotesi.com.tr'],
  euronews: ['euronews.com'],
};

// Domains where full-text extraction doesn't work (SPA, JS-rendered content)
// These will always fall back to RSS summary on the frontend
const SKIP_EXTRACTION_DOMAINS = new Set([
  'anlatilaninotesi.com.tr',  // Sputnik TR — SPA, no server-rendered <p> content
  'tr.euronews.com',          // Euronews TR — SPA, content in JSON-LD only
]);

function normalizeHostname(hostname) {
  return String(hostname ?? '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

const ALLOWED_DOMAINS = new Set();
for (const source of SOURCES) {
  const feedHost = normalizeHostname(new URL(source.url).hostname);
  if (feedHost) ALLOWED_DOMAINS.add(feedHost);
  const extras = EXTRA_ALLOWED_DOMAINS_BY_SOURCE[source.id] ?? [];
  for (const host of extras) {
    const n = normalizeHostname(host);
    if (n) ALLOWED_DOMAINS.add(n);
  }
}

function isAllowedHostname(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host.startsWith('[')) return false;
  for (const allowed of ALLOWED_DOMAINS) {
    if (host === allowed || host.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

export function isAllowedUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return isAllowedHostname(u.hostname);
  } catch {
    return false;
  }
}

// ── HTML entity decoding ────────────────────────────────────────────────────────
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü', ccedil: 'ç', Ccedil: 'Ç',
  iuml: 'ï', Iuml: 'Ï', auml: 'ä', Auml: 'Ä', szlig: 'ß',
  rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201D', ldquo: '\u201C',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', bull: '\u2022',
  copy: '\u00A9', reg: '\u00AE', trade: '\u2122', euro: '\u20AC',
  pound: '\u00A3', yen: '\u00A5', cent: '\u00A2', deg: '\u00B0',
  times: '\u00D7', divide: '\u00F7', plusmn: '\u00B1', frac12: '\u00BD',
  frac14: '\u00BC', frac34: '\u00BE', laquo: '\u00AB', raquo: '\u00BB',
  iexcl: '\u00A1', iquest: '\u00BF', sect: '\u00A7', para: '\u00B6',
  micro: '\u00B5', middot: '\u00B7', cedil: '\u00B8', ordf: '\u00AA',
  ordm: '\u00BA', sup1: '\u00B9', sup2: '\u00B2', sup3: '\u00B3',
  acute: '\u00B4', eth: '\u00F0', thorn: '\u00FE',
  ntilde: '\u00F1', Ntilde: '\u00D1', agrave: '\u00E0', egrave: '\u00E8',
  igrave: '\u00EC', ograve: '\u00F2', ugrave: '\u00F9',
  aacute: '\u00E1', eacute: '\u00E9', iacute: '\u00ED', oacute: '\u00F3',
  uacute: '\u00FA', acirc: '\u00E2', ecirc: '\u00EA', icirc: '\u00EE',
  ocirc: '\u00F4', ucirc: '\u00FB', atilde: '\u00E3', otilde: '\u00F5',
  aring: '\u00E5', Aring: '\u00C5', oelig: '\u0153', OElig: '\u0152',
  scaron: '\u0161', Scaron: '\u0160',
};

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (match, name) => NAMED_ENTITIES[name] ?? match);
}

// ── Junk paragraph detection ────────────────────────────────────────────────────
// Classes that indicate a <p> is not article content
const SKIP_CLASS_PATTERNS = /text-xs|text-\[10px\]|text-\[11px\]|promo|banner|advert|cookie|consent|newsletter|subscribe|signup/i;

function extractSummary(paragraphs) {
  const filtered = paragraphs.filter(p =>
    p.length >= 60 &&
    p.length <= 800 &&
    !/^\d+[\.\)]\s/.test(p) &&
    !/internet sitesinde yayınlanan/i.test(p) &&
    !/izin alınmadan|tüm hakları saklıdır|iktibas edilemez|\.com\.tr'ye aittir|Tic\. A\.Ş/i.test(p) &&
    !/kitap dünyasına|indirimli fiyat|hayal gücünüzü|hemen keşfet|ücretsiz kargo|kampanya|fırsatı kaçırma/i.test(p) &&
    !/çerez|cookie|gizlilik politika|kişisel veri/i.test(p) &&
    !/whatsapp|telegram|uygulamamızı indirin|kanalımıza katılın|telefonunuza gelmesi için/i.test(p)
  );
  return filtered.slice(0, 3).join('\n\n');
}

export async function extractArticle(url, env) {
  // Skip extraction for domains that don't server-render article content
  try {
    const host = normalizeHostname(new URL(url).hostname);
    if (SKIP_EXTRACTION_DOMAINS.has(host)) {
      return { ok: false, reason: 'skip_domain' };
    }
  } catch { /* invalid URL — fall through to normal flow */ }

  // Check KV cache first
  const cacheKey = 'article:' + url;
  const cached = await env.NEWS_CACHE.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch { /* fall through */ }
  }

  // Fetch the page
  let response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CekirdekBot/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'timeout' : 'fetch_error';
    return { ok: false, reason };
  }

  if (!response.ok) return { ok: false, reason: `http_${response.status}` };

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    return { ok: false, reason: 'not_html' };
  }

  // Use HTMLRewriter to extract paragraphs
  const collector = { paragraphs: [] };
  let currentText = null;
  let skipCurrent = false;

  const rewriter = new HTMLRewriter()
    .on('script, style, nav, header, footer, aside, form, [class*="comment"], [class*="related"], [class*="social"], [class*="share"], [class*="widget"], [class*="sidebar"], [class*="ad-"], [class*="advertisement"], [class*="promo"], [class*="banner"], [class*="cookie"], [class*="newsletter"]', {
      element(el) {
        el.remove();
      },
    })
    .on('p', {
      element(el) {
        // Flush previous paragraph
        if (currentText !== null && !skipCurrent) {
          const decoded = decodeEntities(currentText.trim().replace(/\s+/g, ' '));
          if (decoded.length >= 30) {
            collector.paragraphs.push(decoded);
          }
        }
        // Check if this <p> should be skipped based on class
        const cls = el.getAttribute('class') || '';
        skipCurrent = SKIP_CLASS_PATTERNS.test(cls);
        currentText = '';
      },
      text(chunk) {
        if (currentText !== null && !skipCurrent) {
          currentText += chunk.text;
        }
      },
    });

  // Transform consumes the response body via streaming
  const transformed = rewriter.transform(response);
  await transformed.text();

  // Flush last paragraph
  if (currentText !== null && !skipCurrent) {
    const decoded = decodeEntities(currentText.trim().replace(/\s+/g, ' '));
    if (decoded.length >= 30) {
      collector.paragraphs.push(decoded);
    }
  }

  const content = extractSummary(collector.paragraphs);

  if (!content || content.length < 60) {
    return { ok: false, reason: 'no_content' };
  }

  const result = { ok: true, content, excerpt: '' };

  // Cache in KV (24h TTL)
  try {
    await env.NEWS_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 });
  } catch { /* KV write failed, not critical */ }

  return result;
}
