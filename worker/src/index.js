import { refreshFeeds } from './rss.js';

// cekirdek-api Worker
// KV binding: env.NEWS_CACHE (bound to NEWS_CACHE namespace in wrangler.toml)
// KV key used in later phases: "news:all"

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

      // Phase 3 will wrap this: read KV first, call refreshFeeds() on miss, write KV.
      // env.NEWS_CACHE is available for future KV reads/writes — not used here.
      const payload = await refreshFeeds();

      return new Response(JSON.stringify(payload), {
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
   * Phase 4 will implement RSS fetch and KV write here.
   * @param {ScheduledEvent} event
   * @param {Env} env
   * @param {ExecutionContext} ctx
   */
  async scheduled(event, env, ctx) {
    console.log("Cron triggered");
  },
};
