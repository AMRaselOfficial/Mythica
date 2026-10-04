'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

require('./helpers');
const { db, resetFakeDb, startServer, post, seedPlayer, seedInv, getPlayer } = require('./helpers');

async function invDoc(uid, itemId) {
  const snap = await db.collection('inventories').doc(uid).collection('items').doc(itemId).get();
  return snap.exists ? snap.data() : null;
}

test('upgrade: deducts petals, bumps level, idempotent replay', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const uid = 'up-a';
    await seedPlayer(uid, 200);
    await seedInv(uid, 'thornblade', 1, 0); // upgradeCosts [40, 120], maxLevel 3
    await seedInv(uid, 'test-shard', 10, 0); // materials: [2], then [3]

    const key = 'idem-up-1';
    const r1 = await post(base, '/api/upgrade', uid, { itemId: 'thornblade', idempotencyKey: key });
    assert.equal(r1.status, 200);
    assert.deepEqual(r1.json, { ok: true, itemId: 'thornblade', newLevel: 1 });
    assert.equal((await getPlayer(uid)).petals, 160); // 200 - 40
    assert.equal((await invDoc(uid, 'thornblade')).upgradeLevel, 1);
    assert.equal((await invDoc(uid, 'test-shard')).quantity, 8); // 10 - 2

    // Replay same key: same result, no double charge.
    const r2 = await post(base, '/api/upgrade', uid, { itemId: 'thornblade', idempotencyKey: key });
    assert.equal(r2.status, 200);
    assert.deepEqual(r2.json, r1.json);
    assert.equal((await getPlayer(uid)).petals, 160);
    assert.equal((await invDoc(uid, 'test-shard')).quantity, 8);

    // Second level with a fresh key costs 120 + 3 shards.
    const r3 = await post(base, '/api/upgrade', uid, { itemId: 'thornblade', idempotencyKey: 'idem-up-2' });
    assert.equal(r3.status, 200);
    assert.deepEqual(r3.json, { ok: true, itemId: 'thornblade', newLevel: 2 });
    assert.equal((await getPlayer(uid)).petals, 40);
    assert.equal((await invDoc(uid, 'test-shard')).quantity, 5); // 8 - 3
  } finally {
    await close();
  }
});

test('upgrade: validation errors (max_level, insufficient_petals, not_upgradeable, not_owned)', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const uid = 'up-v';
    await seedPlayer(uid, 10);
    await seedInv(uid, 'thornblade', 1, 0); // cost 40, player has 10
    await seedInv(uid, 'test-shard', 10, 0);
    await seedInv(uid, 'ember-fox', 1, 0); // not upgradeable

    // insufficient petals
    let r = await post(base, '/api/upgrade', uid, { itemId: 'thornblade', idempotencyKey: 'k-ip' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'insufficient_petals');
    assert.equal((await getPlayer(uid)).petals, 10);

    // not upgradeable
    r = await post(base, '/api/upgrade', uid, { itemId: 'ember-fox', idempotencyKey: 'k-nu' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'not_upgradeable');

    // max level reached (thornblade maxLevel 3, costs [40,120]: level 2 is maxed)
    const uid2 = 'up-v2';
    await seedPlayer(uid2, 500);
    await seedInv(uid2, 'thornblade', 1, 2);
    await seedInv(uid2, 'test-shard', 10, 0);
    r = await post(base, '/api/upgrade', uid2, { itemId: 'thornblade', idempotencyKey: 'k-ml' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'max_level');

    // not owned (upgradeable item, but never in this player's inventory)
    const uid3 = 'up-v3';
    await seedPlayer(uid3, 500);
    r = await post(base, '/api/upgrade', uid3, { itemId: 'thornblade', idempotencyKey: 'k-no' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'not_owned');
  } finally {
    await close();
  }
});

test('upgrade: insufficient_materials blocks, exact materials succeed', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const uid = 'up-m';
    await seedPlayer(uid, 500);
    await seedInv(uid, 'thornblade', 1, 0); // needs 2 test-shards for level 1
    await seedInv(uid, 'test-shard', 1, 0); // only 1

    let r = await post(base, '/api/upgrade', uid, { itemId: 'thornblade', idempotencyKey: 'k-im' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'insufficient_materials');
    assert.equal((await invDoc(uid, 'test-shard')).quantity, 1); // untouched
    assert.equal((await getPlayer(uid)).petals, 500); // untouched

    // No shards at all.
    const uid2 = 'up-m2';
    await seedPlayer(uid2, 500);
    await seedInv(uid2, 'thornblade', 1, 0);
    r = await post(base, '/api/upgrade', uid2, { itemId: 'thornblade', idempotencyKey: 'k-im2' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'insufficient_materials');

    // Exact amount succeeds and consumes the last shards (doc deleted at 0).
    const uid3 = 'up-m3';
    await seedPlayer(uid3, 500);
    await seedInv(uid3, 'thornblade', 1, 0);
    await seedInv(uid3, 'test-shard', 2, 0);
    r = await post(base, '/api/upgrade', uid3, { itemId: 'thornblade', idempotencyKey: 'k-im3' });
    assert.equal(r.status, 200);
    assert.equal(r.json.newLevel, 1);
    assert.equal(await invDoc(uid3, 'test-shard'), null); // 2 - 2 = 0, removed
  } finally {
    await close();
  }
});
