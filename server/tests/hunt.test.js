'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

require('./helpers');
const { db, resetFakeDb, contentApi, startServer, post, get } = require('./helpers');

const H = contentApi.content.hunt;

test('health returns ok payload', async () => {
  const { base, close } = await startServer();
  try {
    const { status, json } = await get(base, '/health');
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.service, 'mythica-server');
    assert.ok(typeof json.time === 'number');
  } finally {
    await close();
  }
});

test('hunt: 401 without a token, 401 with a bad token', async () => {
  const { base, close } = await startServer();
  try {
    let r = await get(base, '/api/hunt', {});
    // GET on a POST-only route: auth runs first -> 401
    assert.equal(r.status, 401);
    assert.deepEqual(r.json, { ok: false, error: 'unauthorized' });

    const bad = await fetch(base + '/api/hunt', {
      method: 'POST',
      headers: { Authorization: 'Bearer junk', 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(bad.status, 401);
    assert.deepEqual(await bad.json(), { ok: false, error: 'unauthorized' });
  } finally {
    await close();
  }
});

test('hunt: first hunt succeeds with contract-shaped response', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const before = Date.now();
    const { status, json } = await post(base, '/api/hunt', 'hunt-ok', {});
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.ok(json.xpGained >= H.xpMin && json.xpGained <= H.xpMax, 'xp in range');
    assert.ok(json.petalsFound >= 0 && json.petalsFound <= H.petalFindMax, 'petals in range');
    // First hunt also grants the first-hunt achievement (+100 XP in stub) -> level 2.
    assert.equal(json.leveledUp, true);
    assert.equal(json.level, 2);
    assert.ok(json.xp >= 0);
    assert.equal(json.petals, 20 + json.petalsFound);
    assert.ok(json.nextHuntAt >= before + H.cooldownSec * 1000);
    if (json.drop) {
      assert.ok(typeof json.drop.itemId === 'string');
      assert.ok(typeof json.drop.name === 'string');
      assert.ok(typeof json.drop.rarity === 'string');
      assert.ok(typeof json.drop.image === 'string');
      assert.equal(json.drop.quantity, 1);
    }
  } finally {
    await close();
  }
});

test('hunt: immediate second hunt -> 429 cooldown with retryAfterMs', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const uid = 'hunt-cd';
    const first = await post(base, '/api/hunt', uid, {});
    assert.equal(first.status, 200);
    const second = await post(base, '/api/hunt', uid, {});
    assert.equal(second.status, 429);
    assert.deepEqual(
      { ok: second.json.ok, error: second.json.error },
      { ok: false, error: 'cooldown' }
    );
    assert.ok(second.json.retryAfterMs > 0 && second.json.retryAfterMs <= H.cooldownSec * 1000);
  } finally {
    await close();
  }
});

test('hunt: succeeds again after time travel past the cooldown', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const uid = 'hunt-tt';
    const first = await post(base, '/api/hunt', uid, {});
    assert.equal(first.status, 200);
    // Time travel: pretend the last hunt was long ago.
    await db.collection('players').doc(uid).update({ lastHuntAt: Date.now() - H.cooldownSec * 1000 - 5000 });
    const second = await post(base, '/api/hunt', uid, {});
    assert.equal(second.status, 200);
    assert.equal(second.json.ok, true);
  } finally {
    await close();
  }
});

test('hunt: every drop references a real, active content item', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const uid = 'hunt-drops';
    const poolIds = new Set(contentApi.activeDropPool().map((i) => i.id));
    let dropsSeen = 0;
    for (let i = 0; i < 40; i++) {
      // Time travel: reset the cooldown before every hunt.
      const p = await db.collection('players').doc(uid).get();
      if (!p.exists) {
        await db.collection('players').doc(uid).set({ lastHuntAt: 0 });
      } else {
        await db.collection('players').doc(uid).update({ lastHuntAt: 0 });
      }
      const { status, json } = await post(base, '/api/hunt', uid, {});
      assert.equal(status, 200);
      if (json.drop) {
        dropsSeen++;
        assert.ok(poolIds.has(json.drop.itemId), `drop ${json.drop.itemId} must be an active item`);
        const item = contentApi.getItem(json.drop.itemId);
        assert.equal(json.drop.name, item.name);
        assert.equal(json.drop.rarity, item.rarity);
        assert.equal(json.drop.image, item.image);
      }
    }
    assert.ok(dropsSeen > 0, `expected at least one drop in 40 hunts (dropChance=${H.dropChance})`);
  } finally {
    await close();
  }
});

test('hunt: XP level-up math (99 xp + hunt xp crosses level 1 -> 2)', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const uid = 'hunt-lvl';
    const first = await post(base, '/api/hunt', uid, {});
    assert.equal(first.status, 200);
    // The first hunt also grants the first-hunt achievement (+100 XP), so the
    // player may already be level 2+. Reset to a known state: level 1, 99 xp,
    // and mark first-hunt as earned so it doesn't fire again.
    await db.collection('players').doc(uid).update({ level: 1, xp: 99, lastHuntAt: 0 });
    await db.collection('players').doc(uid).collection('achievements').doc('first-hunt').set({
      completed: true,
      earnedAt: Date.now(),
      xp: 100,
    });
    const before = await db.collection('players').doc(uid).get();
    const beforeLevel = before.data().level;
    const { status, json } = await post(base, '/api/hunt', uid, {});
    assert.equal(status, 200);
    // xpForLevel(1) = floor(100 * 1^1.45) = 100. 99 + hunt xp >= 100 -> level up.
    assert.equal(json.leveledUp, true);
    assert.equal(json.level, beforeLevel + 1);
  } finally {
    await close();
  }
});

test('hunt: player doc gets new-player defaults on first hunt', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const uid = 'hunt-new';
    const { status } = await post(base, '/api/hunt', uid, {});
    assert.equal(status, 200);
    const p = await db.collection('players').doc(uid).get();
    assert.ok(p.exists);
    const d = p.data();
    // First hunt grants first-hunt (+100 XP in stub) -> level 2.
    assert.equal(d.level, 2);
    assert.equal(d.accountStatus, 'active');
    assert.equal(d.musicEnabled, true);
    assert.equal(d.sfxEnabled, true);
    assert.ok(d.lastHuntAt > 0);
    assert.equal(d.equippedWeaponId, 'worn-blade');
    assert.ok(d.stats && d.stats.hunts === 1);
  } finally {
    await close();
  }
});
