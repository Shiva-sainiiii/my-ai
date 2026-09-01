const { checkMasterKey } = require("../../../../lib/auth");
const { routeRequest } = require("../../../../lib/router");

/**
 * POST /api/v1/images/generations
 * OpenAI-compatible-ish image generation endpoint.
 *
 * Body:
 * {
 *   "prompt": "a cat riding a skateboard",
 *   "provider": "cloudflare" | "pollinations",   // optional, force one
 *   "model": "flux",                              // optional, force one
 *   "response_format": "b64_json"                 // only b64_json supported for now
 * }
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const auth = checkMasterKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.message });
  }

  const { prompt, provider = null, model = null } = req.body || {};

  if (!prompt) {
    return res.status(400).json({ error: "`prompt` is required." });
  }

  const result = await routeRequest({
    category: "image_gen",
    payload: { prompt },
    preferredProvider: provider,
    preferredModel: model,
  });

  if (result.error) {
    return res.status(result.status || 500).json({
      error: result.message,
      attempts: result.attempts || [],
    });
  }

  res.setHeader("X-Gateway-Provider", result.provider);
  res.setHeader("X-Gateway-Model", result.model);

  return res.status(200).json({
    created: Math.floor(Date.now() / 1000),
    data: [{ b64_json: result.data.image_base64 }],
  });
}
