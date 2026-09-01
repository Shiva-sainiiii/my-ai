const { REGISTRY } = require("./registry");
const { hasQuota, recordUsage, markCooldown, isInCooldown } = require("./rateLimiter");
const adapters = require("./adapters");

/**
 * ROUTER
 * ---------------------------------------------------------------
 * Builds a flat, ordered "candidate list" of every (provider, key,
 * model) combo that matches the requested category, then tries
 * them one by one:
 *
 *   1. Skip anything currently in cooldown (got a 429 recently)
 *   2. Skip anything with no quota left (rpm/rpd bucket full)
 *   3. Try the call
 *   4. On success -> return
 *   5. On 429 / rate-limit error -> mark cooldown, try next candidate
 *   6. On other error -> log + try next candidate anyway (resilience)
 *
 * ORDERING: candidates are sorted by contextWindow descending by
 * default (biggest context first), unless the caller requests a
 * specific model or a different sort strategy.
 */

function buildCandidates({ category, preferredProvider, preferredModel, sortBy }) {
  const candidates = [];

  for (const [providerId, provider] of Object.entries(REGISTRY)) {
    if (preferredProvider && preferredProvider !== providerId) continue;
    if (!provider.keys || provider.keys.length === 0) continue; // no keys configured

    // IMPORTANT: if this provider's rate limit is shared across the whole
    // org/account (orgLevelLimit: true — e.g. Groq, Google AI Studio,
    // Cloudflare), trying key #2, #3... after key #1 hits its limit is
    // pointless — they all share the same bucket upstream. So we only
    // build a candidate for the FIRST key. Multiple keys on an org-level
    // provider only actually help if each key genuinely comes from a
    // separate account — the registry can't verify that, so we stay
    // conservative and treat same-provider keys as one pool by default.
    const keysToUse = provider.orgLevelLimit ? provider.keys.slice(0, 1) : provider.keys;

    for (const model of provider.models) {
      if (!model.categories.includes(category)) continue;
      if (preferredModel && preferredModel !== model.id) continue;

      for (const key of keysToUse) {
        candidates.push({ providerId, provider, model, key });
      }
    }
  }

  const sortKey = sortBy || "contextWindow";
  candidates.sort((a, b) => {
    if (sortKey === "contextWindow") {
      return (b.model.contextWindow || 0) - (a.model.contextWindow || 0);
    }
    if (sortKey === "maxOutputTokens") {
      return (b.model.maxOutputTokens || 0) - (a.model.maxOutputTokens || 0);
    }
    return 0;
  });

  return candidates;
}

async function routeRequest({
  category,
  payload,
  preferredProvider = null,
  preferredModel = null,
  sortBy = "contextWindow",
}) {
  const candidates = buildCandidates({ category, preferredProvider, preferredModel, sortBy });

  if (candidates.length === 0) {
    return {
      error: true,
      status: 404,
      message: `No configured provider/key/model found for category "${category}"${
        preferredModel ? ` and model "${preferredModel}"` : ""
      }. Check your env vars and registry.js.`,
    };
  }

  const attempts = [];

  for (const candidate of candidates) {
    const { providerId, provider, model, key } = candidate;

    const cooling = await isInCooldown(providerId, key.id, model.id);
    if (cooling) {
      attempts.push({ provider: providerId, model: model.id, key: key.id, skipped: "cooldown" });
      continue;
    }

    const quota = await hasQuota(providerId, key.id, model.id, model.limits);
    if (!quota.ok) {
      attempts.push({ provider: providerId, model: model.id, key: key.id, skipped: quota.reason });
      continue;
    }

    try {
      // Optimistic increment BEFORE the call so concurrent requests
      // racing on the same key don't both slip through.
      await recordUsage(providerId, key.id, model.id);

      const adapter = adapters[providerId];
      if (!adapter) {
        attempts.push({ provider: providerId, model: model.id, error: "no adapter implemented" });
        continue;
      }

      const result = await adapter.call({ key, model: model.id, payload });

      if (result.rateLimited) {
        await markCooldown(providerId, key.id, model.id, result.retryAfterSeconds || 60);
        attempts.push({ provider: providerId, model: model.id, key: key.id, error: "429 from provider" });
        continue; // try next candidate
      }

      if (result.error) {
        attempts.push({ provider: providerId, model: model.id, key: key.id, error: result.message });
        continue; // try next candidate — resilience over perfection
      }

      // SUCCESS
      return {
        error: false,
        provider: providerId,
        model: model.id,
        keyUsed: key.id,
        data: result.data,
        attempts,
      };
    } catch (err) {
      attempts.push({ provider: providerId, model: model.id, key: key.id, error: err.message });
      continue;
    }
  }

  return {
    error: true,
    status: 503,
    message: "All available providers/keys exhausted or rate-limited for this category.",
    attempts,
  };
}

module.exports = { routeRequest, buildCandidates };
