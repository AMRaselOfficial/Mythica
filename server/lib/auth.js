'use strict';
/**
 * Auth middleware: verifies `Authorization: Bearer <token>`.
 * - FAKE_AUTH=1 (dev/test): accepts `Bearer test-<uid>` (uid, not admin) and
 *   `Bearer test-admin-<uid>` (uid, admin). Sets req.uid, req.isAdmin.
 * - Otherwise verifies the Firebase ID token with firebase-admin
 *   (required lazily so the server boots with zero credentials in fake mode).
 *   The admin flag comes from the token's `admin` custom claim.
 * On failure: 401 {ok:false,error:'unauthorized'}.
 *
 * requireAdmin: run after (or instead of) requireAuth; requires the token's
 * `admin` custom claim to be true, else 403 {ok:false,error:'forbidden'}.
 *
 * Ban enforcement: requireAuth loads players/{uid} (cached 60s in memory).
 * If accountStatus === 'banned' -> 403 {ok:false,error:'account_banned'}.
 * A missing player doc lets the request through (first-login flow creates
 * it); a db failure also lets it through (fail-open, logged) rather than
 * 500-ing all gameplay.
 */
const { loadAdmin, db } = require('./db');

/** Shared token check. Returns {uid,isAdmin,email}, or null when the token
 *  is missing/malformed. Throws on verification failure (real mode). */
async function authenticate(req) {
  const header = req.headers.authorization || '';
  const m = /^Bearer (.+)$/.exec(header);
  const token = m && m[1];
  if (!token) return null;

  if (process.env.FAKE_AUTH === '1') {
    // NOTE: the admin pattern must be checked first, otherwise
    // `test-admin-bob` would match `test-<uid>` with uid `admin-bob`.
    const am = /^test-admin-(.+)$/.exec(token);
    const fm = am || /^test-(.+)$/.exec(token);
    if (!fm || !fm[1]) return null;
    return { uid: fm[1], isAdmin: !!am, email: '' };
  }

  const admin = loadAdmin(); // throws ADMIN_UNAVAILABLE when SDK missing
  const decoded = await admin.auth().verifyIdToken(token);
  return {
    uid: decoded.uid,
    isAdmin: decoded.admin === true,
    email: decoded.email || '',
  };
}

const banCache = new Map(); // uid -> { status, at }
const BAN_TTL_MS = 60 * 1000;

async function accountStatusOf(uid) {
  const hit = banCache.get(uid);
  if (hit && Date.now() - hit.at < BAN_TTL_MS) return hit.status;
  let status = 'active';
  try {
    const snap = await db.collection('players').doc(uid).get();
    if (snap.exists) status = snap.data().accountStatus || 'active';
  } catch (e) {
    console.error('ban check failed (allowing request):', e && e.message);
  }
  banCache.set(uid, { status, at: Date.now() });
  return status;
}

/** Drop the cached ban status for a uid (called after ban/unban). */
function invalidateBanStatus(uid) {
  if (uid) banCache.delete(uid);
  else banCache.clear();
}

async function finishAuth(req, res, next, a) {
  req.uid = a.uid;
  req.isAdmin = a.isAdmin;
  req.email = a.email;
  const status = await accountStatusOf(a.uid);
  if (status === 'banned') {
    return res.status(403).json({ ok: false, error: 'account_banned' });
  }
  return next();
}

async function requireAuth(req, res, next) {
  let a;
  try {
    a = await authenticate(req);
  } catch (e) {
    if (e && e.code === 'ADMIN_UNAVAILABLE') {
      return res.status(503).json({ ok: false, error: 'auth_unavailable' });
    }
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  if (!a) return res.status(401).json({ ok: false, error: 'unauthorized' });
  return finishAuth(req, res, next, a);
}

async function requireAdmin(req, res, next) {
  // Usable standalone (verifies the token itself) or after requireAuth
  // (in which case req.uid is already set and this is just the claim check).
  if (req.uid === undefined) {
    let a;
    try {
      a = await authenticate(req);
    } catch (e) {
      if (e && e.code === 'ADMIN_UNAVAILABLE') {
        return res.status(503).json({ ok: false, error: 'auth_unavailable' });
      }
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    if (!a) return res.status(401).json({ ok: false, error: 'unauthorized' });
    req.uid = a.uid;
    req.isAdmin = a.isAdmin;
    req.email = a.email;
    const status = await accountStatusOf(a.uid);
    if (status === 'banned') {
      return res.status(403).json({ ok: false, error: 'account_banned' });
    }
  }
  if (req.isAdmin !== true) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  return next();
}

module.exports = { requireAuth, requireAdmin, invalidateBanStatus };
