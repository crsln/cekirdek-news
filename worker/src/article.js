import { SOURCES } from './sources.js';

// ── Domain allowlist ────────────────────────────────────────────────────────────
const EXTRA_ALLOWED_DOMAINS_BY_SOURCE = {
  bbc: ['bbc.com', 'bbc.co.uk', 'bbci.co.uk'],
  dw: ['dw.com'],
};

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
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;  // IPv4
  if (host.startsWith('[')) return false;                      // IPv6
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

// ── HTMLRewriter-based article extraction ────────────────────────────────────────
class ParagraphCollector {
  constructor() {
    this.paragraphs = [];
    this.current = null;
    this.insideArticle = false;
    this.articleFound = false;
  }
}

function createRewriter(collector) {
  return new HTMLRewriter()
    .on('article', {
      element() {
        collector.insideArticle = true;
        collector.articleFound = true;
      },
    })
    .on('article', {
      // Need a separate handler to detect end — use a trick:
      // We track via p tags whether we're in article context
    })
    .on('p', {
      element(el) {
        collector.current = '';
      },
      text(chunk) {
        if (collector.current !== null) {
          collector.current += chunk.text;
        }
      },
    })
    // Use a comment handler trick: we finalize on the next element start
    .on('p', {
      element(el) {
        // This fires for the NEXT p, so we save the previous one
      },
    });
}

// Since HTMLRewriter is streaming and doesn't have a clean "element end" callback,
// we use a simpler approach: collect all <p> text, then filter.
function createSimpleRewriter(collector) {
  let currentText = null;
  let inArticle = false;
  let articleDepth = 0;

  return new HTMLRewriter()
    .on('article', {
      element() {
        inArticle = true;
        articleDepth++;
        collector.articleFound = true;
      },
    })
    .on('script, style, nav, header, footer, aside, form, [class*="comment"], [class*="related"], [class*="social"], [class*="share"], [class*="widget"], [class*="sidebar"], [class*="ad-"], [class*="advertisement"]', {
      element(el) {
        el.remove();
      },
    })
    .on('p', {
      element() {
        // Flush previous paragraph
        if (currentText !== null) {
          const trimmed = currentText.trim().replace(/\s+/g, ' ');
          if (trimmed.length >= 30) {
            collector.paragraphs.push(trimmed);
          }
        }
        currentText = '';
      },
      text(chunk) {
        if (currentText !== null) {
          currentText += chunk.text;
        }
      },
    })
    // Flush on body close
    .on('body', {
      element() {
        // Flush last paragraph when we're done
      },
    });
}

function extractSummary(paragraphs) {
  const filtered = paragraphs.filter(p =>
    p.length >= 60 &&
    p.length <= 800 &&
    !/^\d+[\.\)]\s/.test(p) &&
    !/internet sitesinde yayınlanan/i.test(p) &&
    !/izin alınmadan|tüm hakları saklıdır|iktibas edilemez|\.com\.tr'ye aittir|Tic\. A\.Ş/i.test(p)
  );
  return filtered.slice(0, 3).join('\n\n');
}

export async function extractArticle(url, env) {
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
  const collector = { paragraphs: [], articleFound: false };
  let currentText = null;

  const rewriter = new HTMLRewriter()
    .on('script, style, nav, header, footer, aside, form, [class*="comment"], [class*="related"], [class*="social"], [class*="share"], [class*="widget"], [class*="sidebar"], [class*="ad-"], [class*="advertisement"]', {
      element(el) {
        el.remove();
      },
    })
    .on('p', {
      element() {
        // Flush previous paragraph
        if (currentText !== null) {
          const trimmed = currentText.trim().replace(/\s+/g, ' ');
          if (trimmed.length >= 30) {
            collector.paragraphs.push(trimmed);
          }
        }
        currentText = '';
      },
      text(chunk) {
        if (currentText !== null) {
          currentText += chunk.text;
        }
      },
    });

  // Transform consumes the response body via streaming
  const transformed = rewriter.transform(response);
  await transformed.text(); // drain the stream

  // Flush last paragraph
  if (currentText !== null) {
    const trimmed = currentText.trim().replace(/\s+/g, ' ');
    if (trimmed.length >= 30) {
      collector.paragraphs.push(trimmed);
    }
  }

  const content = extractSummary(collector.paragraphs);

  if (!content || content.length < 60) {
    return { ok: false, reason: 'no_content' };
  }

  const result = { ok: true, content, excerpt: '' };

  // Cache in KV (24h TTL) — non-blocking
  try {
    await env.NEWS_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 });
  } catch { /* KV write failed, not critical */ }

  return result;
}
