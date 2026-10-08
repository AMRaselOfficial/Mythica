'use strict';
/**
 * Tests for the weapon power system, equip/merge, and achievements.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { startServer, post, resetFakeDb, db } = require('./helpers');
const { weaponPower } = require('../lib/game');
const contentApi = require('../lib/content');

test('hunt: new player gets starter weapon equipped + first-hunt achievement', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const uid = 'ach-new';
    const { status, json } = await post(base, '/api/hunt', uid, {});
    assert.equal(status, 200);
    // Starter weapon granted and equipped.
    assert.equal(json.equippedWeaponId, 'worn-blade');
    const inv = await db.collection('inventories').doc(uid).collection('items').doc('worn-blade').get();
    assert.ok(inv.exists);
    assert.equal(inv.data().quantity, 1);
    // First-hunt achievement earned (stub has no xp on it, but doc exists).
    const ach = await db.collection('players').doc(uid).collection('achievements').doc('first-hunt').get();
    assert.ok(ach.exists);
    assert.equal(ach.data().completed, true);
    // Response lists the achievement.
    assert.ok(json.achievements.some((a) => a.id === 'first-hunt'));
    // Weapon power reported.
    assert.ok(json.weaponPower > 0);
    assert.ok(json.maxRarity);
  } finally {
    await close();
  }
});

test('inventory/equip: equips an owned weapon; rejects unknown', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const uid = 'equip-1';
    await post(base, '/api/hunt', uid, {}); // creates player + starter
    // Give the player another weapon (thornblade is a weapon in the stub).
    await db.collection('inventories').doc(uid).collection('items').doc('thornblade').set({
      quantity: 1, upgradeLevel: 0, stars: 0,
    });
    const { status, json } = await post(base, '/api/inventory/equip', uid, { itemId: 'thornblade' });
    assert.equal(status, 200);
    assert.equal(json.equippedWeaponId, 'thornblade');
    const p = await db.collection('players').doc(uid).get();
    assert.equal(p.data().equippedWeaponId, 'thornblade');
    // Unknown item rejected.
    const bad = await post(base, '/api/inventory/equip', uid, { itemId: 'nope' });
    assert.equal(bad.status, 400);
  } finally {
    await close();
  }
});

test('inventory/merge: two copies -> 2 stars; capped at 6', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const uid = 'merge-1';
    await post(base, '/api/hunt', uid, {});
    // worn-blade is a weapon in the full content; in stub it may not exist.
    // Use whatever weapon the stub has, or skip if none.
    const weapons = (contentApi.content.items || []).filter((i) => i.type === 'weapon');
    if (weapons.length === 0) return;
    const wid = weapons[0].id;
    await db.collection('inventories').doc(uid).collection('items').doc(wid).set({
      quantity: 2, upgradeLevel: 0, stars: 0,
    });
    const { status, json } = await post(base, '/api/inventory/merge', uid, { itemId: wid });
    assert.equal(status, 200);
    assert.equal(json.stars, 2);
    assert.equal(json.quantity, 1);
    assert.ok(json.power > 0);
    // Second merge needs another copy.
    const again = await post(base, '/api/inventory/merge', uid, { itemId: wid });
    assert.equal(again.status, 400); // only 1 copy left
    // Max stars rejected.
    await db.collection('inventories').doc(uid).collection('items').doc(wid).update({
      quantity: 2, stars: 6,
    });
    const maxed = await post(base, '/api/inventory/merge', uid, { itemId: wid });
    assert.equal(maxed.status, 400);
  } finally {
    await close();
  }
});

test('achievements: checkAchievements evaluates triggers', async () => {
  const { checkAchievements } = require('../lib/achievements');
  const content = {
    achievements: [
      { id: 'a1', xp: 100, trigger: { type: 'hunts', target: 5 } },
      { id: 'a2', xp: 200, trigger: { type: 'max_power', target: 1000 } },
      { id: 'a3', xp: 300, trigger: { type: 'stars', target: 6 } },
    ],
  };
  const earned = {};
  const stats = { hunts: 5 };
  const weapons = [{ power: 500, stars: 2, maxed: false }];
  const out = checkAchievements({ content, earned, stats, friendCount: 0, weapons });
  assert.deepEqual(out.map((a) => a.id), ['a1']);
  // Already earned are skipped.
  const out2 = checkAchievements({
    content, earned: { a1: true }, stats: { hunts: 10 }, friendCount: 0, weapons,
  });
  assert.deepEqual(out2.map((a) => a.id), []);
});
