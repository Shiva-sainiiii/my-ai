/**
 * Shared CORS handling for all /api/v1/* routes.
 *
 * Why this exists: when index.html is opened directly from local
 * storage (file:// URL) instead of being served over http(s), the
 * browser sends `Origin: null` on every fetch. The browser ALSO
 * sends a preflight OPTIONS request before the real POST for any
 * request with a JSON body / Authorization header. Vercel serverless
 * functions don't add CORS headers by default, so that preflight
 * gets no `Access-Control-Allow-Origin` back and the browser blocks
 * the whole request client-side — this is the
 * "has been blocked by CORS policy" / "origin 'null'" error.
 *
 * Fix: every route must (1) set Access-Control-Allow-* headers on
 * EVERY response, including errors, and (2) short-circuit OPTIONS
 * requests with a 200 before any auth/logic runs, since the
 * preflight carries no auth header and would otherwise get
 * rejected by checkMasterKey.
 *
 * Usage inside a handler:
 *
 *   import { applyCors } from "../../../lib/cors";
 *
 *   export default async function handler(req, res) {
 *     if (applyCors(req, res)) return; // true = OPTIONS, already handled
 *     ...rest of handler
 *   }
 */
function applyCors(req, res) {
  // "*" is fine here because this API is protected by your own master
  // key (checkMasterKey), not by browser cookies/session — so there's
  // no session to leak cross-origin. If you later switch to
  // cookie-based auth, replace "*" with a specific allowed origin.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true; // caller should `return` immediately
  }
  return false;
}

module.exports = { applyCors };
