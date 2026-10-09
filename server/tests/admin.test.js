'use strict';
/**
 * Admin + ban + activity-logging + listing-cancel tests.
 * Fake modes: USE_FAKE_DB=1 FAKE_AUTH=1 (set in ./helpers).
 * Admin tokens: `Bearer test-admin-<uid>`; plain users: `Bearer test-<uid>`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');

require('./helpers');
const {
  db,
  resetFakeDb,
  contentApi,
  startServer,
  post,
  get,
  seedPlayer,
  seedInv,
  getPlayer,
  getInvQty,
} = require('./helpers');

function adminHeaders(uid) {
  return { Authorization: `Bearer test-admin-${uid}`, 'Content-Type': 'application/json' };
}

async function adminPost(base, path, uid, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: adminHeaders(uid),
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function adminGet(base, path, uid) {
  const res = await fetch(base + path, { headers: adminHeaders(uid) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

function activityLogs() {
  return db._listAll('activityLogs').map(({ id, data }) => ({ id, ...data() }));
}

function findLog(type, uid) {
  return activityLogs().find((l) => l.type === type && l.uid === uid);
}

/* ------------------------------ requireAdmin ----------------------------- */

test('admin/me: 401 with no token, 401 with bad token', async () => {
  const { base, close } = await startServer();
  try {
    let r = await get(base, '/api/admin/me', {});
    assert.equal(r.status, 401);
    assert.deepEqual(r.json, { ok: false, error: 'unauthorized' });

    r = await get(base, '/api/admin/me', { Authorization: 'Bearer junk' });
    assert.equal(r.status, 401);
    assert.deepEqual(r.json, { ok: false, error: 'unauthorized' });
  } finally {
    await close();
  }
});

test('admin/me: 403 for non-admin token, 200 for admin token', async () => {
  const { base, close } = await startServer();
  try {
    const r = await get(base, '/api/admin/me', {
      Authorization: 'Bearer test-plainbob',
    });
    assert.equal(r.status, 403);
    assert.deepEqual(r.json, { ok: false, error: 'forbidden' });

    const a = await adminGet(base, '/api/admin/me', 'boss');
    assert.equal(a.status, 200);
    assert.deepEqual(a.json, { ok: true, admin: true, uid: 'boss', email: '' });
  } finally {
    await close();
  }
});

test('admin routes require admin: non-admin cannot list users or ban', async () => {
  const { base, close } = await startServer();
  try {
    const r = await fetch(base + '/api/admin/users', {
      headers: { Authorization: 'Bearer test-plainbob' },
    });
    assert.equal(r.status, 403);

    const b = await post(base, '/api/admin/users/someone/ban', 'plainbob', {});
    assert.equal(b.status, 403);
    assert.deepEqual(b.json, { ok: false, error: 'forbidden' });
  } finally {
    await close();
  }
});

/* -------------------------------- ban flow ------------------------------- */

test('ban flow: banned account gets 403 on gameplay; unban restores it', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const uid = 'banflow-x';
    await seedPlayer(uid);
    await db.collection('players').doc(uid).update({ accountStatus: 'banned' });

    const hunt = await post(base, '/api/hunt', uid, {});
    assert.equal(hunt.status, 403);
    assert.deepEqual(hunt.json, { ok: false, error: 'account_banned' });

    const unban = await adminPost(base, `/api/admin/users/${uid}/unban`, 'boss', {});
    assert.equal(unban.status, 200);
    assert.deepEqual(unban.json, { ok: true, accountStatus: 'active' });

    const p = await getPlayer(uid);
    assert.equal(p.accountStatus, 'active');

    const hunt2 = await post(base, '/api/hunt', uid, {});
    assert.equal(hunt2.status, 200);
    assert.equal(hunt2.json.ok, true);

    const unbanLog = findLog('unban', uid);
    assert.ok(unbanLog, 'unban writes an activity log');
    assert.deepEqual(unbanLog.details, { targetUid: uid, byUid: 'boss' });
  } finally {
    await close();
  }
});

