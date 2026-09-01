const { checkMasterKey } = require("../../../lib/auth");
const { REGISTRY } = require("../../../lib/registry");

/**
 * GET /api/v1/models
 * Lists every model currently configured (i.e. has at least one key
 * set in env vars), grouped by provider, with category + limit info.
 * Useful for a dashboard, or just to sanity-check your setup.
 */
export default async function handler(req, res) {
  const auth = checkMasterKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.message });
  }

  const out = [];
  for (const [providerId, provider] of Object.entries(REGISTRY)) {
    const keyCount = provider.keys?.length || 0;
    for (const model of provider.models) {
      out.push({
        provider: providerId,
        provider_name: provider.name,
        model: model.id,
        categories: model.categories,
        context_window: model.contextWindow,
        max_output_tokens: model.maxOutputTokens,
        limits: model.limits,
        keys_configured: keyCount,
        active: keyCount > 0,
        org_level_limit: !!provider.orgLevelLimit,
        // If org_level_limit is true, only the FIRST configured key is
        // ever used by the router — extra keys from the same account
        // won't add quota. Use separate accounts if you want them to.
        keys_actually_usable: provider.orgLevelLimit ? Math.min(keyCount, 1) : keyCount,
      });
    }
  }

  return res.status(200).json({ object: "list", data: out });
}
