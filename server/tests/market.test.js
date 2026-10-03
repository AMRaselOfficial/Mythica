'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

require('./helpers');
const { db, resetFakeDb, startServer, post, seedPlayer, seedInv, getInvQty, getPlayer } = require('./helpers');

test('market: list validates inputs', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const uid = 'mk-val';
    await seedPlayer(uid, 20);
    await seedInv(uid, 'moss-wisp', 3);

    // unknown item -> not_sellable
    let r = await post(base, '/api/market/list', uid, { itemId: 'nope', quantity: 1, price: 10 });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'not_sellable');

    // more than owned -> insufficient_quantity
    r = await post(base, '/api/market/list', uid, { itemId: 'moss-wisp', quantity: 99, price: 10 });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'insufficient_quantity');

    // bad price -> bad_price
    r = await post(base, '/api/market/list', uid, { itemId: 'moss-wisp', quantity: 1, price: 0 });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'bad_price');

    // inventory untouched by failed listings
    assert.equal(await getInvQty(uid, 'moss-wisp'), 3);
  } finally {
    await close();
  }
});

test('market: list creates a listing and decrements inventory', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const uid = 'mk-list';
    await seedPlayer(uid, 20);
    await seedInv(uid, 'moss-wisp', 5);

    const r = await post(base, '/api/market/list', uid, { itemId: 'moss-wisp', quantity: 2, price: 50 });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.ok(typeof r.json.listingId === 'string' && r.json.listingId.length > 0);

    assert.equal(await getInvQty(uid, 'moss-wisp'), 3);
    const l = await db.collection('marketplace').doc(r.json.listingId).get();
    assert.ok(l.exists);
    assert.deepEqual(
      (({ sellerUid, itemId, quantity, price, status }) => ({ sellerUid, itemId, quantity, price, status }))(l.data()),
      { sellerUid: uid, itemId: 'moss-wisp', quantity: 2, price: 50, status: 'active' }
    );
  } finally {
    await close();
  }
});

test('market: purchase is atomic and idempotent (no double-spend)', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const seller = 'mk-seller', buyer = 'mk-buyer';
    await seedPlayer(seller, 20);
    await seedPlayer(buyer, 100);
    await seedInv(seller, 'moss-wisp', 5);

    const listed = await post(base, '/api/market/list', seller, { itemId: 'moss-wisp', quantity: 2, price: 50 });
    const listingId = listed.json.listingId;

    const key = 'idem-purchase-1';
    const r1 = await post(base, '/api/market/purchase', buyer, { listingId, idempotencyKey: key });
    assert.equal(r1.status, 200);
    assert.deepEqual(r1.json, { ok: true, itemId: 'moss-wisp', quantity: 2, price: 50 });

    // Atomic effects: buyer -50 petals, seller +50, buyer +2 items, listing sold.
    assert.equal((await getPlayer(buyer)).petals, 50);
    assert.equal((await getPlayer(seller)).petals, 70);
    assert.equal(await getInvQty(buyer, 'moss-wisp'), 2);
    const l1 = await db.collection('marketplace').doc(listingId).get();
    assert.equal(l1.data().status, 'sold');
    assert.equal(l1.data().buyerUid, buyer);
    assert.ok(l1.data().soldAt > 0);

    // Replay with the same key: identical result, zero additional movement.
    const r2 = await post(base, '/api/market/purchase', buyer, { listingId, idempotencyKey: key });
    assert.equal(r2.status, 200);
    assert.deepEqual(r2.json, r1.json);
    assert.equal((await getPlayer(buyer)).petals, 50);
    assert.equal((await getPlayer(seller)).petals, 70);
    assert.equal(await getInvQty(buyer, 'moss-wisp'), 2);

    // Same listing, fresh key -> listing_unavailable (already sold).
    const r3 = await post(base, '/api/market/purchase', buyer, { listingId, idempotencyKey: 'idem-purchase-2' });
    assert.equal(r3.status, 400);
    assert.equal(r3.json.error, 'listing_unavailable');
  } finally {
    await close();
  }
});

test('market: purchase rejects own listing, insufficient petals, missing fields', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const seller = 'mk-s2', poor = 'mk-poor';
    await seedPlayer(seller, 20);
    await seedPlayer(poor, 5);
    await seedInv(seller, 'ember-fox', 1);

    const listed = await post(base, '/api/market/list', seller, { itemId: 'ember-fox', quantity: 1, price: 50 });
    const listingId = listed.json.listingId;

    // own listing
    let r = await post(base, '/api/market/purchase', seller, { listingId, idempotencyKey: 'k-own' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'own_listing');

    // insufficient petals
    r = await post(base, '/api/market/purchase', poor, { listingId, idempotencyKey: 'k-poor' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'insufficient_petals');
    assert.equal((await getPlayer(poor)).petals, 5); // untouched

    // missing idempotency key
    r = await post(base, '/api/market/purchase', poor, { listingId });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'bad_request');

    // listing still active after the rejections
    const l = await db.collection('marketplace').doc(listingId).get();
    assert.equal(l.data().status, 'active');
  } finally {
    await close();
  }
});
