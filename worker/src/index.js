// Source: Cloudflare Workers KV API https://developers.cloudflare.com/kv/api/
// Source: ctx.waitUntil() https://developers.cloudflare.com/workers/runtime-apis/context/
import { refreshFeeds } from './rss.js';

// cekirdek-api Worker
// KV binding: env.NEWS_CACHE (bound to NEWS_CACHE namespace in wrangler.toml)
// Active usage: read on every request, write on cache miss via ctx.waitUntil()

const CACHE_KEY = 'news:all';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes in milliseconds

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

    if (pathname === "/api/news") {
      if (request.method !== "GET") {
        return Response.json(
          { error: "Method not allowed" },
          { status: 405, headers: { "Content-Type": "application/json; charset=utf-8" } }
        );
      }

      // CACHE-01: Read from KV — returns null if key missing or expired
      const cached = await env.NEWS_CACHE.get(CACHE_KEY, { type: 'json' });
      if (cached && cached.lastUpdated) {
        const age = Date.now() - new Date(cached.lastUpdated).getTime();
        if (age < CACHE_TTL_MS) {
          return new Response(JSON.stringify(cached), {
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          });
        }
      }

      // CACHE-02: Miss or stale — fetch fresh data and write to KV (shared helper)
      const fresh = await refreshAndCache(env, ctx);

      return new Response(JSON.stringify(fresh), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    return Response.json(
      { error: "Not found" },
      { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
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
