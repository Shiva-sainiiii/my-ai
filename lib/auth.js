/**
 * MASTER KEY AUTH
 * ---------------------------------------------------------------
 * Your gateway has ONE key — the master key — set as an env var
 * (GATEWAY_MASTER_KEY). Every request to the gateway must present
 * this key. The gateway then internally picks whichever real
 * provider key it needs; the caller never sees or handles those.
 *
 * To generate a strong master key, run this once locally:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * and paste the output into Vercel's env vars as GATEWAY_MASTER_KEY.
 */

function checkMasterKey(req) {
  const expected = process.env.GATEWAY_MASTER_KEY;
  if (!expected) {
    return { ok: false, status: 500, message: "GATEWAY_MASTER_KEY is not set on the server." };
  }

  const header = req.headers.authorization || req.headers.Authorization || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : header;

  if (!provided || provided !== expected) {
    return { ok: false, status: 401, message: "Invalid or missing master API key." };
  }
  return { ok: true };
}

module.exports = { checkMasterKey };
