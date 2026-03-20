import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index.js';

// Mock refreshFeeds to avoid real network calls
vi.mock('./rss.js', () => ({
  refreshFeeds: vi.fn().mockResolvedValue({
    items: [
      {
        id: 'test::1',
        title: 'Test Haberi',
        link: 'https://example.com/test',
        pubDate: null,
        summary: 'Test özeti.',
        source: 'ntv',
        sourceLabel: 'NTV',
        sourceColor: '#117a65',
      },
    ],
    lastUpdated: new Date().toISOString(),
    count: 1,
  }),
}));

function makeEnv(kvGetResult = null) {
  return {
    NEWS_CACHE: {
      get: vi.fn().mockResolvedValue(kvGetResult),
      put: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function makeCtx() {
  return { waitUntil: vi.fn() };
}

function makeRequest(method = 'GET') {
  return new Request('http://localhost/api/news', { method });
}

function makeController(cron = '*/15 * * * *') {
  return { cron, scheduledTime: Date.now(), type: 'scheduled' };
}

describe('GET /api/news — KV caching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches fresh data when KV returns null (cache miss)', async () => {
    const { refreshFeeds } = await import('./rss.js');
    const env = makeEnv(null);
    const ctx = makeCtx();
    const req = makeRequest();

    const response = await worker.fetch(req, env, ctx);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('count');
    expect(body).toHaveProperty('lastUpdated');
    expect(env.NEWS_CACHE.get).toHaveBeenCalledWith('news:all', { type: 'json' });
    expect(refreshFeeds).toHaveBeenCalled();
  });

  it('returns cached data without calling refreshFeeds when cache is fresh', async () => {
    const { refreshFeeds } = await import('./rss.js');
    const cachedPayload = {
      items: [{ id: 'cached::1', title: 'Eski haber', link: 'https://example.com/cached', pubDate: null, summary: '', source: 'ntv', sourceLabel: 'NTV', sourceColor: '#117a65' }],
      lastUpdated: new Date().toISOString(), // just now — fresh
      count: 1,
    };
    const env = makeEnv(cachedPayload);
    const ctx = makeCtx();
    const req = makeRequest();

    const response = await worker.fetch(req, env, ctx);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items[0].id).toBe('cached::1');
    expect(vi.mocked(refreshFeeds).mock.calls.length).toBe(0);
  });

  it('fetches fresh data when cache is stale (>5 min)', async () => {
    const { refreshFeeds } = await import('./rss.js');
    const stalePayload = {
      items: [],
      lastUpdated: new Date(Date.now() - 6 * 60 * 1000).toISOString(), // 6 minutes ago
      count: 0,
    };
    const env = makeEnv(stalePayload);
    const ctx = makeCtx();
    const req = makeRequest();

    await worker.fetch(req, env, ctx);

    expect(vi.mocked(refreshFeeds).mock.calls.length).toBe(1);
  });

  it('writes fresh data to KV with expirationTtl 300 on cache miss', async () => {
    const env = makeEnv(null);
    const ctx = makeCtx();
    const req = makeRequest();

    await worker.fetch(req, env, ctx);

    expect(env.NEWS_CACHE.put).toHaveBeenCalled();
    const putCall = env.NEWS_CACHE.put.mock.calls[0];
    expect(putCall[0]).toBe('news:all');
    // putCall[1] is the JSON string — check it parses correctly
    expect(() => JSON.parse(putCall[1])).not.toThrow();
    expect(putCall[2]).toEqual({ expirationTtl: 300 });
  });

  it('uses ctx.waitUntil for non-blocking KV write', async () => {
    const env = makeEnv(null);
    const ctx = makeCtx();
    const req = makeRequest();

    await worker.fetch(req, env, ctx);

    expect(ctx.waitUntil).toHaveBeenCalled();
    const waitUntilArg = ctx.waitUntil.mock.calls[0][0];
    // The argument should be a Promise (the KV put return value)
    expect(waitUntilArg).toBeInstanceOf(Promise);
  });
});

describe('scheduled handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls refreshFeeds and writes to KV', async () => {
    const { refreshFeeds } = await import('./rss.js');
    const env = makeEnv();
    const ctx = makeCtx();

    await worker.scheduled(makeController(), env, ctx);

    expect(refreshFeeds).toHaveBeenCalled();
    expect(env.NEWS_CACHE.put).toHaveBeenCalledWith(
      'news:all',
      expect.any(String),
      { expirationTtl: 300 }
    );
    // Verify the JSON string is valid
    const putCall = env.NEWS_CACHE.put.mock.calls[0];
    expect(() => JSON.parse(putCall[1])).not.toThrow();
  });

  it('uses ctx.waitUntil for the KV write', async () => {
    const env = makeEnv();
    const ctx = makeCtx();

    await worker.scheduled(makeController(), env, ctx);

    expect(ctx.waitUntil).toHaveBeenCalled();
    const waitUntilArg = ctx.waitUntil.mock.calls[0][0];
    expect(waitUntilArg).toBeInstanceOf(Promise);
  });
});

describe('refreshAndCache — shared logic (CRON-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetch cache-miss path uses refreshAndCache (no duplicate logic)', async () => {
    const { refreshFeeds } = await import('./rss.js');

    // fetch cache-miss path
    await worker.fetch(makeRequest(), makeEnv(null), makeCtx());
    expect(vi.mocked(refreshFeeds).mock.calls.length).toBe(1);

    vi.clearAllMocks();

    // scheduled handler path
    await worker.scheduled(makeController(), makeEnv(), makeCtx());
    expect(vi.mocked(refreshFeeds).mock.calls.length).toBe(1);
  });
});
