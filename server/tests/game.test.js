'use strict';
/**
 * Pure-logic tests for lib/game.js and lib/content.js — no server, no DB.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.USE_FAKE_DB = '1';
process.env.FAKE_AUTH = '1';

const contentApi = require('../lib/content');
const {
  rollHunt,
  applyXp,
  validateList,
  validatePurchase,
  validateUpgrade,
  validateTradeComplete,
  weaponPower,
  maxUnlockedRarity,
  validateMerge,
} = require('../lib/game');

const content = contentApi.content;
const H = content.hunt;

/** Deterministic rng from a scripted sequence of [0,1) values. */
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test('content: xpForLevel follows floor(base * n^growth)', () => {
  assert.equal(contentApi.xpForLevel(1), 100);
  assert.equal(contentApi.xpForLevel(1), Math.floor(100 * Math.pow(1, 1.45)));
  assert.equal(contentApi.xpForLevel(2), Math.floor(100 * Math.pow(2, 1.45)));
  assert.equal(contentApi.xpForLevel(10), Math.floor(100 * Math.pow(10, 1.45)));
  assert.equal(contentApi.cooldownMs(), H.cooldownSec * 1000);
});

test('content: lookups are data-driven from the JSON', () => {
  const fox = contentApi.getItem('ember-fox');
  assert.ok(fox && fox.name === 'Ember Fox');
  assert.equal(contentApi.getItem('does-not-exist'), null);
  const pool = contentApi.activeDropPool();
  assert.ok(pool.length > 0);
  assert.ok(pool.every((i) => i.active && i.dropWeight > 0));
  assert.ok(pool.some((i) => i.id === 'moss-wisp'));
});

test('rollHunt: ranges and scripted outcomes', () => {
  // xp roll 0.0 -> xpMin; petal chance 0.1 < 0.25 -> found, amount 0.5 -> mid; drop 0.9 -> none
  let r = rollHunt(seqRng([0.0, 0.1, 0.5, 0.9]), content);
  assert.equal(r.xpGained, H.xpMin);
  assert.equal(r.petalsFound, Math.floor(0.5 * (H.petalFindMax - H.petalFindMin + 1)) + H.petalFindMin);
  assert.equal(r.dropItemId, null);

  // no petals (0.9 >= 0.25), drop (0.1 < 0.65), pick r=0 -> first weighted item
  r = rollHunt(seqRng([0.999, 0.9, 0.1, 0.0]), content);
  assert.equal(r.xpGained, H.xpMax);
  assert.equal(r.petalsFound, 0);
  const pool = contentApi.activeDropPool();
  assert.equal(r.dropItemId, pool[0].id);
  assert.ok(pool.some((i) => i.id === r.dropItemId));

  // fuzz: 500 rolls stay within contract ranges and only yield active items
  const ids = new Set(pool.map((i) => i.id));
  for (let i = 0; i < 500; i++) {
    const roll = rollHunt(Math.random, content);
    assert.ok(roll.xpGained >= H.xpMin && roll.xpGained <= H.xpMax);
    assert.ok(roll.petalsFound === 0 || (roll.petalsFound >= H.petalFindMin && roll.petalsFound <= H.petalFindMax));
    assert.ok(roll.dropItemId === null || ids.has(roll.dropItemId));
  }
});

test('rollHunt: weapon power gates non-material drops; level gates materials', () => {
  // New signature: rollHunt(rng, content, weaponPower, playerLevel).
  // With 0 power, no rarity unlocks: only common (unlock 0) non-materials drop.
  // Materials still respect minLevel.
  const lowPower = [];
  for (let i = 0; i < 200; i++) {
    const roll = rollHunt(Math.random, content, 0, 1);
    if (roll.dropItemId) lowPower.push(roll.dropItemId);
  }
  // Stub content has no weaponPower config -> unlock map empty -> all rarities
  // have threshold 0, so everything is unlocked. This test uses a synthetic
  // config instead.
  const cfg = {
    ...content,
    weaponPower: { rarityUnlock: { uncommon: 2000, rare: 20000 } },
    items: content.items.map((x) =>
      x.type === 'material' ? x : { ...x, rarity: x.id === 'ember-fox' ? 'rare' : 'common' }
    ),
  };
  for (let i = 0; i < 200; i++) {
    const roll = rollHunt(Math.random, cfg, 0, 99);
    assert.ok(roll.dropItemId !== 'ember-fox', 'power 0 must not drop rare ember-fox');
  }
  let sawFox = false;
  for (let i = 0; i < 500; i++) {
    const roll = rollHunt(Math.random, cfg, 25000, 99);
    if (roll.dropItemId === 'ember-fox') {
      sawFox = true;
      break;
    }
  }
  assert.ok(sawFox, 'power 25000 should eventually drop rare ember-fox');
  // Omitted args default to no gating (backwards compatible).
  const r = rollHunt(seqRng([0.999, 0.9, 0.1, 0.0]), content);
  assert.ok(r.dropItemId !== null);
});

