/**
 * PROVIDER + MODEL REGISTRY
 * ---------------------------------------------------------------
 * Single source of truth for every provider, key, model, and its
 * free-tier limits. Numbers below were verified via live web search
 * (Sep 2026) against multiple independent sources — see the comment
 * above each provider for what was confirmed and what's still a
 * best-effort estimate.
 *
 * HOW TO ADD A NEW PROVIDER KEY:
 *   Add another entry to that provider's `keys` array — set the
 *   matching env var in Vercel. No code changes needed.
 *
 * HOW TO ADD A NEW MODEL:
 *   Add it to the provider's `models` array with category + limits.
 *
 * CATEGORIES:
 *   "text"         -> text in, text out (chat / reasoning)
 *   "vision"       -> image + text in, text out
 *   "image_gen"    -> text in, image out
 *   "multilingual" -> text in, text out, strong multilingual support
 *     (a model can belong to multiple categories, e.g. ["text","multilingual"])
 *
 * orgLevelLimit: true
 *   IMPORTANT — means this provider's rate limit is shared across
 *   ALL keys under the same account/org. Adding more keys from the
 *   SAME account does NOT multiply your quota. To actually get more
 *   headroom via rotation on these providers, each key must come
 *   from a SEPARATE account (separate email/signup).
 *   Confirmed org-level: Groq, Google AI Studio (project-level),
 *   Cloudflare (account-level neuron pool).
 *   Confirmed per-key/account (rotation genuinely multiplies quota):
 *   OpenRouter.
 */

function keysFromEnv(prefix) {
  const keys = [];
  let i = 1;
  while (process.env[`${prefix}_${i}`]) {
    keys.push({ id: `${prefix}_${i}`, value: process.env[`${prefix}_${i}`] });
    i++;
  }
  return keys;
}

