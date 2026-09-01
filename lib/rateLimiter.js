const { kv } = require("@vercel/kv");

/**
 * RATE LIMIT TRACKER
 * ---------------------------------------------------------------
 * Serverless functions are stateless between invocations, so we
 * can't just keep a counter in memory — it resets on every cold
 * start and isn't shared across concurrent invocations either.
 * Vercel KV (Redis) gives us a shared, persistent counter.
 *
 * Each (provider, key, model) triple gets its own minute-bucket
 * and day-bucket counter, auto-expiring via Redis TTL — so we
 * never need a cleanup job.
 */

function minuteBucketKey(provider, keyId, model) {
  const minute = Math.floor(Date.now() / 60000);
  return `rl:${provider}:${keyId}:${model}:min:${minute}`;
}

function dayBucketKey(provider, keyId, model) {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  return `rl:${provider}:${keyId}:${model}:day:${day}`;
}

/**
 * Checks whether this (provider, key, model) combo has room left
 * under its rpm/rpd limits. Does NOT increment — call `recordUsage`
 * after a successful call.
 */
async function hasQuota(provider, keyId, model, limits) {
  const checks = [];

  if (limits.rpm) {
    checks.push(
      kv.get(minuteBucketKey(provider, keyId, model)).then((count) => ({
        type: "rpm",
        count: count || 0,
        limit: limits.rpm,
      }))
    );
  }
  if (limits.rpd) {
    checks.push(
      kv.get(dayBucketKey(provider, keyId, model)).then((count) => ({
        type: "rpd",
        count: count || 0,
        limit: limits.rpd,
      }))
    );
  }

  const results = await Promise.all(checks);
  for (const r of results) {
    if (r.count >= r.limit) {
      return { ok: false, reason: `${r.type} limit hit (${r.count}/${r.limit})` };
    }
  }
  return { ok: true };
}

/**
 * Increments both minute and day counters after a call is made.
 * Call this right before dispatching the request (optimistic),
 * or right after a successful response — optimistic is safer
 * against races when the gateway itself gets concurrent traffic.
 */
async function recordUsage(provider, keyId, model) {
  const minKey = minuteBucketKey(provider, keyId, model);
  const dayKey = dayBucketKey(provider, keyId, model);

  await Promise.all([
    kv.incr(minKey).then(() => kv.expire(minKey, 65)),
    kv.incr(dayKey).then(() => kv.expire(dayKey, 60 * 60 * 25)),
  ]);
}

/**
 * Marks a key as "cooling down" after we get an explicit 429 from
 * the provider — this is a hard signal, independent of our own
 * bucket math (which can drift if limits change upstream).
 */
async function markCooldown(provider, keyId, model, seconds = 60) {
  await kv.set(`cooldown:${provider}:${keyId}:${model}`, 1, { ex: seconds });
}

async function isInCooldown(provider, keyId, model) {
  const val = await kv.get(`cooldown:${provider}:${keyId}:${model}`);
  return !!val;
}

module.exports = { hasQuota, recordUsage, markCooldown, isInCooldown };