test('ban endpoint: sets banned, blocks gameplay, logs; 404 for unknown uid', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const uid = 'bantarget';
    await seedPlayer(uid);

    const missing = await adminPost(base, '/api/admin/users/no-such-user/ban', 'boss', {});
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.json, { ok: false, error: 'not_found' });

    const ban = await adminPost(base, `/api/admin/users/${uid}/ban`, 'boss', {});
    assert.equal(ban.status, 200);
    assert.deepEqual(ban.json, { ok: true, accountStatus: 'banned' });
    assert.equal((await getPlayer(uid)).accountStatus, 'banned');

    const hunt = await post(base, '/api/hunt', uid, {});
    assert.equal(hunt.status, 403);
    assert.deepEqual(hunt.json, { ok: false, error: 'account_banned' });

    const banLog = findLog('ban', uid);
    assert.ok(banLog, 'ban writes an activity log');
    assert.deepEqual(banLog.details, { targetUid: uid, byUid: 'boss' });
  } finally {
    await close();
  }
});

test('ban cache invalidates on ban/unban (no stale 60s window)', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const uid = 'bancache';
    await seedPlayer(uid);
    // Prime the ban cache with a clean request.
    const ok1 = await post(base, '/api/hunt', uid, {});
    assert.equal(ok1.status, 200);

    // Ban directly in the db (bypasses the route's invalidation) would go
    // stale — but the route itself must invalidate, so ban via the route:
    await db.collection('players').doc(uid).update({ lastHuntAt: 0 });
    const ban = await adminPost(base, `/api/admin/users/${uid}/ban`, 'boss', {});
    assert.equal(ban.status, 200);

    // Immediately blocked: no stale "active" from the cache.
    const hunt = await post(base, '/api/hunt', uid, {});
    assert.equal(hunt.status, 403);
    assert.deepEqual(hunt.json, { ok: false, error: 'account_banned' });
  } finally {
    await close();
  }
});

/* ----------------------------- activity logging -------------------------- */

test('hunt writes an activityLogs doc with type hunt and drop rarity', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const uid = 'loghunter';
    const { status, json } = await post(base, '/api/hunt', uid, {});
    assert.equal(status, 200);

    const log = findLog('hunt', uid);
    assert.ok(log, 'expected one hunt activity log');
    assert.equal(log.type, 'hunt');
    assert.equal(log.details.xpGained, json.xpGained);
    assert.equal(log.details.petalsFound, json.petalsFound);
    assert.equal(log.details.leveledUp, json.leveledUp);
    if (json.drop) {
      assert.equal(log.details.dropItemId, json.drop.itemId);
      assert.equal(log.details.dropRarity, json.drop.rarity);
    } else {
      assert.equal(log.details.dropItemId, null);
      assert.equal(log.details.dropRarity, null);
    }
    assert.ok(typeof log.createdAt === 'number' && log.createdAt > 0);
  } finally {
    await close();
  }
});

test('listing create + purchase write activity logs', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const sellItem = contentApi.content.items.find((i) => i.sellable).id;
    const seller = 'logseller';
    const buyer = 'logbuyer';
    await seedPlayer(seller);
    await seedPlayer(buyer, 500);
    await seedInv(seller, sellItem, 3);

    const listed = await post(base, '/api/market/list', seller, {
      itemId: sellItem,
      quantity: 1,
      price: 75,
    });
    assert.equal(listed.status, 200);
    const listingId = listed.json.listingId;

    const created = findLog('listing_created', seller);
    assert.ok(created, 'listing_created log written');
    assert.deepEqual(created.details, {
      listingId,
      itemId: sellItem,
      quantity: 1,
      price: 75,
    });

    const bought = await post(base, '/api/market/purchase', buyer, {
      listingId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(bought.status, 200);

    const purchased = findLog('purchase', buyer);
    assert.ok(purchased, 'purchase log written');
    assert.deepEqual(purchased.details, {
      listingId,
      itemId: sellItem,
      quantity: 1,
      price: 75,
      sellerUid: seller,
      buyerUid: buyer,
    });
  } finally {
    await close();
  }
});