const REGISTRY = {
  groq: {
    name: "Groq",
    orgLevelLimit: true, // confirmed: limits are per-organization, not per-key
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    keys: keysFromEnv("GROQ_KEY"),
    // Verified against console.groq.com/docs/rate-limits + multiple
    // independent trackers, Sep 2026. Per-model RPD/TPM varies a lot —
    // use these, not one flat number for all models.
    models: [
      {
        id: "llama-3.3-70b-versatile",
        categories: ["text", "multilingual"],
        contextWindow: 128000,
        maxOutputTokens: 32768,
        limits: { rpm: 30, rpd: 1000, tpm: 12000 },
      },
      {
        id: "llama-3.1-8b-instant",
        categories: ["text", "multilingual"],
        contextWindow: 128000,
        maxOutputTokens: 8192,
        limits: { rpm: 30, rpd: 14400, tpm: 6000 }, // highest RPD on Groq free tier
      },
      {
        id: "deepseek-r1-distill-llama-70b",
        categories: ["text"], // reasoning/thinking model
        contextWindow: 128000,
        maxOutputTokens: 32768,
        limits: { rpm: 30, rpd: 1000, tpm: 6000 },
      },
      {
        id: "meta-llama/llama-4-scout-17b-16e-instruct",
        categories: ["vision", "text"],
        contextWindow: 131072,
        maxOutputTokens: 8192,
        limits: { rpm: 30, rpd: 1000, tpm: 30000 },
      },
      {
        id: "meta-llama/llama-4-maverick-17b-128e-instruct",
        categories: ["vision", "text", "multilingual"],
        contextWindow: 131072,
        maxOutputTokens: 8192,
        limits: { rpm: 15, rpd: 500, tpm: 3000 }, // Maverick is tighter than Scout
      },
    ],
  },

  google_ai_studio: {
    name: "Google AI Studio",
    orgLevelLimit: true, // confirmed: limits apply per Google Cloud PROJECT, not per key
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    authHeader: () => ({}),
    keys: keysFromEnv("GOOGLE_AI_KEY"),
    // Verified Sep 2026: sources disagree slightly (10-15 RPM, 250-1500 RPD
    // depending on which snapshot), which itself confirms Google's own
    // warning that these change often. Using the more commonly-cited
    // current numbers; RE-CHECK at aistudio.google.com/rate-limit
    // periodically since your own dashboard shows YOUR live limits.
    // NOTE: to rotate keys meaningfully here, each key needs its own
    // Google Cloud PROJECT (can be under the same or different Google
    // accounts) — a second key on the same project shares the same cap.
    models: [
      {
        id: "gemini-2.5-flash",
        categories: ["text", "vision", "multilingual"],
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        limits: { rpm: 10, rpd: 250, tpm: 250000 },
      },
      {
        id: "gemini-2.5-flash-lite",
        categories: ["text", "vision", "multilingual"],
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        limits: { rpm: 15, rpd: 1000, tpm: 250000 },
      },
      {
        id: "gemini-2.0-flash",
        categories: ["text", "vision", "multilingual"],
        contextWindow: 1048576,
        maxOutputTokens: 8192,
        limits: { rpm: 15, rpd: 1500, tpm: 1000000 },
      },
      // NOTE: Gemini 2.5 Pro removed from free tier as of April 2026
      // (confirmed by multiple sources) — paid-only now, not listed here.
      // NOTE: Imagen (Google's image-gen model) is NOT available on the
      // free tier via the standard API — that's why there's no
      // image_gen model under Google below.
    ],
  },

  openrouter: {
    name: "OpenRouter",
    orgLevelLimit: false, // confirmed: limit is per-account/key, rotation genuinely helps
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    keys: keysFromEnv("OPENROUTER_KEY"),
    // Verified Sep 2026 across 8 independent sources, all consistent:
    // 20 rpm always, 50 rpd on accounts with <$10 lifetime credit,
    // 1000 rpd once you've ever bought $10+ credit (permanent unlock,
    // even if balance drops back to $0 after).
    models: [
      {
        id: "deepseek/deepseek-chat-v3.1:free",
        categories: ["text", "multilingual"],
        contextWindow: 163840,
        maxOutputTokens: 8192,
        limits: { rpm: 20, rpd: 50, tpm: null },
      },
      {
        id: "deepseek/deepseek-r1:free",
        categories: ["text"], // reasoning
        contextWindow: 163840,
        maxOutputTokens: 8192,
        limits: { rpm: 20, rpd: 50, tpm: null },
      },
      {
        id: "meta-llama/llama-3.2-11b-vision-instruct:free",
        categories: ["vision", "text"],
        contextWindow: 131072,
        maxOutputTokens: 4096,
        limits: { rpm: 20, rpd: 50, tpm: null },
      },
      {
        id: "qwen/qwen2.5-vl-32b-instruct:free",
        categories: ["vision", "text", "multilingual"],
        contextWindow: 131072,
        maxOutputTokens: 8192,
        limits: { rpm: 20, rpd: 50, tpm: null },
      },
      {
        id: "google/gemma-3-27b-it:free",
        categories: ["text", "multilingual"],
        contextWindow: 96000,
        maxOutputTokens: 8192,
        limits: { rpm: 20, rpd: 50, tpm: null },
      },
    ],
    // TIP: check https://openrouter.ai/models?max_price=0 for the
    // current live list — free models rotate in/out of availability.
  },

  cloudflare: {
    name: "Cloudflare Workers AI",
    orgLevelLimit: true, // confirmed: 10,000 neurons/day shared across ALL models on the account
    baseUrl: (accountId) =>
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`,
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    keys: keysFromEnv("CF_KEY").map((k, i) => ({
      ...k,
      accountId: process.env[`CF_ACCOUNT_ID_${i + 1}`],
    })),
    // Verified Sep 2026: 10,000 neurons/day, resets 00:00 UTC. Text
    // generation default rate limit ~300 req/min but overridden per
    // model (150-1,500 rpm range) — 50 rpm below is a conservative
    // floor, real ceiling is usually higher but the neuron budget
    // runs out first anyway for most usage patterns.
    models: [
      {
        id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        categories: ["text", "multilingual"],
        contextWindow: 24000,
        maxOutputTokens: 4096,
        limits: { rpm: 50, rpd: null, tpm: null }, // neuron-budget limited, not a hard rpd
      },
      {
        id: "@cf/meta/llama-3.2-11b-vision-instruct",
        categories: ["vision", "text"],
        contextWindow: 128000,
        maxOutputTokens: 4096,
        limits: { rpm: 50, rpd: null, tpm: null },
      },
      {
        id: "@cf/black-forest-labs/flux-1-schnell",
        categories: ["image_gen"],
        contextWindow: null,
        maxOutputTokens: null,
        limits: { rpm: 20, rpd: null, tpm: null },
      },
      {
        id: "@cf/stabilityai/stable-diffusion-xl-base-1.0",
        categories: ["image_gen"],
        contextWindow: null,
        maxOutputTokens: null,
        limits: { rpm: 20, rpd: null, tpm: null },
      },
    ],
  },

  pollinations: {
    name: "Pollinations",
    orgLevelLimit: false,
    baseUrl: "https://image.pollinations.ai/prompt",
    authHeader: () => ({}),
    // CORRECTED (Sep 2026): Pollinations moved to a pk_/sk_ key system
    // via enter.pollinations.ai. Anonymous no-key access still works
    // for Flux images but is now tightly capped at ~1 request per 15
    // seconds (NOT the old "practically unlimited" behavior) and
    // carries a watermark. An sk_ (secret/server-side) key removes
    // the watermark and the anonymous rate cap. Get one free at
    // enter.pollinations.ai if you want this to be a reliable
    // fallback rather than a last-resort option.
    keys:
      keysFromEnv("POLLINATIONS_KEY").length > 0
        ? keysFromEnv("POLLINATIONS_KEY")
        : [{ id: "POLLINATIONS_ANON", value: "nokey" }], // works without a key, but rate-capped
    models: [
      {
        id: "flux",
        categories: ["image_gen"],
        contextWindow: null,
        maxOutputTokens: null,
        // ~1 req/15s anonymous (=4 rpm); much higher with an sk_ key.
        limits: { rpm: 4, rpd: null, tpm: null },
      },
      {
        id: "turbo",
        categories: ["image_gen"],
        contextWindow: null,
        maxOutputTokens: null,
        limits: { rpm: 4, rpd: null, tpm: null },
      },
    ],
  },
};

module.exports = { REGISTRY };