test('weaponPower: base * upgrade bonus * star multiplier', () => {
  const cfg = {
    weaponPower: {
      baseByRarity: { common: 200, rare: 12000 },
      upgradeBonus: 0.5,
      starMultiplier: 1.5,
    },
  };
  // base 200, no upgrades/stars
  assert.equal(weaponPower(cfg, { type: 'weapon', rarity: 'common' }, 0, 0), 200);
  // 2 upgrades: 200 * (1 + 0.5*2) = 400
  assert.equal(weaponPower(cfg, { type: 'weapon', rarity: 'common' }, 2, 0), 400);
  // 2 upgrades + 2 stars: 400 * 1.5^2 = 900
  assert.equal(weaponPower(cfg, { type: 'weapon', rarity: 'common' }, 2, 2), 900);
  // non-weapon yields 0
  assert.equal(weaponPower(cfg, { type: 'sprite', rarity: 'common' }, 0, 0), 0);
});

test('validateMerge: needs two copies, not a weapon, max stars', () => {
  assert.equal(validateMerge({ item: null, inv: { quantity: 2 }, maxStars: 6 }), 'not_a_weapon');
  assert.equal(
    validateMerge({ item: { type: 'sprite' }, inv: { quantity: 2 }, maxStars: 6 }),
    'not_a_weapon'
  );
  assert.equal(
    validateMerge({ item: { type: 'weapon' }, inv: { quantity: 1 }, maxStars: 6 }),
    'need_two_copies'
  );
  assert.equal(
    validateMerge({ item: { type: 'weapon' }, inv: { quantity: 2, stars: 6 }, maxStars: 6 }),
    'max_stars'
  );
  assert.equal(
    validateMerge({ item: { type: 'weapon' }, inv: { quantity: 2, stars: 0 }, maxStars: 6 }),
    null
  );
});

test('applyXp: no level, single level, multi level, max-level cap', () => {
  const curve = content.xpCurve;

  let a = applyXp({ level: 1, xp: 0 }, 10, curve);
  assert.deepEqual(a, { level: 1, xp: 10, leveledUp: false });

  // exact boundary: 100 xp needed for 1 -> 2
  a = applyXp({ level: 1, xp: 0 }, 100, curve);
  assert.deepEqual(a, { level: 2, xp: 0, leveledUp: true });

  // multi-level: walk the expected ladder with the same formula
  let level = 1, xp = 0;
  const gain = 1000;
  xp += gain;
  const need = (n) => Math.floor(curve.base * Math.pow(n, curve.growth));
  while (level < curve.maxLevel && xp >= need(level)) { xp -= need(level); level++; }
  a = applyXp({ level: 1, xp: 0 }, gain, curve);
  assert.deepEqual(a, { level, xp, leveledUp: true });

  // capped at maxLevel: no overflow, no level-up flag churn
  a = applyXp({ level: curve.maxLevel, xp: 0 }, 100000, curve);
  assert.equal(a.level, curve.maxLevel);
  assert.equal(a.leveledUp, false);
  assert.equal(a.xp, 100000);

  // missing fields default safely
  a = applyXp({}, 5, curve);
  assert.deepEqual(a, { level: 1, xp: 5, leveledUp: false });
});

