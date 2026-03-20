import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// These imports will fail until rss.js and sources.js are created (Wave 0 → RED)
import { cleanSummary, isBlocked, isSourceSectionBlocked, fetchSource, refreshFeeds } from './rss.js';
import { SOURCES, MAX_ITEMS_PER_SOURCE } from './sources.js';

// --- cleanSummary tests ---
describe('cleanSummary', () => {
  it('strips diken noise: first line, hashtags, date, brand, site_linkat, appeared first on', () => {
    const raw = 'İlk satır başlık tekrarı\nGerçek içerik burada. #haber 20.03.2026 Diken site_linkat appeared first on .';
    const result = cleanSummary(raw, 'diken');
    expect(result).not.toContain('İlk satır başlık tekrarı');
    expect(result).not.toMatch(/#\w+/);
    expect(result).not.toMatch(/\d{2}\.\d{2}\.\d{4}/);
    expect(result).not.toContain('Diken');
    expect(result).not.toContain('site_linkat');
    expect(result).not.toContain('appeared first on');
    expect(result.trim()).toBe('Gerçek içerik burada.');
  });

  it('strips bianet city code suffix like (ANK)', () => {
    const raw = 'Meclis bu hafta toplanıyor. (ANK)';
    const result = cleanSummary(raw, 'bianet');
    expect(result).not.toContain('(ANK)');
    expect(result.trim()).toBe('Meclis bu hafta toplanıyor.');
  });

  it('strips medyascope brand and trailing short line', () => {
    const raw = 'Detaylı bir analiz içeriği. Medyascope appeared first on .\nDevamını oku';
    const result = cleanSummary(raw, 'medyascope');
    expect(result).not.toContain('Medyascope');
    expect(result).not.toContain('appeared first on');
    expect(result).not.toContain('Devamını oku');
  });

  it('does not modify non-targeted source summaries', () => {
    const raw = 'Normal haber içeriği buradadır.';
    expect(cleanSummary(raw, 'ntv')).toBe(raw);
  });

  it('truncates output to 600 chars', () => {
    const raw = 'a'.repeat(700);
    expect(cleanSummary(raw, 'ntv').length).toBeLessThanOrEqual(600);
  });
});

// --- isBlocked tests ---
describe('isBlocked', () => {
  it('returns true for title containing "burç"', () => {
    expect(isBlocked('Koç burcu yorumu', '')).toBe(true);
  });

  it('returns true for title containing "astroloji"', () => {
    expect(isBlocked('Astroloji haberleri', '')).toBe(true);
  });

  it('returns true for summary containing "horoscope"', () => {
    expect(isBlocked('Normal başlık', 'daily horoscope readings')).toBe(true);
  });

  it('returns false for normal news', () => {
    expect(isBlocked('Erdoğan açıklama yaptı', 'Cumhurbaşkanı konuştu.')).toBe(false);
  });
});

// --- isSourceSectionBlocked tests ---
describe('isSourceSectionBlocked', () => {
  it('blocks cumhuriyet resmi-ilanlar by path', () => {
    expect(isSourceSectionBlocked('cumhuriyet', 'https://cumhuriyet.com.tr/resmi-ilanlar/12345', [])).toBe(true);
  });

  it('blocks hurriyet resmi-ilanlar by path', () => {
    expect(isSourceSectionBlocked('hurriyet', 'https://hurriyet.com.tr/resmi-ilanlar/xyz', [])).toBe(true);
  });

  it('blocks cumhuriyet resmi-ilanlar by category', () => {
    expect(isSourceSectionBlocked('cumhuriyet', 'https://cumhuriyet.com.tr/haber/123', ['resmi ilanlar'])).toBe(true);
  });

  it('does not block ntv even with matching path', () => {
    expect(isSourceSectionBlocked('ntv', 'https://ntv.com.tr/resmi-ilanlar/1', [])).toBe(false);
  });

  it('does not block normal hurriyet article', () => {
    expect(isSourceSectionBlocked('hurriyet', 'https://hurriyet.com.tr/gundem/haber', [])).toBe(false);
  });
});

// --- sources shape tests ---
describe('SOURCES', () => {
  it('has exactly 10 sources', () => {
    expect(SOURCES).toHaveLength(10);
  });

  it('each source has id, label, color, url', () => {
    SOURCES.forEach(s => {
      expect(s.id).toBeTruthy();
      expect(s.label).toBeTruthy();
      expect(s.color).toBeTruthy();
      expect(s.url).toMatch(/^https?:\/\//);
    });
  });

  it('MAX_ITEMS_PER_SOURCE is a positive number', () => {
    expect(typeof MAX_ITEMS_PER_SOURCE).toBe('number');
    expect(MAX_ITEMS_PER_SOURCE).toBeGreaterThan(0);
  });
});

// --- fetchSource tests ---
describe('fetchSource', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses diken XML fixture and filters blocked item', async () => {
    const xml = readFileSync(join(__dirname, 'fixtures/diken.xml'), 'utf-8');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => xml,
    }));
    const source = SOURCES.find(s => s.id === 'diken');
    const items = await fetchSource(source);
    expect(items.length).toBe(1);
    expect(items[0].title).toBe('Erdoğan konuştu');
    expect(items[0].summary).not.toContain('İlk satır başlık tekrarı');
    expect(items[0].summary).not.toContain('#haber');
  });

  it('returns empty array when feed returns non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const source = SOURCES[0];
    const items = await fetchSource(source);
    expect(items).toEqual([]);
  });

  it('returns empty array when fetch throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));
    const source = SOURCES[0];
    const items = await fetchSource(source);
    expect(items).toEqual([]);
  });

  it('item has all 8 required fields', async () => {
    const xml = readFileSync(join(__dirname, 'fixtures/bianet.xml'), 'utf-8');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => xml,
    }));
    const source = SOURCES.find(s => s.id === 'bianet');
    const items = await fetchSource(source);
    expect(items.length).toBeGreaterThan(0);
    const item = items[0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('title');
    expect(item).toHaveProperty('link');
    expect(item).toHaveProperty('pubDate');
    expect(item).toHaveProperty('summary');
    expect(item).toHaveProperty('source');
    expect(item).toHaveProperty('sourceLabel');
    expect(item).toHaveProperty('sourceColor');
  });
});

// --- refreshFeeds tests ---
describe('refreshFeeds', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns { items, lastUpdated, count } shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const result = await refreshFeeds();
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('lastUpdated');
    expect(result).toHaveProperty('count');
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.count).toBe(result.items.length);
  });

  it('does not throw when all sources fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('All down')));
    await expect(refreshFeeds()).resolves.not.toThrow();
  });
});
