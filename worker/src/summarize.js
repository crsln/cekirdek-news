// Batch AI summarization via Gemini API (free tier)
// Summarizes multiple articles in a single API call using structured JSON output.
// Falls back gracefully — returns empty object on any failure.

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

/**
 * Summarize multiple articles in a single Gemini API call.
 * @param {Array<{id: string, title: string, summary: string}>} articles
 * @param {Env} env - must have env.GEMINI_API_KEY
 * @returns {Promise<Record<string, string>>} Map of article ID → AI summary
 */
export async function batchSummarize(articles, env) {
  if (!env.GEMINI_API_KEY || articles.length === 0) return {};

  const articleList = articles.map(a =>
    `<article id="${a.id}">\n${a.title}\n${a.summary || ''}\n</article>`
  ).join('\n');

  try {
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{
            text: `Asagidaki Turkce haberlerin her birini 2-3 cumleyle ozetle.\nHer ozet sade, bilgilendirici ve Turkce olmali. Markdown veya HTML kullanma.\n\n${articleList}`
          }]
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object',
            properties: {
              summaries: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    summary: { type: 'string' }
                  },
                  required: ['id', 'summary']
                }
              }
            },
            required: ['summaries']
          },
          temperature: 0.3,
          maxOutputTokens: 3000,
        }
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return {};

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return {};

    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.summaries)) return {};

    const validIds = new Set(articles.map(a => a.id));
    const result = {};
    for (const item of parsed.summaries) {
      if (item.id && item.summary && validIds.has(item.id)) {
        result[item.id] = item.summary.slice(0, 500);
      }
    }
    return result;
  } catch {
    return {};
  }
}
