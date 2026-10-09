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
 * POST /api/admin/users/:uid/email      { email }
 * POST /api/admin/users/:uid/inventory/add    { itemId, quantity }
 * POST /api/admin/users/:uid/inventory/remove { itemId, quantity }
 * GET  /api/admin/support[?status=&limit=]
 * GET  /api/admin/support/unread-count
 * GET  /api/admin/support/:ticketId
 * POST /api/admin/support/:ticketId/reply   { text }
 * POST /api/admin/support/:ticketId/status  { status: pending|checking|solved }
 * POST /api/admin/support/:ticketId/read
 */
const express = require('express');
const { db, USE_FAKE, loadAdmin } = require('../lib/db');
const { requireAdmin, invalidateBanStatus } = require('../lib/auth');
const { logActivity } = require('../lib/activity');
const contentApi = require('../lib/content');
const { isAllowedEmail } = require('../lib/emailProviders');

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
        obtainedAt: toMillis(data.obtainedAt),
        favorite: !!data.favorite,
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

/** Admin: change a player's sign-in email address.
 *  Used when a player requests an email change through the support channel
 *  and the admin has verified the request. Updates both Firebase Auth
 *  (the sign-in credential) and the player document (kept in sync with the
 *  auth token email by Firestore rules). The password is unchanged.
 *  The new address must belong to a verified provider, matching the signup
 *  gate, and must not already be in use by another account.
 *  POST /api/admin/users/:uid/email { email } */
