// Batch AI summarization with Gemini (primary) and Groq (fallback).
// Summarizes multiple articles in a single API call using structured JSON output.
// Falls back gracefully — returns empty object on any failure.

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const PROMPT = 'Asagidaki Turkce haberlerin her birini 2-3 cumleyle ozetle.\nHer ozet sade, bilgilendirici ve Turkce olmali. Markdown veya HTML kullanma.\nJSON formatinda cevap ver: {"summaries": [{"id": "...", "summary": "..."}]}';

function buildArticleList(articles) {
  return articles.map(a =>
    `<article id="${a.id}">\n${a.title}\n${a.summary || ''}\n</article>`
  ).join('\n');
}

function parseResponse(text, articles) {
  const parsed = JSON.parse(text);
  const arr = Array.isArray(parsed.summaries) ? parsed.summaries : [];
  const validIds = new Set(articles.map(a => a.id));
  const result = {};
  for (const item of arr) {
    if (item.id && item.summary && validIds.has(item.id)) {
      result[item.id] = item.summary.slice(0, 500);
    }
  }
  return result;
}

async function summarizeViaGemini(articles, apiKey) {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: `${PROMPT}\n\n${buildArticleList(articles)}` }]
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

  if (!res.ok) throw new Error(`Gemini ${res.status}`);

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini empty response');

  return parseResponse(text, articles);
}

async function summarizeViaGroq(articles, apiKey) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: buildArticleList(articles) }
      ],
      temperature: 0.3,
      max_tokens: 3000,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Groq ${res.status}`);

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq empty response');

  return parseResponse(text, articles);
}

/**
 * Summarize articles: tries Gemini first, falls back to Groq.
 * @param {Array<{id: string, title: string, summary: string}>} articles
 * @param {Env} env - env.GEMINI_API_KEY and/or env.GROQ_API_KEY
 * @returns {Promise<Record<string, string>>} Map of article ID → AI summary
 */
export async function batchSummarize(articles, env) {
  if (articles.length === 0) return {};
  if (!env.GEMINI_API_KEY && !env.GROQ_API_KEY) return {};

  // Try Gemini first
  if (env.GEMINI_API_KEY) {
    try {
      return await summarizeViaGemini(articles, env.GEMINI_API_KEY);
    } catch {
      // Fall through to Groq
    }
  }

  // Fallback to Groq
  if (env.GROQ_API_KEY) {
    try {
      return await summarizeViaGroq(articles, env.GROQ_API_KEY);
    } catch {
      return {};
    }
  }

  return {};
}