test('upgrade and trade completion write activity logs', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const upItem = contentApi.content.items.find((i) => i.upgradeable);
    const uid = 'logupgrader';
    await seedPlayer(uid, 500);
    await seedInv(uid, upItem.id, 1, 0);
    // Seed any upgrade materials the item requires.
    for (const m of (upItem.upgradeMaterials || [])[0] || []) {
      await seedInv(uid, m.id, m.qty, 0);
    }

    const up = await post(base, '/api/upgrade', uid, {
      itemId: upItem.id,
      idempotencyKey: randomUUID(),
    });
    assert.equal(up.status, 200);
    const upLog = findLog('upgrade', uid);
    assert.ok(upLog, 'upgrade log written');
    assert.deepEqual(upLog.details, {
      itemId: upItem.id,
      newLevel: 1,
      cost: upItem.upgradeCosts[0],
      materials: (upItem.upgradeMaterials || [])[0] || [],
    });

    const sellItem = contentApi.content.items.find((i) => i.sellable).id;
    const a = 'logtrader-a';
    const b = 'logtrader-b';
    await seedPlayer(a);
    await seedPlayer(b);
    await seedInv(a, sellItem, 2);
    await seedInv(b, sellItem, 2);
    const tradeId = randomUUID();
    await db.collection('trades').doc(tradeId).set({
      offeredBy: a,
      offeredTo: b,
      offerItemId: sellItem,
      offerQty: 1,
      wantItemId: sellItem,
      wantQty: 1,
      status: 'accepted',
      createdAt: Date.now(),
    });
    const done = await post(base, '/api/trades/complete', a, {
      tradeId,
      idempotencyKey: randomUUID(),
    });
    assert.equal(done.status, 200);
    const tradeLog = findLog('trade_completed', a);
    assert.ok(tradeLog, 'trade_completed log written');
    assert.deepEqual(tradeLog.details, {
      tradeId,
      offeredBy: a,
      offeredTo: b,
      offerItemId: sellItem,
      offerQty: 1,
      wantItemId: sellItem,
      wantQty: 1,
    });
  } finally {
    await close();
  }
});

/* ------------------------------ market cancel ---------------------------- */

test('market/cancel: cancels own listing, restores inventory, logs', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const sellItem = contentApi.content.items.find((i) => i.sellable).id;
    const uid = 'canceller';
    await seedPlayer(uid);
    await seedInv(uid, sellItem, 3);

    const listed = await post(base, '/api/market/list', uid, {
      itemId: sellItem,
      quantity: 2,
      price: 50,
    });
    assert.equal(listed.status, 200);
    const listingId = listed.json.listingId;
    assert.equal(await getInvQty(uid, sellItem), 1);

    const canceled = await post(base, '/api/market/cancel', uid, { listingId });
    assert.equal(canceled.status, 200);
    assert.deepEqual(canceled.json, { ok: true, listingId });

    const lSnap = await db.collection('marketplace').doc(listingId).get();
    assert.equal(lSnap.data().status, 'canceled');
    assert.equal(await getInvQty(uid, sellItem), 3);

    const log = findLog('listing_canceled', uid);
    assert.ok(log, 'listing_canceled log written');
    assert.deepEqual(log.details, { listingId });

    // Second cancel -> bad_state; unknown id -> not_found; other user -> not_seller.
    const again = await post(base, '/api/market/cancel', uid, { listingId });
    assert.equal(again.status, 400);
    assert.deepEqual(again.json, { ok: false, error: 'bad_state' });

    const missing = await post(base, '/api/market/cancel', uid, { listingId: 'nope' });
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.json, { ok: false, error: 'not_found' });

    const other = await post(base, '/api/market/cancel', 'someone-else', { listingId });
    assert.equal(other.status, 403);
    assert.deepEqual(other.json, { ok: false, error: 'not_seller' });
  } finally {
    await close();
  }
});

/* --------------------------------- stats --------------------------------- */

test('admin/stats: counts today from activityLogs, totals users', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    await seedPlayer('stat-a');
    await seedPlayer('stat-b');
    const hunt = await post(base, '/api/hunt', 'stat-a', {});
    assert.equal(hunt.status, 200);

    const now = new Date();
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const col = db.collection('activityLogs');
    await col.doc().set({ uid: 'stat-b', type: 'purchase', details: { price: 75 }, createdAt: Date.now() });
    await col.doc().set({ uid: 'stat-b', type: 'purchase', details: { price: 25 }, createdAt: Date.now() });
    await col.doc().set({ uid: 'stat-a', type: 'trade_completed', details: {}, createdAt: Date.now() });
    // Yesterday's hunt must not count.
    await col.doc().set({ uid: 'stat-a', type: 'hunt', details: {}, createdAt: todayStart - 1000 });

    const { status, json } = await adminGet(base, '/api/admin/stats', 'boss');
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.totalUsers, 2);
    assert.equal(json.huntsToday, 1);
    assert.equal(json.tradesToday, 1);
    assert.equal(json.marketplaceVolumeToday, 100);
  } finally {
    await close();
  }
});

