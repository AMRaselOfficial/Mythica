'use strict';
/**
 * Admin API, mounted at /api/admin. Every route is behind requireAdmin
 * (applied to the whole router below), which itself requires the token's
 * `admin` custom claim. Note the /api chain in server.js already runs
 * requireAuth first, so banned non-admin accounts never reach here.
 *
 * GET  /api/admin/me
 * GET  /api/admin/stats
 * GET  /api/admin/users?search=&limit=&pageToken=
 * GET  /api/admin/users/:uid
 * POST /api/admin/users/:uid/ban
 * POST /api/admin/users/:uid/unban
 */
const express = require('express');
const { db, USE_FAKE, loadAdmin } = require('../lib/db');
const { requireAdmin, invalidateBanStatus } = require('../lib/auth');
const { logActivity } = require('../lib/activity');
const contentApi = require('../lib/content');

const router = express.Router();
router.use(requireAdmin);

/** Normalize Firestore Timestamps / Dates / epoch ms to epoch ms. */
function toMillis(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return 0;
}

/** List every doc directly under a collection path. Real mode uses a bounded
 *  query; fake mode scans the in-memory store (admin tooling only). */
async function listDocs(collPath) {
  if (USE_FAKE) {
    return db._listAll(collPath).map(({ id, data }) => ({ id, data: data() }));
  }
  const snap = await db.collection(collPath).limit(5000).get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

function publicUser(id, d) {
  return {
    uid: id,
    displayName: d.displayName ?? '',
    email: d.email ?? '',
    petals: d.petals ?? 0,
    level: d.level ?? 1,
    xp: d.xp ?? 0,
    accountStatus: d.accountStatus ?? 'active',
    createdAt: toMillis(d.createdAt),
  };
}

function logView({ id, data }) {
  return { id, uid: data.uid, type: data.type, details: data.details || {}, createdAt: toMillis(data.createdAt) };
}

function tradeView({ id, data }) {
  return {
    id,
    offeredBy: data.offeredBy,
    offeredTo: data.offeredTo,
    offerItemId: data.offerItemId,
    offerQty: data.offerQty,
    wantItemId: data.wantItemId,
    wantQty: data.wantQty,
    status: data.status,
    createdAt: toMillis(data.createdAt),
    acceptedAt: toMillis(data.acceptedAt),
    completedAt: toMillis(data.completedAt),
  };
}

function listingView({ id, data }) {
  return {
    id,
    sellerUid: data.sellerUid,
    itemId: data.itemId,
    quantity: data.quantity,
    price: data.price,
    status: data.status,
    createdAt: toMillis(data.createdAt),
    buyerUid: data.buyerUid || null,
    soldAt: toMillis(data.soldAt),
  };
}

router.get('/admin/me', (req, res) => {
  res.json({ ok: true, admin: true, uid: req.uid, email: req.email || '' });
});

router.get('/admin/stats', async (req, res) => {
  try {
    const now = new Date();
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    let huntsToday = 0;
    let tradesToday = 0;
    let marketplaceVolumeToday = 0;
    for (const { data } of await listDocs('activityLogs')) {
      if (toMillis(data.createdAt) < todayStart) continue;
      if (data.type === 'hunt') huntsToday += 1;
      else if (data.type === 'trade_completed') tradesToday += 1;
      else if (data.type === 'purchase') {
        marketplaceVolumeToday += Number(data.details && data.details.price) || 0;
      }
    }
    const players = await listDocs('players');
    res.json({
      ok: true,
      totalUsers: players.length,
      huntsToday,
      tradesToday,
      marketplaceVolumeToday,
    });
  } catch (e) {
    console.error('GET /api/admin/stats failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.get('/admin/users', async (req, res) => {
  try {
    const q = String(req.query.search || '').trim().toLowerCase();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.pageToken, 10) || 0, 0);

    // NOTE: search is a bounded in-memory filter. We fetch a limited window
    // of player docs (listDocs is capped) and substring-match email /
    // displayName case-insensitively in JS, then paginate with an offset
    // encoded as pageToken. Fine for admin tooling at this scale; replace
    // with an indexed query if the player base grows.
    let users = (await listDocs('players')).map(({ id, data }) => publicUser(id, data));
    if (q) {
      users = users.filter(
        (u) => u.email.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q)
      );
    }
    users.sort((a, b) => b.createdAt - a.createdAt || (a.uid < b.uid ? -1 : 1));
    const page = users.slice(offset, offset + limit);
    const nextPageToken = offset + limit < users.length ? String(offset + limit) : null;
    res.json({ ok: true, users: page, nextPageToken });
  } catch (e) {
    console.error('GET /api/admin/users failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.get('/admin/users/:uid', async (req, res) => {
  try {
    const uid = req.params.uid;
    const pSnap = await db.collection('players').doc(uid).get();
    if (!pSnap.exists) return res.status(404).json({ ok: false, error: 'not_found' });
    const p = pSnap.data();

    const user = {
      ...publicUser(uid, p),
      lastHuntAt: toMillis(p.lastHuntAt),
      musicEnabled: p.musicEnabled ?? true,
    };

    const inventory = (await listDocs(`inventories/${uid}/items`)).map(({ id, data }) => {
      const item = contentApi.getItem(id);
      return {
        itemId: id,
        name: item ? item.name : id,
        rarity: item ? item.rarity : 'unknown',
        quantity: data.quantity || 0,
        upgradeLevel: data.upgradeLevel || 0,
      };
    });

    const logs = (await listDocs('activityLogs'))
      .filter(({ data }) => data.uid === uid)
      .sort((a, b) => toMillis(b.data.createdAt) - toMillis(a.data.createdAt));
    const hunts = logs.filter(({ data }) => data.type === 'hunt').slice(0, 20).map(logView);
    const activity = logs.slice(0, 50).map(logView);

    const trades = (await listDocs('trades'))
      .filter(({ data }) => data.offeredBy === uid || data.offeredTo === uid)
      .map(tradeView);

    const listings = (await listDocs('marketplace'))
      .filter(({ data }) => data.sellerUid === uid)
      .map(listingView);

    res.json({ ok: true, user, inventory, hunts, trades, listings, activity });
  } catch (e) {
    console.error('GET /api/admin/users/:uid failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

/** Best-effort session revocation: skipped silently in fake/dev mode where
 *  the Admin SDK is unavailable. */
async function revokeSessionsBestEffort(uid) {
  if (USE_FAKE) return;
  try {
    await loadAdmin().auth().revokeRefreshTokens(uid);
  } catch (e) {
    console.error('revokeRefreshTokens failed (best effort):', e && e.message);
  }
}

async function safeLog(entry) {
  try {
    await logActivity(db, entry);
  } catch (e) {
    // Logging must never break the admin action itself.
    console.error('admin activity log failed:', e && e.message);
  }
}

router.post('/admin/users/:uid/ban', async (req, res) => {
  try {
    const targetUid = req.params.uid;
    const ref = db.collection('players').doc(targetUid);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'not_found' });
    await ref.update({ accountStatus: 'banned', updatedAt: Date.now() });
    await revokeSessionsBestEffort(targetUid);
    invalidateBanStatus(targetUid);
    await safeLog({ uid: targetUid, type: 'ban', details: { targetUid, byUid: req.uid } });
    res.json({ ok: true, accountStatus: 'banned' });
  } catch (e) {
    console.error('POST /api/admin/users/:uid/ban failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.post('/admin/users/:uid/unban', async (req, res) => {
  try {
    const targetUid = req.params.uid;
    const ref = db.collection('players').doc(targetUid);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'not_found' });
    await ref.update({ accountStatus: 'active', updatedAt: Date.now() });
    invalidateBanStatus(targetUid);
    await safeLog({ uid: targetUid, type: 'unban', details: { targetUid, byUid: req.uid } });
    res.json({ ok: true, accountStatus: 'active' });
  } catch (e) {
    console.error('POST /api/admin/users/:uid/unban failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

module.exports = router;
