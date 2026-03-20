// Source: Cloudflare Workers KV API https://developers.cloudflare.com/kv/api/
// Source: ctx.waitUntil() https://developers.cloudflare.com/workers/runtime-apis/context/
import { refreshFeeds } from './rss.js';

// cekirdek-api Worker
// KV binding: env.NEWS_CACHE (bound to NEWS_CACHE namespace in wrangler.toml)
// Active usage: read on every request, write on cache miss via ctx.waitUntil()

const CACHE_KEY = 'news:all';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes in milliseconds

// Source: Cloudflare Workers CORS https://developers.cloudflare.com/workers/examples/cors-header-proxy/
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://cigdem.xyz",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

/**
 * handleOptions — handles CORS preflight and plain OPTIONS requests
 * Preflight: Origin + Access-Control-Request-Method + Access-Control-Request-Headers present → 204 with CORS headers
 * Plain OPTIONS: no preflight headers → 204 without CORS headers
 * @param {Request} request
 * @returns {Response}
 */
function handleOptions(request) {
  const origin = request.headers.get('Origin');
  const requestMethod = request.headers.get('Access-Control-Request-Method');
  const requestHeaders = request.headers.get('Access-Control-Request-Headers');

  if (origin && requestMethod && requestHeaders) {
    // Valid preflight — respond with full CORS headers
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Plain OPTIONS — no CORS headers
  return new Response(null, { status: 204 });
}

/**
 * refreshAndCache — shared helper used by both fetch (cache-miss) and scheduled handler
 * Calls refreshFeeds(), writes result to KV via ctx.waitUntil(), returns fresh data.
 * @param {Env} env - contains env.NEWS_CACHE (KV namespace)
 * @param {ExecutionContext} ctx
 * @returns {Promise<object>} fresh feed data
 */
async function refreshAndCache(env, ctx) {
  const fresh = await refreshFeeds();
  ctx.waitUntil(
    env.NEWS_CACHE.put(CACHE_KEY, JSON.stringify(fresh), { expirationTtl: 300 })
  );
  return fresh;
}

export default {
  /**
   * fetch handler — serves HTTP requests
   * @param {Request} request
   * @param {Env} env - contains env.NEWS_CACHE (KV namespace)
   * @param {ExecutionContext} ctx
   * @returns {Response}
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // OPTIONS — handle preflight and plain OPTIONS before route matching
    if (request.method === "OPTIONS") return handleOptions(request);

    if (pathname === "/api/news") {
      if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
        });
      }

      // CACHE-01: Read from KV — returns null if key missing or expired
      const cached = await env.NEWS_CACHE.get(CACHE_KEY, { type: 'json' });
      if (cached && cached.lastUpdated) {
        const age = Date.now() - new Date(cached.lastUpdated).getTime();
        if (age < CACHE_TTL_MS) {
          return new Response(JSON.stringify(cached), {
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
          });
        }
      }

      // CACHE-02: Miss or stale — fetch fresh data and write to KV (shared helper)
      const fresh = await refreshAndCache(env, ctx);

      return new Response(JSON.stringify(fresh), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
    });
  },

  /**
   * scheduled handler — cron trigger (every 15 minutes)
   * Pre-warms the KV cache so requests almost always hit warm cache.
   * @param {ScheduledController} controller
   * @param {Env} env
   * @param {ExecutionContext} ctx
   */
  async scheduled(controller, env, ctx) {
    await refreshAndCache(env, ctx);
  },
};