/* ------------------------------ users search ----------------------------- */

async function seedSearchUsers() {
  const now = Date.now();
  const mk = (uid, displayName, email) =>
    db.collection('players').doc(uid).set({
      displayName,
      email,
      petals: 20,
      level: 1,
      xp: 0,
      createdAt: now,
      updatedAt: now,
      lastHuntAt: 0,
      musicEnabled: true,
      sfxEnabled: true,
      accountStatus: 'active',
    });
  await mk('u-alice', 'Alice', 'alice@example.com');
  await mk('u-bob', 'Bob', 'bob@sample.org');
  await mk('u-carol', 'Carol', 'carol@example.com');
}

test('admin/users: search filters email/displayName case-insensitively', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    await seedSearchUsers();

    let r = await adminGet(base, '/api/admin/users?search=example.com', 'boss');
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.deepEqual(
      r.json.users.map((u) => u.uid).sort(),
      ['u-alice', 'u-carol']
    );
    for (const u of r.json.users) {
      assert.ok(typeof u.petals === 'number');
      assert.ok(typeof u.level === 'number');
      assert.ok(typeof u.accountStatus === 'string');
      assert.ok('createdAt' in u);
    }

    r = await adminGet(base, '/api/admin/users?search=ALICE', 'boss');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.users.map((u) => u.uid), ['u-alice']);

    r = await adminGet(base, '/api/admin/users?search=bob', 'boss');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.users.map((u) => u.uid), ['u-bob']);

    r = await adminGet(base, '/api/admin/users?search=zzz-no-match', 'boss');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.users, []);
    assert.equal(r.json.nextPageToken, null);
  } finally {
    await close();
  }
});

test('admin/users: pagination with limit + pageToken', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    await seedSearchUsers();

    const p1 = await adminGet(base, '/api/admin/users?limit=2', 'boss');
    assert.equal(p1.status, 200);
    assert.equal(p1.json.users.length, 2);
    assert.ok(p1.json.nextPageToken, 'more pages remain');

    const p2 = await adminGet(base, `/api/admin/users?limit=2&pageToken=${p1.json.nextPageToken}`, 'boss');
    assert.equal(p2.status, 200);
    assert.equal(p2.json.users.length, 1);
    assert.equal(p2.json.nextPageToken, null);

    const all = [...p1.json.users, ...p2.json.users].map((u) => u.uid).sort();
    assert.deepEqual(all, ['u-alice', 'u-bob', 'u-carol']);
  } finally {
    await close();
  }
});

test('admin/users/:uid: full detail shape; 404 for unknown', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    await seedSearchUsers();
    const sellItem = contentApi.content.items.find((i) => i.sellable);
    const uid = 'u-alice';
    await seedInv(uid, sellItem.id, 5, 0);
    const listed = await post(base, '/api/market/list', uid, {
      itemId: sellItem.id,
      quantity: 1,
      price: 30,
    });
    assert.equal(listed.status, 200);
    const hunt = await post(base, '/api/hunt', uid, {});
    assert.equal(hunt.status, 200);

    const r = await adminGet(base, `/api/admin/users/${uid}`, 'boss');
    assert.equal(r.status, 200);
    const j = r.json;
    assert.equal(j.ok, true);
    assert.equal(j.user.uid, uid);
    assert.equal(j.user.displayName, 'Alice');
    assert.equal(j.user.email, 'alice@example.com');
    assert.ok('lastHuntAt' in j.user);
    assert.ok('musicEnabled' in j.user);

    const invEntry = j.inventory.find((e) => e.itemId === sellItem.id);
    assert.ok(invEntry, 'listed item still in inventory');
    assert.equal(invEntry.name, sellItem.name);
    assert.equal(invEntry.rarity, sellItem.rarity);
    // 5 seeded - 1 listed, plus 1 more if the hunt happened to drop the same item.
    const expectedQty = 4 + (hunt.json.drop && hunt.json.drop.itemId === sellItem.id ? 1 : 0);
    assert.equal(invEntry.quantity, expectedQty);
    assert.equal(invEntry.upgradeLevel, 0);

    assert.equal(j.hunts.length, 1);
    assert.equal(j.hunts[0].type, 'hunt');

    assert.equal(j.listings.length, 1);
    assert.equal(j.listings[0].id, listed.json.listingId);
    assert.equal(j.listings[0].status, 'active');

    assert.deepEqual(j.trades, []);
    assert.ok(j.activity.length >= 2, 'hunt + listing_created logs');

    const missing = await adminGet(base, '/api/admin/users/nope', 'boss');
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.json, { ok: false, error: 'not_found' });
  } finally {
    await close();
  }
});
/* --------------------------- admin email change -------------------------- */

