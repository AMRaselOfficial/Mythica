'use strict';
/**
 * Petal withdrawal tests (player + admin flows).
 * Rate: 1000 Petals = $0.10, minimum $1.00 (10000 Petals).
 * Fake modes: USE_FAKE_DB=1 FAKE_AUTH=1 (set in ./helpers).
 * Admin tokens: `Bearer test-admin-<uid>`; plain users: `Bearer test-admin-<uid>`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

require('./helpers');
const {
  db,
  resetFakeDb,
  startServer,
  post,
  get,
  seedPlayer,
  authHeaders,
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
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function adminGet(base, path, uid) {
  const res = await fetch(base + path, { headers: adminHeaders(uid) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

test('withdraw rates endpoint returns rate info', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('u1', 50000);
    const r = await get(base, '/api/withdraw/rates', authHeaders('u1'));
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.petalsPerUsd, 10000);
    assert.equal(r.json.minPetals, 10000);
    assert.equal(r.json.minUsd, 1);
    assert.equal(r.json.payoutMethod, 'Binance');
  } finally {
    await close();
  }
});

test('withdraw rejects below-minimum amount', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('u1', 50000);
    const r = await post(base, '/api/withdraw', 'u1', { binanceUid: '12345678', petals: 5000 });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'below_minimum');
  } finally {
    await close();
  }
});

test('withdraw rejects bad Binance UID', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('u1', 50000);
    const r = await post(base, '/api/withdraw', 'u1', { binanceUid: 'ab', petals: 10000 });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'bad_binance_uid');
  } finally {
    await close();
  }
});

test('withdraw rejects insufficient petals', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('u1', 5000);
    const r = await post(base, '/api/withdraw', 'u1', { binanceUid: '12345678', petals: 10000 });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'insufficient_petals');
  } finally {
    await close();
  }
});

test('withdraw creates request and deducts petals', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('u1', 50000);
    const r = await post(base, '/api/withdraw', 'u1', { binanceUid: '87654321', petals: 20000 });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.petals, 20000);
    assert.equal(r.json.usd, 2);
    assert.equal(r.json.newBalance, 30000);

    const playerSnap = await db.collection('players').doc('u1').get();
    assert.equal(playerSnap.data().petals, 30000);

    const wdSnap = await db.collection('withdrawals').doc(r.json.withdrawalId).get();
    assert.equal(wdSnap.exists, true);
    assert.equal(wdSnap.data().status, 'pending');
    assert.equal(wdSnap.data().binanceUid, '87654321');
    assert.equal(wdSnap.data().usd, 2);
  } finally {
    await close();
  }
});

test('withdraw blocks second pending request', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('u1', 50000);
    const r1 = await post(base, '/api/withdraw', 'u1', { binanceUid: '11111111', petals: 10000 });
    assert.equal(r1.status, 200);
    const r2 = await post(base, '/api/withdraw', 'u1', { binanceUid: '22222222', petals: 10000 });
    assert.equal(r2.status, 400);
    assert.equal(r2.json.error, 'pending_exists');
  } finally {
    await close();
  }
});

test('withdraw history lists user requests', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('u1', 50000);
    await post(base, '/api/withdraw', 'u1', { binanceUid: '11111111', petals: 10000 });
    const r = await get(base, '/api/withdraw/mine', authHeaders('u1'));
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.withdrawals.length, 1);
    assert.equal(r.json.withdrawals[0].petals, 10000);
    assert.equal(r.json.withdrawals[0].status, 'pending');
  } finally {
    await close();
  }
});

test('admin can list withdrawals', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('u1', 50000);
    await seedPlayer('admin1', 0);
    await post(base, '/api/withdraw', 'u1', { binanceUid: '11111111', petals: 15000 });
    const r = await adminGet(base, '/api/admin/withdrawals?status=pending', 'admin1');
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.withdrawals.length, 1);
    assert.equal(r.json.withdrawals[0].usd, 1.5);
  } finally {
    await close();
  }
});

test('admin approve then complete flow', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('u1', 50000);
    await seedPlayer('admin1', 0);
    const cr = await post(base, '/api/withdraw', 'u1', { binanceUid: '11111111', petals: 10000 });
    const wid = cr.json.withdrawalId;

    const ar = await adminPost(base, `/api/admin/withdrawals/${wid}/approve`, 'admin1', { adminNote: 'verified' });
    assert.equal(ar.status, 200);
    assert.equal(ar.json.ok, true);

    let wdSnap = await db.collection('withdrawals').doc(wid).get();
    assert.equal(wdSnap.data().status, 'approved');

    const cr2 = await adminPost(base, `/api/admin/withdrawals/${wid}/complete`, 'admin1', {});
    assert.equal(cr2.status, 200);

    wdSnap = await db.collection('withdrawals').doc(wid).get();
    assert.equal(wdSnap.data().status, 'completed');

    // Petals stay deducted (no refund on approve/complete)
    const playerSnap = await db.collection('players').doc('u1').get();
    assert.equal(playerSnap.data().petals, 40000);
  } finally {
    await close();
  }
});

test('admin reject refunds petals', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('u1', 50000);
    await seedPlayer('admin1', 0);
    const cr = await post(base, '/api/withdraw', 'u1', { binanceUid: '11111111', petals: 10000 });
    const wid = cr.json.withdrawalId;

    const rr = await adminPost(base, `/api/admin/withdrawals/${wid}/reject`, 'admin1', { adminNote: 'suspicious' });
    assert.equal(rr.status, 200);
    assert.equal(rr.json.ok, true);
    assert.equal(rr.json.refunded, 10000);

    const wdSnap = await db.collection('withdrawals').doc(wid).get();
    assert.equal(wdSnap.data().status, 'rejected');

    const playerSnap = await db.collection('players').doc('u1').get();
    assert.equal(playerSnap.data().petals, 50000);
  } finally {
    await close();
  }
});

test('admin withdrawal detail includes player and earn history', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('u1', 50000);
    await seedPlayer('admin1', 0);
    const cr = await post(base, '/api/withdraw', 'u1', { binanceUid: '99999999', petals: 10000 });
    const wid = cr.json.withdrawalId;

    const r = await adminGet(base, `/api/admin/withdrawals/${wid}`, 'admin1');
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.withdrawal.binanceUid, '99999999');
    assert.ok(r.json.player);
    assert.equal(r.json.player.displayName, 'u1');
    assert.ok(Array.isArray(r.json.earnHistory));
  } finally {
    await close();
  }
});

test('non-admin cannot access admin withdrawal endpoints', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('u1', 50000);
    const r = await get(base, '/api/admin/withdrawals', authHeaders('u1'));
    assert.equal(r.status, 403);
  } finally {
    await close();
  }
});

test('banned player cannot withdraw', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('u1', 50000);
    await db.collection('players').doc('u1').update({ accountStatus: 'banned' });
    const r = await post(base, '/api/withdraw', 'u1', { binanceUid: '12345678', petals: 10000 });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'forbidden');
  } finally {
    await close();
  }
});
