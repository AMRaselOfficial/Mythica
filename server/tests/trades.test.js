'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

require('./helpers');
const { db, resetFakeDb, startServer, post, seedPlayer, seedInv, getInvQty } = require('./helpers');

async function seedTrade(id, fields) {
  await db.collection('trades').doc(id).set({
    status: 'offered',
    createdAt: Date.now(),
    ...fields,
  });
}

test('trades: complete swaps quantities atomically and is idempotent', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const a = 'tr-a', b = 'tr-b';
    await seedPlayer(a, 20);
    await seedPlayer(b, 20);
    await seedInv(a, 'ember-fox', 2);
    await seedInv(b, 'moss-wisp', 3);
    await seedTrade('trade-1', {
      offeredBy: a,
      offeredTo: b,
      offerItemId: 'ember-fox',
      offerQty: 1,
      wantItemId: 'moss-wisp',
      wantQty: 2,
      status: 'accepted',
    });

    const key = 'idem-trade-1';
    const r1 = await post(base, '/api/trades/complete', b, { tradeId: 'trade-1', idempotencyKey: key });
    assert.equal(r1.status, 200);
    assert.deepEqual(r1.json, { ok: true });

    // Atomic swap: A gives 1 ember-fox, gets 2 moss-wisp; B the reverse.
    assert.equal(await getInvQty(a, 'ember-fox'), 1);
    assert.equal(await getInvQty(a, 'moss-wisp'), 2);
    assert.equal(await getInvQty(b, 'ember-fox'), 1);
    assert.equal(await getInvQty(b, 'moss-wisp'), 1);
    const t = await db.collection('trades').doc('trade-1').get();
    assert.equal(t.data().status, 'completed');
    assert.ok(t.data().completedAt > 0);

    // Idempotent replay: same result, no further movement.
    const r2 = await post(base, '/api/trades/complete', a, { tradeId: 'trade-1', idempotencyKey: key });
    assert.equal(r2.status, 200);
    assert.deepEqual(r2.json, { ok: true });
    assert.equal(await getInvQty(a, 'ember-fox'), 1);
    assert.equal(await getInvQty(b, 'moss-wisp'), 1);
  } finally {
    await close();
  }
});

test('trades: rejects bad state, non-participant, insufficient items', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const a = 'tr2-a', b = 'tr2-b', c = 'tr2-c';
    for (const u of [a, b, c]) await seedPlayer(u, 20);
    await seedInv(a, 'ember-fox', 1);
    await seedInv(b, 'moss-wisp', 1);

    // Not yet accepted -> bad_state.
    await seedTrade('trade-offered', {
      offeredBy: a, offeredTo: b,
      offerItemId: 'ember-fox', offerQty: 1,
      wantItemId: 'moss-wisp', wantQty: 1,
      status: 'offered',
    });
    let r = await post(base, '/api/trades/complete', b, { tradeId: 'trade-offered', idempotencyKey: 'k-bs' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'bad_state');

    // Third party -> not_participant.
    await seedTrade('trade-acc', {
      offeredBy: a, offeredTo: b,
      offerItemId: 'ember-fox', offerQty: 1,
      wantItemId: 'moss-wisp', wantQty: 1,
      status: 'accepted',
    });
    r = await post(base, '/api/trades/complete', c, { tradeId: 'trade-acc', idempotencyKey: 'k-np' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'not_participant');

    // Offerer no longer owns enough -> insufficient_items.
    await seedTrade('trade-short', {
      offeredBy: a, offeredTo: b,
      offerItemId: 'ember-fox', offerQty: 5, // a only owns 1
      wantItemId: 'moss-wisp', wantQty: 1,
      status: 'accepted',
    });
    r = await post(base, '/api/trades/complete', b, { tradeId: 'trade-short', idempotencyKey: 'k-ii' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'insufficient_items');

    // Nothing moved.
    assert.equal(await getInvQty(a, 'ember-fox'), 1);
    assert.equal(await getInvQty(b, 'moss-wisp'), 1);
  } finally {
    await close();
  }
});