async function seedPlayerWithEmail(uid, email) {
  await seedPlayer(uid);
  await db.collection('players').doc(uid).update({ email });
}

test('admin email change: 403 for non-admin token', async () => {
  const { base, close } = await startServer();
  try {
    const res = await fetch(base + '/api/admin/users/u1/email', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-user-u1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'newaddr@gmail.com' }),
    });
    assert.equal(res.status, 403);
  } finally {
    await close();
  }
});

test('admin email change: rejects invalid email', async () => {
  const { base, close } = await startServer();
  try {
    resetFakeDb();
    await seedPlayerWithEmail('u1', 'old@gmail.com');
    const r = await adminPost(base, '/api/admin/users/u1/email', 'boss', { email: 'not-an-email' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'invalid_email');
  } finally {
    await close();
  }
});

test('admin email change: rejects disallowed provider', async () => {
  const { base, close } = await startServer();
  try {
    resetFakeDb();
    await seedPlayerWithEmail('u1', 'old@gmail.com');
    const r = await adminPost(base, '/api/admin/users/u1/email', 'boss', { email: 'u1@mailinator.com' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'email_provider_not_allowed');
  } finally {
    await close();
  }
});

test('admin email change: 404 for unknown player', async () => {
  const { base, close } = await startServer();
  try {
    resetFakeDb();
    const r = await adminPost(base, '/api/admin/users/ghost/email', 'boss', { email: 'newaddr@gmail.com' });
    assert.equal(r.status, 404);
    assert.equal(r.json.error, 'not_found');
  } finally {
    await close();
  }
});

test('admin email change: rejects same email', async () => {
  const { base, close } = await startServer();
  try {
    resetFakeDb();
    await seedPlayerWithEmail('u1', 'old@gmail.com');
    const r = await adminPost(base, '/api/admin/users/u1/email', 'boss', { email: 'OLD@gmail.com' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'same_email');
  } finally {
    await close();
  }
});

test('admin email change: 409 when address belongs to another player', async () => {
  const { base, close } = await startServer();
  try {
    resetFakeDb();
    await seedPlayerWithEmail('u1', 'one@gmail.com');
    await seedPlayerWithEmail('u2', 'two@yahoo.com');
    const r = await adminPost(base, '/api/admin/users/u1/email', 'boss', { email: 'two@yahoo.com' });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'email_in_use');
  } finally {
    await close();
  }
});

test('admin email change: success updates doc and logs activity', async () => {
  const { base, close } = await startServer();
  try {
    resetFakeDb();
    await seedPlayerWithEmail('u1', 'old@gmail.com');
    const r = await adminPost(base, '/api/admin/users/u1/email', 'boss', { email: '  NewAddr@Yahoo.com ' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, email: 'newaddr@yahoo.com' });
    const p = (await db.collection('players').doc('u1').get()).data();
    assert.equal(p.email, 'newaddr@yahoo.com');
    const log = findLog('email_change', 'u1');
    assert.ok(log, 'email_change activity log exists');
    assert.equal(log.details.oldEmail, 'old@gmail.com');
    assert.equal(log.details.newEmail, 'newaddr@yahoo.com');
    assert.equal(log.details.byUid, 'boss');
  } finally {
    await close();
  }
});
