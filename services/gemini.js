// Trip-assistant workstream: Google Gemini client. The model only fills in typed JSON fields; every value
// is re-validated in trip-assistant.js, and nothing it writes is shown to a rider as a time or a route.
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function parseJson(text) {
  const body = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { const value = JSON.parse(body.slice(start, end + 1)); return value && typeof value === 'object' ? value : null; } catch { return null; }
}

function createGemini({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 12000, retryDelayMs = 800 } = {}) {
  const key = env.GEMINI_API_KEY;
  const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  async function call(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', signal: controller.signal,
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      console.warn(controller.signal.aborted ? `Gemini request failed: no reply within ${timeoutMs} ms.` : 'Gemini request failed: could not reach Google.');
      throw Object.assign(new Error(controller.signal.aborted ? 'Gemini timed out.' : 'Gemini is unavailable.'), { status: controller.signal.aborted ? 504 : 502 });
    } finally { clearTimeout(timer); }
  }
  return {
    configured: Boolean(key),
    // Returns the model's reply as a JSON object. `schema` is a JSON Schema describing it.
    async json({ prompt, schema }) {
      if (!key) throw Object.assign(new Error('Gemini is not configured.'), { status: 503 });
      const contents = [{ parts: [{ text: `${prompt}\n\nReply with one JSON object only, matching this JSON Schema:\n${JSON.stringify(schema)}` }] }];
      let response = await call({ contents, generationConfig: { temperature: 0, responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema } } } });
      // The structured-output setting has changed names across API versions. The prompt already asks
      // for JSON, so if the setting is rejected, send the same request without it.
      if (response.status === 400) response = await call({ contents });
      // Google's servers are sometimes briefly overloaded: one short retry, never for quota errors.
      if ([500, 503].includes(response.status)) { await new Promise((r) => setTimeout(r, retryDelayMs)); response = await call({ contents }); }
      if (!response.ok) {
        // Log Google's own reason (never the key or the question) so quota, key and model problems are distinguishable.
        const detail = await response.json().catch(() => null);
        console.warn(`Gemini request failed: HTTP ${response.status} ${detail?.error?.status || ''} ${String(detail?.error?.message || '').slice(0, 160)}`.trim());
        throw Object.assign(new Error(`Gemini returned HTTP ${response.status}.`), { status: response.status === 429 ? 429 : 502 });
      }
      const data = await response.json().catch(() => null);
      const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      const value = parseJson(text);
      if (!value) {
        console.warn(`Gemini request failed: reply was not JSON (finish reason: ${data?.candidates?.[0]?.finishReason || 'none'}).`);
        throw Object.assign(new Error('Gemini did not return JSON.'), { status: 502 });
      }
      return value;
    },
  };
}

module.exports = { createGemini, parseJson };