test('validateList', () => {
  const item = contentApi.getItem('moss-wisp');
  assert.equal(validateList({ item, quantity: 1, price: 10, ownedQty: 3 }), null);
  assert.equal(validateList({ item: null, quantity: 1, price: 10, ownedQty: 3 }), 'not_sellable');
  assert.equal(validateList({ item: { ...item, sellable: false }, quantity: 1, price: 10, ownedQty: 3 }), 'not_sellable');
  assert.equal(validateList({ item, quantity: 4, price: 10, ownedQty: 3 }), 'insufficient_quantity');
  assert.equal(validateList({ item, quantity: 0, price: 10, ownedQty: 3 }), 'insufficient_quantity');
  assert.equal(validateList({ item, quantity: 1.5, price: 10, ownedQty: 3 }), 'insufficient_quantity');
  assert.equal(validateList({ item, quantity: 1, price: 0, ownedQty: 3 }), 'bad_price');
  assert.equal(validateList({ item, quantity: 1, price: -5, ownedQty: 3 }), 'bad_price');
});

test('validatePurchase', () => {
  const listing = { sellerUid: 's', itemId: 'moss-wisp', quantity: 1, price: 50, status: 'active' };
  assert.equal(validatePurchase({ listing, buyerUid: 'b', buyerPetals: 60 }), null);
  assert.equal(validatePurchase({ listing: null, buyerUid: 'b', buyerPetals: 60 }), 'listing_unavailable');
  assert.equal(validatePurchase({ listing: { ...listing, status: 'sold' }, buyerUid: 'b', buyerPetals: 60 }), 'listing_unavailable');
  assert.equal(validatePurchase({ listing, buyerUid: 's', buyerPetals: 60 }), 'own_listing');
  assert.equal(validatePurchase({ listing, buyerUid: 'b', buyerPetals: 49 }), 'insufficient_petals');
});

test('validateUpgrade', () => {
  const blade = contentApi.getItem('thornblade'); // upgradeable, maxLevel 3, costs [40,120], needs test-shard
  const fox = contentApi.getItem('ember-fox'); // not upgradeable
  const mats = { 'test-shard': 10 };
  assert.equal(validateUpgrade({ item: blade, inv: { quantity: 1, upgradeLevel: 0 }, petals: 40, materials: mats }), null);
  assert.equal(validateUpgrade({ item: null, inv: { quantity: 1 }, petals: 99 }), 'not_upgradeable');
  assert.equal(validateUpgrade({ item: fox, inv: { quantity: 1, upgradeLevel: 0 }, petals: 99 }), 'not_upgradeable');
  assert.equal(validateUpgrade({ item: blade, inv: null, petals: 99 }), 'not_owned');
  assert.equal(validateUpgrade({ item: blade, inv: { quantity: 0, upgradeLevel: 0 }, petals: 99 }), 'not_owned');
  assert.equal(validateUpgrade({ item: blade, inv: { quantity: 1, upgradeLevel: 2 }, petals: 9999, materials: mats }), 'max_level');
  assert.equal(validateUpgrade({ item: blade, inv: { quantity: 1, upgradeLevel: 0 }, petals: 39, materials: mats }), 'insufficient_petals');
  assert.equal(validateUpgrade({ item: blade, inv: { quantity: 1, upgradeLevel: 0 }, petals: 40, materials: { 'test-shard': 1 } }), 'insufficient_materials');
  assert.equal(validateUpgrade({ item: blade, inv: { quantity: 1, upgradeLevel: 0 }, petals: 40, materials: {} }), 'insufficient_materials');
  assert.equal(validateUpgrade({ item: blade, inv: { quantity: 1, upgradeLevel: 0 }, petals: 40 }), 'insufficient_materials');
});

test('validateTradeComplete', () => {
  const trade = {
    offeredBy: 'a', offeredTo: 'b',
    offerItemId: 'ember-fox', offerQty: 1,
    wantItemId: 'moss-wisp', wantQty: 2,
    status: 'accepted',
  };
  const good = { trade, uid: 'b', offerQtyOwned: 1, wantQtyOwned: 2 };
  assert.equal(validateTradeComplete(good), null);
  assert.equal(validateTradeComplete({ ...good, uid: 'a' }), null); // either participant
  assert.equal(validateTradeComplete({ ...good, trade: null }), 'bad_state');
  assert.equal(validateTradeComplete({ ...good, trade: { ...trade, status: 'offered' } }), 'bad_state');
  assert.equal(validateTradeComplete({ ...good, uid: 'c' }), 'not_participant');
  assert.equal(validateTradeComplete({ ...good, offerQtyOwned: 0 }), 'insufficient_items');
  assert.equal(validateTradeComplete({ ...good, wantQtyOwned: 1 }), 'insufficient_items');
});
