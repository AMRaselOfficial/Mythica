'use strict';
/** In-memory per-uid rate limit: 60 requests per rolling minute. */

const WINDOW_MS = 60 * 1000;
const MAX_REQ = 60;
const hits = new Map(); // uid -> [timestamps]

function rateLimit(req, res, next) {
  const uid = req.uid || req.ip || 'anon';
  const now = Date.now();
  let arr = hits.get(uid) || [];
  arr = arr.filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_REQ) {
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }
  arr.push(now);
  hits.set(uid, arr);
  return next();
}

function resetRateLimit() {
  hits.clear();
}

module.exports = { rateLimit, resetRateLimit };
