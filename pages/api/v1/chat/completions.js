const { checkMasterKey } = require("../../../../lib/auth");
const { routeRequest } = require("../../../../lib/router");
const { applyCors } = require("../../../../lib/cors");

/**
 * POST /api/v1/chat/completions
 * OpenAI-compatible endpoint. Point any OpenAI SDK / client at this
 * URL with your master key, and it works like normal chat completions.
 *
 * Body:
 * {
 *   "messages": [{ "role": "user", "content": "hello" }],
 *   "category": "text" | "vision" | "multimodal",        // default: "text"
 *   "provider": "groq" | "openrouter" | "google_ai_studio" | "cloudflare", // optional, force a provider
 *   "model": "specific-model-id",                       // optional, force a model
 *   "sort_by": "contextWindow" | "maxOutputTokens"       // optional, default "contextWindow"
 * }
 *
 * "vision" routes across every vision-capable model. "multimodal" is a
 * curated subset — single models that natively do text+image in / text
 * out as a first-class feature (currently qwen/qwen3.6-27b on Groq,
 * plus the same Gemini/OpenRouter/Cloudflare vision models). Use
 * "vision" for the widest fallback pool, "multimodal" if you
 * specifically want one of the do-everything models.
 *
 * Vision requests: use OpenAI's standard multi-part content format:
 *   { "role": "user", "content": [
 *       { "type": "text", "text": "what's in this image?" },
 *       { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
 *   ]}
 */
export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const auth = checkMasterKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.message });
  }

  const {
    messages,
    category = "text",
    provider = null,
    model = null,
    sort_by = "contextWindow",
    ...rest
  } = req.body || {};

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "`messages` array is required." });
  }

  const result = await routeRequest({
    category,
    payload: { messages, ...rest },
    preferredProvider: provider,
    preferredModel: model,
    sortBy: sort_by,
  });

  if (result.error) {
    return res.status(result.status || 500).json({
      error: result.message,
      attempts: result.attempts || [],
    });
  }

  res.setHeader("X-Gateway-Provider", result.provider);
  res.setHeader("X-Gateway-Model", result.model);
  res.setHeader("X-Gateway-Key-Used", result.keyUsed);

  return res.status(200).json(result.data);
}