router.post('/admin/users/:uid/email', async (req, res) => {
  try {
    const targetUid = req.params.uid;
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'invalid_email' });
    }
    if (!isAllowedEmail(email)) {
      return res.status(400).json({ ok: false, error: 'email_provider_not_allowed' });
    }
    const ref = db.collection('players').doc(targetUid);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'not_found' });
    const oldEmail = String(snap.data().email || '').toLowerCase();
    if (oldEmail === email) {
      return res.status(400).json({ ok: false, error: 'same_email' });
    }
    // Duplicate guard: another player doc holding this address means the
    // address is taken (works in fake/dev mode where Auth SDK is absent).
    const taken = (await listDocs('players')).some(
      ({ id, data }) => id !== targetUid && String(data.email || '').toLowerCase() === email
    );
    if (taken) return res.status(409).json({ ok: false, error: 'email_in_use' });

    if (!USE_FAKE) {
      const auth = loadAdmin().auth();
      try {
        const existing = await auth.getUserByEmail(email);
        if (existing.uid !== targetUid) {
          return res.status(409).json({ ok: false, error: 'email_in_use' });
        }
      } catch (e) {
        if (!e || e.code !== 'auth/user-not-found') throw e;
      }
      try {
        await auth.updateUser(targetUid, { email, emailVerified: false });
      } catch (e) {
        if (e && e.code === 'auth/email-already-exists') {
          return res.status(409).json({ ok: false, error: 'email_in_use' });
        }
        if (e && e.code === 'auth/user-not-found') {
          return res.status(404).json({ ok: false, error: 'not_found' });
        }
        throw e;
      }
    }

    await ref.update({ email, updatedAt: Date.now() });
    await safeLog({
      uid: targetUid,
      type: 'email_change',
      details: { targetUid, oldEmail: oldEmail || null, newEmail: email, byUid: req.uid },
    });
    res.json({ ok: true, email });
  } catch (e) {
    console.error('POST /api/admin/users/:uid/email failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

/** Admin: add items to a player's inventory.
 *  POST /api/admin/users/:uid/inventory/add { itemId, quantity } */
router.post('/admin/users/:uid/inventory/add', async (req, res) => {
  try {
    const targetUid = req.params.uid;
    const { itemId, quantity } = req.body || {};
    const qty = Math.floor(Number(quantity) || 0);
    if (!itemId || typeof itemId !== 'string' || qty <= 0 || qty > 9999) {
      return res.status(400).json({ ok: false, error: 'invalid_input' });
    }
    const item = contentApi.getItem(itemId);
    if (!item) return res.status(400).json({ ok: false, error: 'unknown_item' });

    const pRef = db.collection('players').doc(targetUid);
    if (!(await pRef.get()).exists) return res.status(404).json({ ok: false, error: 'not_found' });

    const invRef = db.collection('inventories').doc(targetUid).collection('items').doc(itemId);
    const now = Date.now();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(invRef);
      if (snap.exists) {
        const cur = snap.data().quantity || 0;
        tx.update(invRef, { quantity: cur + qty, updatedAt: now });
      } else {
        tx.set(invRef, { quantity: qty, upgradeLevel: 0, obtainedAt: now, favorite: false });
      }
    });
    await safeLog({ uid: targetUid, type: 'admin_grant_item', details: { itemId, quantity: qty, byUid: req.uid } });
    // Best-effort: refresh best weapon power if a weapon was granted.
    if (item.type === 'weapon') {
      db.runTransaction(async (tx) => {
        await syncBestWeaponPower(tx, targetUid);
      }).catch(() => {});
    }
    res.json({ ok: true, itemId, quantityAdded: qty });
  } catch (e) {
    console.error('POST /api/admin/users/:uid/inventory/add failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

/** Admin: remove items from a player's inventory.
 *  POST /api/admin/users/:uid/inventory/remove { itemId, quantity } */
router.post('/admin/users/:uid/inventory/remove', async (req, res) => {
  try {
    const targetUid = req.params.uid;
    const { itemId, quantity } = req.body || {};
    const qty = Math.floor(Number(quantity) || 0);
    if (!itemId || typeof itemId !== 'string' || qty <= 0 || qty > 9999) {
      return res.status(400).json({ ok: false, error: 'invalid_input' });
    }
    const pRef = db.collection('players').doc(targetUid);
    if (!(await pRef.get()).exists) return res.status(404).json({ ok: false, error: 'not_found' });

    const invRef = db.collection('inventories').doc(targetUid).collection('items').doc(itemId);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(invRef);
      if (!snap.exists) return { error: 'not_owned' };
      const cur = snap.data().quantity || 0;
      const remaining = cur - qty;
      if (remaining > 0) {
        tx.update(invRef, { quantity: remaining, updatedAt: Date.now() });
      } else {
        tx.delete(invRef);
      }
      return { ok: true, removed: Math.min(qty, cur), remaining: Math.max(0, remaining) };
    });
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    await safeLog({ uid: targetUid, type: 'admin_remove_item', details: { itemId, quantity: result.removed, byUid: req.uid } });
    res.json({ ok: true, itemId, ...result });
  } catch (e) {
    console.error('POST /api/admin/users/:uid/inventory/remove failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

/* ------------------------------------------------------------------ *
 * Redeem codes — promotional codes players redeem via POST /api/redeem.
 *
 * GET    /api/admin/redeem-codes
 * POST   /api/admin/redeem-codes
 *          { code, petals, xp, items:[{itemId,quantity}], maxRedemptions, active, expiresAt }
 * PATCH  /api/admin/redeem-codes/:code
 *          { petals, xp, items, maxRedemptions, active, expiresAt }
 * DELETE /api/admin/redeem-codes/:code
 * ------------------------------------------------------------------ */

function normalizeRedeemCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 32);
}

/** Validate the mutable reward/limit fields of a redeem code. Returns { error } or { value }. */
function validateRedeemFields(body) {
  const petals = Math.floor(Number(body.petals) || 0);
  const xp = Math.floor(Number(body.xp) || 0);
  const maxRedemptions = Math.floor(Number(body.maxRedemptions) || 0);
  if (petals < 0 || petals > 1000000) return { error: 'bad_petals' };
  if (xp < 0 || xp > 1000000) return { error: 'bad_xp' };
  if (maxRedemptions < 0 || maxRedemptions > 10000000) return { error: 'bad_max' };

  const items = [];
  if (body.items !== undefined) {
    if (!Array.isArray(body.items) || body.items.length > 20) return { error: 'bad_items' };
    for (const it of body.items) {
      const itemId = String((it && it.itemId) || '').trim();
      const quantity = Math.floor(Number((it && it.quantity) || 0));
      if (!itemId || !contentApi.getItem(itemId)) return { error: 'unknown_item' };
      if (quantity < 1 || quantity > 999) return { error: 'bad_item_qty' };
      items.push({ itemId, quantity });
    }
  }

  let expiresAt = null;
  if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== '') {
    expiresAt = Math.floor(Number(body.expiresAt));
    if (!Number.isFinite(expiresAt) || expiresAt < 0) return { error: 'bad_expiry' };
  }

  const active = body.active === undefined ? undefined : Boolean(body.active);
  return { value: { petals, xp, items, maxRedemptions, active, expiresAt } };
}

function redeemCodeView(id, d) {
  return {
    code: id,
    petals: d.petals || 0,
    xp: d.xp || 0,
    items: Array.isArray(d.items) ? d.items : [],
    maxRedemptions: d.maxRedemptions || 0,
    redeemedCount: d.redeemedCount || 0,
    active: d.active !== false,
    expiresAt: d.expiresAt || null,
    createdAt: toMillis(d.createdAt),
    updatedAt: toMillis(d.updatedAt),
  };
}

router.get('/admin/redeem-codes', async (req, res) => {
  try {
    const docs = await listDocs('redeemCodes');
    docs.sort((a, b) => (b.data.createdAt || 0) - (a.data.createdAt || 0));
    res.json({ ok: true, codes: docs.map(({ id, data }) => redeemCodeView(id, data)) });
  } catch (e) {
    console.error('GET /api/admin/redeem-codes failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.post('/admin/redeem-codes', async (req, res) => {
  try {
    const body = req.body || {};
    const code = normalizeRedeemCode(body.code);
    if (code.length < 3) return res.status(400).json({ ok: false, error: 'bad_code' });
    const v = validateRedeemFields(body);
    if (v.error) return res.status(400).json({ ok: false, error: v.error });

    const ref = db.collection('redeemCodes').doc(code);
    if ((await ref.get()).exists) return res.status(409).json({ ok: false, error: 'exists' });

    const now = Date.now();
    await ref.set({
      code,
      petals: v.value.petals,
      xp: v.value.xp,
      items: v.value.items,
      maxRedemptions: v.value.maxRedemptions,
      redeemedCount: 0,
      active: v.value.active !== undefined ? v.value.active : true,
      expiresAt: v.value.expiresAt,
      createdAt: now,
      updatedAt: now,
      createdBy: req.uid,
    });
    await safeLog({ uid: req.uid, type: 'admin_redeem_create', details: { code, byUid: req.uid } });
    res.json({ ok: true, code });
  } catch (e) {
    console.error('POST /api/admin/redeem-codes failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.patch('/admin/redeem-codes/:code', async (req, res) => {
  try {
    const code = normalizeRedeemCode(req.params.code);
    const ref = db.collection('redeemCodes').doc(code);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'not_found' });

    const v = validateRedeemFields(req.body || {});
    if (v.error) return res.status(400).json({ ok: false, error: v.error });

    const update = { updatedAt: Date.now() };
    // Only overwrite fields the admin actually sent.
    const body = req.body || {};
    if (body.petals !== undefined) update.petals = v.value.petals;
    if (body.xp !== undefined) update.xp = v.value.xp;
    if (body.items !== undefined) update.items = v.value.items;
    if (body.maxRedemptions !== undefined) update.maxRedemptions = v.value.maxRedemptions;
    if (body.active !== undefined) update.active = v.value.active;
    if (body.expiresAt !== undefined) update.expiresAt = v.value.expiresAt;

    await ref.update(update);
    await safeLog({ uid: req.uid, type: 'admin_redeem_update', details: { code, update, byUid: req.uid } });
    res.json({ ok: true, code });
  } catch (e) {
    console.error('PATCH /api/admin/redeem-codes/:code failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.delete('/admin/redeem-codes/:code', async (req, res) => {
  try {
    const code = normalizeRedeemCode(req.params.code);
    const ref = db.collection('redeemCodes').doc(code);
    if (!(await ref.get()).exists) return res.status(404).json({ ok: false, error: 'not_found' });
    await ref.delete();
    await safeLog({ uid: req.uid, type: 'admin_redeem_delete', details: { code, byUid: req.uid } });
    res.json({ ok: true, code });
  } catch (e) {
    console.error('DELETE /api/admin/redeem-codes/:code failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

/* ------------------------------------------------------------------ *
 * Event manager — create / edit / delete events and inspect joins.
 *
 * GET    /api/admin/events
 * POST   /api/admin/events
 *          { title, description, banner, startAt, endAt, active, featured,
 *            type: 'hunt_count'|'invite_friends'|'minigame', goal,
 *            rewards: { petals, xp, items:[{itemId,quantity}] } }
 * PATCH  /api/admin/events/:id      (any of the above fields)
 * DELETE /api/admin/events/:id      (also deletes its joins)
 * GET    /api/admin/events/:id/joins  (who joined + per-user progress)
 * ------------------------------------------------------------------ */

const {
  normalizeEventInput,
  publicEvent,
  whereEquals,
  eventJoinId,
  medalGrantId,
} = require('../lib/events');
const { syncBestWeaponPower } = require('../lib/leaderboard');

function slugify(title) {
  const s = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return (s || 'event') + '-' + Date.now().toString(36);
}

/* ------------------------------------------------------------------ *
 * Leaderboard maintenance.
 *
 * POST /api/admin/leaderboard/backfill — recompute bestWeaponPower for all
 * players (one-time after the leaderboard launches). Bounded to 2000 players.
 * ------------------------------------------------------------------ */

router.post('/admin/leaderboard/backfill', async (req, res) => {
  try {
    let playerIds;
    if (USE_FAKE) {
      playerIds = db._listAll('players').map(({ id }) => id);
    } else {
      const snap = await db.collection('players').select().get();
      playerIds = snap.docs.map((d) => d.id);
    }
    let synced = 0;
    for (const uid of playerIds.slice(0, 2000)) {
      try {
        await db.runTransaction(async (tx) => {
          await syncBestWeaponPower(tx, uid);
        });
        synced += 1;
      } catch {
        /* per-player best-effort */
      }
    }
    await safeLog({ uid: req.uid, type: 'admin_leaderboard_backfill', details: { synced, byUid: req.uid } });
    res.json({ ok: true, synced });
  } catch (e) {
    console.error('POST /api/admin/leaderboard/backfill failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.get('/admin/events', async (req, res) => {
  try {
    const docs = await listDocs('events');
    const events = [];
    for (const { id, data } of docs) {
      const joins = await whereEquals(db, USE_FAKE, 'eventJoins', 'eventId', id);
      let completed = 0;
      let claimed = 0;
      for (const j of joins) {
        if (j.data.completed) completed += 1;
        if (j.data.claimed) claimed += 1;
      }
      events.push({
        ...publicEvent(id, data),
        joinCount: joins.length,
        completedCount: completed,
        claimedCount: claimed,
      });
    }
    events.sort((a, b) => (b.startAt || 0) - (a.startAt || 0));
    res.json({ ok: true, events });
  } catch (e) {
    console.error('GET /api/admin/events failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.post('/admin/events', async (req, res) => {
  try {
    const { event, error } = normalizeEventInput(req.body);
    if (error) return res.status(400).json({ ok: false, error });
    const id = slugify(event.title);
    const now = Date.now();
    await db.collection('events').doc(id).set({
      ...event,
      createdAt: now,
      updatedAt: now,
      createdBy: req.uid,
    });
    await safeLog({ uid: req.uid, type: 'admin_event_create', details: { id, title: event.title, byUid: req.uid } });
    res.json({ ok: true, id, event: publicEvent(id, event) });
  } catch (e) {
    console.error('POST /api/admin/events failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.patch('/admin/events/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').slice(0, 80);
    const ref = db.collection('events').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'not_found' });

    // Merge with existing, then validate the whole thing.
    const merged = { ...snap.data(), ...(req.body || {}) };
    // Don't let id/createdAt be overwritten through the body.
    delete merged.createdAt;
    const { event, error } = normalizeEventInput(merged);
    if (error) return res.status(400).json({ ok: false, error });

    await ref.update({ ...event, updatedAt: Date.now() });
    await safeLog({ uid: req.uid, type: 'admin_event_update', details: { id, byUid: req.uid } });
    res.json({ ok: true, id, event: publicEvent(id, event) });
  } catch (e) {
    console.error('PATCH /api/admin/events/:id failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.delete('/admin/events/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').slice(0, 80);
    const ref = db.collection('events').doc(id);
    if (!(await ref.get()).exists) return res.status(404).json({ ok: false, error: 'not_found' });
    await ref.delete();
    // Remove joins too (bounded).
    const joins = await whereEquals(db, USE_FAKE, 'eventJoins', 'eventId', id);
    for (const j of joins.slice(0, 5000)) {
      await db.collection('eventJoins').doc(j.id).delete();
    }
    await safeLog({ uid: req.uid, type: 'admin_event_delete', details: { id, byUid: req.uid } });
    res.json({ ok: true, id });
  } catch (e) {
    console.error('DELETE /api/admin/events/:id failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.get('/admin/events/:id/joins', async (req, res) => {
  try {
    const id = String(req.params.id || '').slice(0, 80);
    const eventSnap = await db.collection('events').doc(id).get();
    if (!eventSnap.exists) return res.status(404).json({ ok: false, error: 'not_found' });

    const joins = await whereEquals(db, USE_FAKE, 'eventJoins', 'eventId', id);
    const rows = [];
    for (const j of joins.slice(0, 500)) {
      const d = j.data;
      let level = null;
      let displayName = d.displayName || 'Traveler';
      try {
        const prof = await db.collection('publicProfiles').doc(d.uid).get();
        if (prof.exists) {
          level = prof.data().level ?? null;
          displayName = prof.data().displayName || displayName;
        }
      } catch {
        /* non-fatal */
      }
      rows.push({
        uid: d.uid,
        displayName,
        level,
        joinedAt: d.joinedAt || 0,
        progress: d.progress || 0,
        completed: !!d.completed,
        completedAt: d.completedAt || 0,
        claimed: !!d.claimed,
        claimedAt: d.claimedAt || 0,
      });
    }
    rows.sort((a, b) => (b.progress || 0) - (a.progress || 0));

    const totalProgress = rows.reduce((s, r) => s + (r.progress || 0), 0);
    res.json({
      ok: true,
      event: publicEvent(id, eventSnap.data()),
      stats: {
        joined: rows.length,
        completed: rows.filter((r) => r.completed).length,
        claimed: rows.filter((r) => r.claimed).length,
        avgProgress: rows.length ? Math.round((totalProgress / rows.length) * 10) / 10 : 0,
      },
      joins: rows,
    });
  } catch (e) {
    console.error('GET /api/admin/events/:id/joins failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

/* ------------------------------------------------------------------ *
 * Event medals — attach up to 3 named medals per event (via the event
 * create/update payload), then award each medal to one participant.
 * The grant lives in players/{uid}/medals/{eventId}_{medalIndex} and
 * shows as a gold-framed award on the player's profile.
 *
 * GET    /api/admin/events/:id/medals                 list awarded medals
 * POST   /api/admin/events/:id/medals/award          { medalIndex, uid }
 * DELETE /api/admin/events/:id/medals/:medalIndex/:uid   revoke a medal
 *
 * Error codes: not_found, bad_medal, not_joined, already_awarded
 * ------------------------------------------------------------------ */

router.get('/admin/events/:id/medals', async (req, res) => {
  try {
    const id = String(req.params.id || '').slice(0, 80);
    const eventSnap = await db.collection('events').doc(id).get();
    if (!eventSnap.exists) return res.status(404).json({ ok: false, error: 'not_found' });
    const ev = publicEvent(id, eventSnap.data());

    // Collect grants across all players: query each join's player doc.
    const joins = await whereEquals(db, USE_FAKE, 'eventJoins', 'eventId', id);
    const awarded = [];
    for (const j of joins.slice(0, 500)) {
      const uid = j.data.uid;
      for (let i = 0; i < ev.medals.length; i++) {
        try {
          const gsnap = await db
            .collection('players')
            .doc(uid)
            .collection('medals')
            .doc(medalGrantId(id, i))
            .get();
          if (gsnap.exists) {
            const g = gsnap.data();
            awarded.push({
              medalIndex: i,
              medalName: g.medalName,
              medalTier: g.medalTier,
              uid,
              displayName: g.displayName || j.data.displayName || 'Traveler',
              awardedAt: g.awardedAt || 0,
            });
          }
        } catch {
          /* non-fatal per-player */
        }
      }
    }
    awarded.sort((a, b) => a.medalIndex - b.medalIndex);
    res.json({ ok: true, medals: ev.medals, awarded });
  } catch (e) {
    console.error('GET /api/admin/events/:id/medals failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.post('/admin/events/:id/medals/award', async (req, res) => {
  try {
    const id = String(req.params.id || '').slice(0, 80);
    const medalIndex = Math.floor(Number((req.body && req.body.medalIndex) ?? -1));
    const uid = String((req.body && req.body.uid) || '').trim().slice(0, 128);
    if (!uid) return res.status(400).json({ ok: false, error: 'not_found' });

    const eventSnap = await db.collection('events').doc(id).get();
    if (!eventSnap.exists) return res.status(404).json({ ok: false, error: 'not_found' });
    const ev = publicEvent(id, eventSnap.data());
    if (medalIndex < 0 || medalIndex >= ev.medals.length)
      return res.status(400).json({ ok: false, error: 'bad_medal' });
    const medal = ev.medals[medalIndex];

    // Winner must have joined the event.
    const joinSnap = await db
      .collection('eventJoins')
      .doc(eventJoinId(id, uid))
      .get();
    if (!joinSnap.exists) return res.status(400).json({ ok: false, error: 'not_joined' });

    const grantRef = db
      .collection('players')
      .doc(uid)
      .collection('medals')
      .doc(medalGrantId(id, medalIndex));
    if ((await grantRef.get()).exists)
      return res.status(400).json({ ok: false, error: 'already_awarded' });

    const playerSnap = await db.collection('players').doc(uid).get();
    const displayName =
      (playerSnap.exists && playerSnap.data().displayName) ||
      joinSnap.data().displayName ||
      'Traveler';

    await grantRef.set({
      eventId: id,
      eventTitle: ev.title,
      medalIndex,
      medalName: medal.name,
      medalTier: medal.tier,
      uid,
      displayName,
      awardedAt: Date.now(),
      awardedBy: req.uid,
    });
    await safeLog({
      uid: req.uid,
      type: 'admin_event_medal_award',
      details: { eventId: id, medalIndex, medalName: medal.name, toUid: uid, byUid: req.uid },
    });
    res.json({ ok: true, medalIndex, uid, medalName: medal.name, medalTier: medal.tier });
  } catch (e) {
    console.error('POST /api/admin/events/:id/medals/award failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.delete('/admin/events/:id/medals/:medalIndex/:uid', async (req, res) => {
  try {
    const id = String(req.params.id || '').slice(0, 80);
    const medalIndex = Math.floor(Number(req.params.medalIndex ?? -1));
    const uid = String(req.params.uid || '').trim().slice(0, 128);
    const grantRef = db
      .collection('players')
      .doc(uid)
      .collection('medals')
      .doc(medalGrantId(id, medalIndex));
    const snap = await grantRef.get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'not_found' });
    await grantRef.delete();
    await safeLog({
      uid: req.uid,
      type: 'admin_event_medal_revoke',
      details: { eventId: id, medalIndex, fromUid: uid, byUid: req.uid },
    });
    res.json({ ok: true, medalIndex, uid });
  } catch (e) {
    console.error('DELETE /api/admin/events/:id/medals failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

/* ------------------------------------------------------------------ *
 * Support tickets.
 *
 * GET  /api/admin/support                  list tickets (?status=pending|checking|solved, ?limit=)
 * GET  /api/admin/support/unread-count     count of tickets with unreadByAdmin
 * GET  /api/admin/support/:ticketId        full ticket with message thread
 * POST /api/admin/support/:ticketId/reply  admin reply {text}
 * POST /api/admin/support/:ticketId/status admin sets status {status}
 * POST /api/admin/support/:ticketId/read   mark ticket as read by admin
 *
 * Error codes: not_found, bad_text, bad_status
 * ------------------------------------------------------------------ */

const SUPPORT_STATUSES = ['pending', 'checking', 'solved'];

function publicSupportTicket(id, d) {
  return {
    ticketId: id,
    uid: d.uid || '',
    displayName: d.displayName || '',
    email: d.email || '',
    title: d.title || '',
    description: d.description || '',
    status: d.status || 'pending',
    unreadByAdmin: !!d.unreadByAdmin,
    messageCount: (d.messages || []).length,
    createdAt: toMillis(d.createdAt),
    updatedAt: toMillis(d.updatedAt),
    messages: (d.messages || []).map((m) => ({
      sender: m.sender,
      text: m.text,
      createdAt: toMillis(m.createdAt),
    })),
  };
}

async function getSupportTicket(ticketId) {
  const snap = await db.collection('supportTickets').doc(ticketId).get();
  if (!snap.exists) return null;
  return { ref: snap.ref, id: snap.id, data: snap.data() };
}

/** List tickets, newest first, optional status filter. */
router.get('/admin/support', async (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    let rows = await listDocs('supportTickets');
    if (status && SUPPORT_STATUSES.includes(status)) {
      rows = rows.filter((r) => (r.data.status || 'pending') === status);
    }
    rows.sort((a, b) => (b.data.updatedAt || 0) - (a.data.updatedAt || 0));
    const tickets = rows.slice(0, limit).map((r) => publicSupportTicket(r.id, r.data));
    const unread = rows.filter((r) => r.data.unreadByAdmin).length;
    res.json({ ok: true, tickets, unreadCount: unread });
  } catch (e) {
    console.error('GET /api/admin/support failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

/** Count tickets with unread admin messages. */
router.get('/admin/support/unread-count', async (req, res) => {
  try {
    const rows = await listDocs('supportTickets');
    res.json({ ok: true, unreadCount: rows.filter((r) => r.data.unreadByAdmin).length });
  } catch (e) {
    console.error('GET /api/admin/support/unread-count failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

/** Full ticket detail. */
router.get('/admin/support/:ticketId', async (req, res) => {
  try {
    const t = await getSupportTicket(req.params.ticketId);
    if (!t) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, ticket: publicSupportTicket(t.id, t.data) });
  } catch (e) {
    console.error('GET /api/admin/support/:ticketId failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

/** Admin replies to a ticket. */
router.post('/admin/support/:ticketId/reply', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text || text.length > 2000) {
      return res.status(400).json({ ok: false, error: 'bad_text' });
    }
    const t = await getSupportTicket(req.params.ticketId);
    if (!t) return res.status(404).json({ ok: false, error: 'not_found' });
    const now = Date.now();
    const messages = [...(t.data.messages || []), { sender: 'admin', text, createdAt: now }];
    await t.ref.update({ messages, unreadByUser: true, unreadByAdmin: false, updatedAt: now });
    try {
      await logActivity(db, {
        uid: t.data.uid,
        type: 'support_reply',
        details: { ticketId: t.id, by: req.uid },
      });
    } catch (e) {
      console.error('support reply activity log failed:', e && e.message);
    }
    const snap = await t.ref.get();
    res.json({ ok: true, ticket: publicSupportTicket(t.id, snap.data()) });
  } catch (e) {
    console.error('POST /api/admin/support/:ticketId/reply failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

/** Admin sets a ticket's status. */
router.post('/admin/support/:ticketId/status', async (req, res) => {
  try {
    const status = String(req.body?.status || '').trim();
    if (!SUPPORT_STATUSES.includes(status)) {
      return res.status(400).json({ ok: false, error: 'bad_status' });
    }
    const t = await getSupportTicket(req.params.ticketId);
    if (!t) return res.status(404).json({ ok: false, error: 'not_found' });
    await t.ref.update({ status, updatedAt: Date.now() });
    try {
      await logActivity(db, {
        uid: t.data.uid,
        type: 'support_status',
        details: { ticketId: t.id, status, by: req.uid },
      });
    } catch (e) {
      console.error('support status activity log failed:', e && e.message);
    }
    const snap = await t.ref.get();
    res.json({ ok: true, ticket: publicSupportTicket(t.id, snap.data()) });
  } catch (e) {
    console.error('POST /api/admin/support/:ticketId/status failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

/** Mark a ticket as read by the admin (clears the "new" flag). */
router.post('/admin/support/:ticketId/read', async (req, res) => {
  try {
    const t = await getSupportTicket(req.params.ticketId);
    if (!t) return res.status(404).json({ ok: false, error: 'not_found' });
    await t.ref.update({ unreadByAdmin: false });
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/admin/support/:ticketId/read failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

module.exports = router;
