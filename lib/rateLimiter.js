const { createClient } = require("redis");

/**
 * RATE LIMIT TRACKER
 * ---------------------------------------------------------------
 * Serverless functions are stateless between invocations, so we
 * can't just keep a counter in memory — it resets on every cold
 * start and isn't shared across concurrent invocations either.
 * Redis (via Vercel's Redis integration) gives us a shared,
 * persistent counter.
 *
 * NOTE (Sep 2026): Vercel's newer Redis marketplace integration
 * only exposes a raw TCP connection string (KV_REDIS_URL / REDIS_URL),
 * not the old REST API vars (KV_REST_API_URL/TOKEN) that the
 * @vercel/kv package needs. So this file uses the standard
 * `redis` (node-redis) client directly instead of @vercel/kv.
 *
 * Each (provider, key, model) triple gets its own minute-bucket
 * and day-bucket counter, auto-expiring via Redis TTL — so we
 * never need a cleanup job.
 */

let clientPromise = null;

function getRedisUrl() {
  // Accept whichever env var name the connected integration actually
  // created. Check the most specific/likely names first.
  return (
    process.env.KV_REDIS_URL ||
    process.env.REDIS_URL ||
    process.env.KV_URL ||
    null
  );
}

/**
 * Returns a connected, shared Redis client. Serverless functions can
 * reuse a warm connection across invocations within the same
 * container, so we cache the client (and the in-flight connect
 * promise) at module scope instead of reconnecting every call.
 */
async function getClient() {
  if (clientPromise) return clientPromise;

  const url = getRedisUrl();
  if (!url) {
    throw new Error(
      "No Redis connection string found. Expected one of: KV_REDIS_URL, REDIS_URL, KV_URL. " +
        "Check Vercel → Settings → Environment Variables for whatever your Redis integration created."
    );
  }

  const client = createClient({ url });
  client.on("error", (err) => {
    console.error("Redis client error:", err.message);
    // Drop the cached promise so the next call attempts a fresh connect
    // instead of reusing a dead connection forever.
    clientPromise = null;
  });

  clientPromise = client.connect().then(() => client);
  return clientPromise;
}

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
  const redis = await getClient();
  const checks = [];

  if (limits.rpm) {
    checks.push(
      redis.get(minuteBucketKey(provider, keyId, model)).then((count) => ({
        type: "rpm",
        count: Number(count) || 0,
        limit: limits.rpm,
      }))
    );
  }
  if (limits.rpd) {
    checks.push(
      redis.get(dayBucketKey(provider, keyId, model)).then((count) => ({
        type: "rpd",
        count: Number(count) || 0,
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
  const redis = await getClient();
  const minKey = minuteBucketKey(provider, keyId, model);
  const dayKey = dayBucketKey(provider, keyId, model);

  await Promise.all([
    redis.incr(minKey).then(() => redis.expire(minKey, 65)),
    redis.incr(dayKey).then(() => redis.expire(dayKey, 60 * 60 * 25)),
  ]);
}

/**
 * Marks a key as "cooling down" after we get an explicit 429 from
 * the provider — this is a hard signal, independent of our own
 * bucket math (which can drift if limits change upstream).
 */
async function markCooldown(provider, keyId, model, seconds = 60) {
  const redis = await getClient();
  await redis.set(`cooldown:${provider}:${keyId}:${model}`, "1", { EX: seconds });
}

async function isInCooldown(provider, keyId, model) {
  const redis = await getClient();
  const val = await redis.get(`cooldown:${provider}:${keyId}:${model}`);
  return !!val;
}

module.exports = { hasQuota, recordUsage, markCooldown, isInCooldown };
