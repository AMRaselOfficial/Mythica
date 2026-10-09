'use strict';
/**
 * Leaderboard tests: bestWeaponPower sync on hunt/upgrade/merge, and the
 * GET /api/leaderboard endpoint (global top 20 + your league).
 * Fake modes: USE_FAKE_DB=1 FAKE_AUTH=1 (set in ./helpers).
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
} = require('./helpers');

function auth(uid) {
  return { Authorization: 'Bearer ' + 'test-' + uid };
}

async function seedWeapon(uid, itemId, upgradeLevel = 0, stars = 0, quantity = 1) {
  await db
    .collection('inventories')
    .doc(uid)
    .collection('items')
    .doc(itemId)
    .set({ quantity, upgradeLevel, stars, obtainedAt: Date.now(), favorite: false });
}

async function seedProfile(uid, displayName, bestWeaponPower) {
  await db.collection('publicProfiles').doc(uid).set({
    displayName,
    level: 1,
    bestWeaponPower,
    updatedAt: Date.now(),
  });
}

test('leaderboard: global top 20 ordered by power, your league centered', async () => {
  const { base, close } = await startServer();
  try {
    resetFakeDb();
    // Seed 25 players with increasing power.
    for (let i = 1; i <= 25; i++) {
      const uid = `lb-${i}`;
      await seedPlayer(uid, { displayName: `Player${i}` });
      await seedProfile(uid, `Player${i}`, i * 100);
    }
    // Caller is Player13 (power 1300, rank 13).
    const r = await get(base, '/api/leaderboard', auth('lb-13'));
    assert.equal(r.status, 200);
    assert.ok(r.json.ok);
    assert.equal(r.json.global.length, 20);
    assert.equal(r.json.global[0].displayName, 'Player25');
    assert.equal(r.json.global[0].rank, 1);
    assert.equal(r.json.global[0].bestWeaponPower, 2500);
    assert.equal(r.json.global[19].displayName, 'Player6');
    // Your league: 11 players centered on rank 13 -> ranks 8..18.
    assert.equal(r.json.league.length, 11);
    assert.equal(r.json.league[0].rank, 8);
    assert.equal(r.json.league[10].rank, 18);
    assert.equal(r.json.league[5].uid, 'lb-13');
    assert.equal(r.json.league[5].rank, 13);
    assert.equal(r.json.you.rank, 13);
    assert.equal(r.json.you.bestWeaponPower, 1300);
  } finally {
    await close();
  }
});

test('leaderboard: unranked caller sees bottom of board', async () => {
  const { base, close } = await startServer();
  try {
    resetFakeDb();
    for (let i = 1; i <= 5; i++) {
      const uid = `lb2-${i}`;
      await seedPlayer(uid, { displayName: `P${i}` });
      await seedProfile(uid, `P${i}`, i * 100);
    }
    await seedPlayer('newbie', { displayName: 'Newbie' });
    const r = await get(base, '/api/leaderboard', auth('newbie'));
    assert.equal(r.status, 200);
    assert.equal(r.json.you.rank, null);
    assert.equal(r.json.you.bestWeaponPower, 0);
    // League shows the whole small board.
    assert.equal(r.json.league.length, 5);
  } finally {
    await close();
  }
});

test('leaderboard: hunt syncs bestWeaponPower', async () => {
  const { base, close } = await startServer();
  try {
    resetFakeDb();
    const uid = 'hunter-lb';
    await seedPlayer(uid, { displayName: 'HunterLB' });
    // Give them a weapon directly, then hunt to trigger the sync.
    await seedWeapon(uid, 'worn-blade', 0, 0, 1);
    const r = await post(base, '/api/hunt', uid, {});
    assert.equal(r.status, 200);
    // Wait a beat for the best-effort sync transaction.
    await new Promise((res) => setTimeout(res, 500));
    const psnap = await db.collection('publicProfiles').doc(uid).get();
    assert.ok(psnap.exists);
    assert.ok((psnap.data().bestWeaponPower || 0) >= 200);
  } finally {
    await close();
  }
});

test('leaderboard: admin backfill computes power for all players', async () => {
  const { base, close } = await startServer();
  try {
    resetFakeDb();
    await seedPlayer('bf-1', { displayName: 'BF1' });
    await seedWeapon('bf-1', 'worn-blade', 2, 0, 1); // 200 * (1+1) = 400
    await seedPlayer('bf-2', { displayName: 'BF2' }); // no weapons
    const adminHeaders = {
      Authorization: 'Bearer test-admin-root',
      'Content-Type': 'application/json',
    };
    const rr = await fetch(base + '/api/admin/leaderboard/backfill', {
      method: 'POST',
      headers: adminHeaders,
    });
    const rj = await rr.json();
    assert.equal(rr.status, 200);
    assert.ok(rj.ok);
    assert.equal(rj.synced, 2);
    const p1 = await db.collection('publicProfiles').doc('bf-1').get();
    assert.equal(p1.data().bestWeaponPower, 400);
    const p2 = await db.collection('publicProfiles').doc('bf-2').get();
    assert.equal(p2.data().bestWeaponPower, 0);
  } finally {
    await close();
  }
});
