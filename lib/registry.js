/**
 * PROVIDER + MODEL REGISTRY
 * ---------------------------------------------------------------
 * Single source of truth for every provider, key, model, and its
 * free-tier limits. Numbers below were re-verified via live web
 * search (Sep 2026) against multiple independent sources — see the
 * comment above each provider for what was confirmed and what's
 * still a best-effort estimate.
 *
 * SEP 2026 CORRECTION PASS — what changed and why:
 *   - Groq: llama-3.3-70b-versatile, llama-3.1-8b-instant,
 *     llama-4-scout-17b-16e-instruct, and llama-4-maverick-17b-128e-instruct
 *     were ALL deprecated by Groq (announced Feb 20 / Jun 17 2026).
 *     This is why every vision test was returning 503 — both of
 *     Groq's vision candidates were dead models, decommissioned
 *     server-side, so every call to them failed instantly. Removed
 *     and replaced with Groq's current lineup: openai/gpt-oss-120b,
 *     openai/gpt-oss-20b (text), and qwen/qwen3.6-27b (Groq's own
 *     recommended replacement — a single model that natively does
 *     text AND vision, so it's tagged "multimodal" below).
 *   - Google AI Studio: gemini-2.0-flash was shut down June 1, 2026
 *     — removed. gemini-2.5-flash / gemini-2.5-flash-lite are
 *     confirmed still free and current; added gemini-3-flash-preview
 *     as an additional free, current option (also vision-capable).
 *   - Cloudflare vision (@cf/meta/llama-3.2-11b-vision-instruct):
 *     the model itself is still live and free, BUT Cloudflare
 *     requires a ONE-TIME per-account acceptance call before it
 *     works — send { "prompt": "agree" } to this model's endpoint
 *     once per CF account, or every real request 400s. If vision
 *     still fails only on Cloudflare after this registry update,
 *     that's almost certainly the reason — do this for every
 *     CF_KEY_N / CF_ACCOUNT_ID_N pair configured below.
 *   - "multilingual" category renamed to "multimodal": the old
 *     category was really just "text models with decent multilingual
 *     support" (every text model here except pure-English ones would
 *     qualify), which made it redundant with "text". Renamed to mean
 *     what was actually wanted: a SINGLE model that natively handles
 *     multiple input/output types (text+image in, text out) rather
 *     than needing separate text vs vision calls — a genuinely
 *     different use case worth its own tab/category.
 *
 * HOW TO ADD A NEW PROVIDER KEY:
 *   Add another entry to that provider's `keys` array — set the
 *   matching env var in Vercel. No code changes needed.
 *
 * HOW TO ADD A NEW MODEL:
 *   Add it to the provider's `models` array with category + limits.
 *
 * CATEGORIES:
 *   "text"       -> text in, text out (chat / reasoning)
 *   "vision"     -> image + text in, text out
 *   "image_gen"  -> text in, image out
 *   "multimodal" -> ONE model that natively accepts text+image input
 *     (same as vision) but is being called out separately because
 *     the model itself markets/documents multi-input support as a
 *     first-class feature (tool use + JSON mode + vision + reasoning
 *     all in one weight set) rather than vision being an afterthought.
 *     A model can and should carry both "vision" and "multimodal" —
 *     multimodal is a curated subset for the "one do-everything model"
 *     tab, vision is the full routing pool for straight image Q&A.
 *
 * orgLevelLimit: true/false
 *   Means this provider's rate limit is shared across ALL keys under
 *   the SAME account/org. Adding more keys from the same account
 *   does NOT multiply quota — rotation only helps if each key comes
 *   from a genuinely separate account/signup (separate email, and
 *   for Google specifically, a separate Cloud project too).
 *
 *   Set to `false` ONLY when you have personally verified every
 *   configured key for that provider is from a separate account.
 *   As of Sep 2026 this repo has it set to false for Groq, Google AI
 *   Studio, and Cloudflare because the 4 keys configured for each are
 *   confirmed to be from 4 separate accounts (user-verified, not
 *   something the code can check on its own).
 *
 *   IMPORTANT: if you ever add another key to one of these providers
 *   from an account you're ALREADY using, you MUST either (a) skip
 *   configuring that extra key, or (b) set orgLevelLimit back to
 *   true — otherwise the router will treat it as free extra quota
 *   when it's actually the same shared bucket, and you'll just get
 *   more failed 429s instead of real headroom.
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
    // Set to false because all configured GROQ_KEY_N values are from
    // separate Groq accounts/signups (confirmed by user, Sep 2026) —
    // NOT multiple keys under one account. If you ever add a second
    // key from an account you're already using above, put it back to
    // true or you'll silently double-count against one shared bucket.
    orgLevelLimit: false,
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    keys: keysFromEnv("GROQ_KEY"),
    // Re-verified against console.groq.com/docs/deprecations, Sep 2026.
    // llama-3.3-70b-versatile, llama-3.1-8b-instant, llama-4-scout, and
    // llama-4-maverick are ALL decommissioned now — removed below.
    models: [
      {
        id: "openai/gpt-oss-120b",
        categories: ["text"],
        contextWindow: 131072,
        maxOutputTokens: 32768,
        limits: { rpm: 30, rpd: 1000, tpm: 8000 },
      },
      {
        id: "openai/gpt-oss-20b",
        categories: ["text"],
        contextWindow: 131072,
        maxOutputTokens: 32768,
        limits: { rpm: 30, rpd: 1000, tpm: 8000 }, // fastest/cheapest text model on Groq's current lineup
      },
      {
        id: "qwen/qwen3.6-27b",
        // Groq's own recommended replacement for the deprecated Llama 4
        // vision models. Natively multimodal (text+image in, text out) —
        // tagged BOTH "vision" (routable from the vision tab) and
        // "multimodal" (the curated "does everything" tab). Still listed
        // as Preview by Groq, not production, but it's what's live and
        // free right now.
        categories: ["vision", "text", "multimodal"],
        contextWindow: 262144,
        maxOutputTokens: 16384,
        limits: { rpm: 30, rpd: 1000, tpm: 8000 },
      },
    ],
  },

  google_ai_studio: {
    name: "Google AI Studio",
    // Set to false because all configured GOOGLE_AI_KEY_N values come
    // from separate Google accounts, each with its own Cloud project
    // (confirmed by user, Sep 2026). A key just from a different
    // Google login but the SAME underlying project would still share
    // quota — only flip this back to true if that ever applies.
    orgLevelLimit: false,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    authHeader: () => ({}),
    keys: keysFromEnv("GOOGLE_AI_KEY"),
    // Re-verified Sep 2026: gemini-2.0-flash was SHUT DOWN June 1, 2026
    // (every call now 404s) — removed. gemini-2.5-flash / -flash-lite
    // confirmed still free. Added gemini-3-flash-preview, Google's
    // current recommended free-tier vision model going forward.
    models: [
      {
        id: "gemini-2.5-flash",
        categories: ["text", "vision", "multimodal"],
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        limits: { rpm: 10, rpd: 250, tpm: 250000 },
      },
      {
        id: "gemini-2.5-flash-lite",
        categories: ["text", "vision", "multimodal"],
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        limits: { rpm: 15, rpd: 1000, tpm: 250000 },
      },
      {
        id: "gemini-3-flash-preview",
        categories: ["text", "vision", "multimodal"],
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        limits: { rpm: 10, rpd: 1500, tpm: 250000 },
      },
      // NOTE: Gemini Pro-series models left the free tier April 1, 2026
      // — paid-only now, not listed here.
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
    // Re-verified Sep 2026: these free vision/text IDs are still live.
    // 20 rpm always, 50 rpd on accounts with <$10 lifetime credit,
    // 1000 rpd once you've ever bought $10+ credit (permanent unlock,
    // even if balance drops back to $0 after).
    models: [
      {
        id: "deepseek/deepseek-chat-v3.1:free",
        categories: ["text"],
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
        categories: ["vision", "text", "multimodal"],
        contextWindow: 131072,
        maxOutputTokens: 4096,
        limits: { rpm: 20, rpd: 50, tpm: null },
      },
      {
        id: "qwen/qwen2.5-vl-32b-instruct:free",
        categories: ["vision", "text", "multimodal"],
        contextWindow: 131072,
        maxOutputTokens: 8192,
        limits: { rpm: 20, rpd: 50, tpm: null },
      },
      {
        id: "google/gemma-3-27b-it:free",
        categories: ["text"],
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
    // Set to false because CF_KEY_N / CF_ACCOUNT_ID_N pairs are from
    // separate Cloudflare accounts (confirmed by user, Sep 2026) — each
    // account has its own independent 10,000 neurons/day pool. If you
    // ever add a second token from an account already listed above,
    // flip this back to true or it'll double-count against one pool.
    orgLevelLimit: false,
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
    //
    // IMPORTANT (vision model specifically): Cloudflare requires a
    // ONE-TIME per-account license acceptance before this model will
    // serve real requests — every account must send this once:
    //   curl https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/ai/run/@cf/meta/llama-3.2-11b-vision-instruct \
    //     -H "Authorization: Bearer $CF_TOKEN" -d '{"prompt":"agree"}'
    // Do this for EVERY CF_KEY_N / CF_ACCOUNT_ID_N pair below — an
    // account that hasn't accepted will fail every vision call here
    // even though the model ID and code are both correct.
    models: [
      {
        id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        categories: ["text"],
        contextWindow: 24000,
        maxOutputTokens: 4096,
        limits: { rpm: 50, rpd: null, tpm: null }, // neuron-budget limited, not a hard rpd
      },
      {
        id: "@cf/meta/llama-3.2-11b-vision-instruct",
        categories: ["vision", "text", "multimodal"],
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
    // Pollinations moved to a pk_/sk_ key system via enter.pollinations.ai.
    // Anonymous no-key access still works for Flux images but is tightly
    // capped at ~1 request per 15 seconds and carries a watermark. An
    // sk_ (secret/server-side) key removes the watermark and the
    // anonymous rate cap. Get one free at enter.pollinations.ai if you
    // want this to be a reliable fallback rather than a last-resort one.
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
