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
 * POST /api/admin/users/:uid/inventory/add    { itemId, quantity }
 * POST /api/admin/users/:uid/inventory/remove { itemId, quantity }
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
} = require('../lib/events');

function slugify(title) {
  const s = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return (s || 'event') + '-' + Date.now().toString(36);
}

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

module.exports = router;
