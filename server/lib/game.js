'use strict';
/**
 * Pure game logic — no I/O, no Date.now(), no Math.random inside.
 * rng: a function returning [0, 1). content: the parsed content JSON.
 */

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function weightedPick(rng, pool) {
  const total = pool.reduce((s, i) => s + (i.dropWeight || 0), 0);
  let r = rng() * total;
  for (const item of pool) {
    r -= item.dropWeight || 0;
    if (r < 0) return item;
  }
  return pool[pool.length - 1];
}

/**
 * Roll a hunt: { xpGained, petalsFound, dropItemId|null }.
 * Data-driven: rolls only active items from the content's item list.
 * weaponPower gates non-material drops: an item whose rarity has an unlock
 * threshold above the equipped weapon's power cannot drop (rare finds need
 * stronger weapons). Materials are still gated by playerLevel (minLevel).
 * Defaults to no gating.
 */
function rollHunt(rng, content, weaponPower = Infinity, playerLevel = Infinity) {
  const h = content.hunt;
  const xpGained = randInt(rng, h.xpMin, h.xpMax);
  const petalsFound =
    rng() < h.petalFindChance ? randInt(rng, h.petalFindMin, h.petalFindMax) : 0;
  let dropItemId = null;
  if (rng() < h.dropChance) {
    const unlock = (content.weaponPower && content.weaponPower.rarityUnlock) || {};
    const rarityOrder = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
    const pool = content.items.filter((i) => {
      if (!i.active || (i.dropWeight || 0) <= 0) return false;
      if (i.type === 'material') return (i.minLevel || 1) <= playerLevel;
      const need = unlock[i.rarity] || 0;
      return weaponPower >= need;
    });
    if (pool.length > 0) dropItemId = weightedPick(rng, pool).id;
  }
  return { xpGained, petalsFound, dropItemId };
}

/**
 * Weapon power: base by rarity, boosted by upgrade level and merge stars.
 * power = base * (1 + upgradeBonus * upgradeLevel) * starMultiplier^stars
 * Returns an integer. Unknown items yield 0.
 */
function weaponPower(content, item, upgradeLevel = 0, stars = 0) {
  if (!item || item.type !== 'weapon') return 0;
  const cfg = (content && content.weaponPower) || {};
  const base = (cfg.baseByRarity && cfg.baseByRarity[item.rarity]) || 0;
  const upBonus = cfg.upgradeBonus != null ? cfg.upgradeBonus : 0.5;
  const starMult = cfg.starMultiplier != null ? cfg.starMultiplier : 1.5;
  const upg = Math.max(0, upgradeLevel || 0);
  const st = Math.max(0, stars || 0);
  return Math.round(base * (1 + upBonus * upg) * Math.pow(starMult, st));
}

/**
 * Highest rarity the given weapon power can find. Returns a rarity id.
 */
function maxUnlockedRarity(content, power) {
  const unlock = (content.weaponPower && content.weaponPower.rarityUnlock) || {};
  let best = 'common';
  for (const [rarity, need] of Object.entries(unlock)) {
    if (power >= need) best = rarity;
  }
  // Order check: keep the highest tier in canonical order.
  const order = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
  let idx = 0;
  for (const [rarity, need] of Object.entries(unlock)) {
    if (power >= need) idx = Math.max(idx, order.indexOf(rarity));
  }
  return order[idx];
}

/** Merge validation. Returns an error code or null. */
function validateMerge({ item, inv, maxStars }) {
  if (!item || item.type !== 'weapon') return 'not_a_weapon';
  if (!inv || (inv.quantity || 0) < 2) return 'need_two_copies';
  const stars = inv.stars || 0;
  if (stars >= (maxStars != null ? maxStars : 6)) return 'max_stars';
  return null;
}

/**
 * Apply XP to a player, handling level-ups via the xpCurve.
 * Returns { level, xp, leveledUp }. Never exceeds xpCurve.maxLevel.
 */
function applyXp(player, xpGained, xpCurve) {
  let level = player.level ?? 1;
  let xp = (player.xp ?? 0) + xpGained;
  let leveledUp = false;
  const need = (n) => Math.floor(xpCurve.base * Math.pow(n, xpCurve.growth));
  while (level < xpCurve.maxLevel && xp >= need(level)) {
    xp -= need(level);
    level += 1;
    leveledUp = true;
  }
  return { level, xp, leveledUp };
}

/** Market listing validation. Returns an error code or null. */
function validateList({ item, quantity, price, ownedQty }) {
  if (!item || !item.sellable) return 'not_sellable';
  if (!Number.isInteger(quantity) || quantity < 1 || (ownedQty ?? 0) < quantity)
    return 'insufficient_quantity';
  if (!Number.isInteger(price) || price < 1) return 'bad_price';
  return null;
}

/** Market purchase validation. Returns an error code or null. */
function validatePurchase({ listing, buyerUid, buyerPetals }) {
  if (!listing || listing.status !== 'active') return 'listing_unavailable';
  if (listing.sellerUid === buyerUid) return 'own_listing';
  if ((buyerPetals ?? 0) < listing.price) return 'insufficient_petals';
  return null;
}

/** Upgrade validation. Returns an error code or null.
 * materials: { materialId: ownedQty } for the materials required at this level.
 */
function validateUpgrade({ item, inv, petals, materials }) {
  if (!item || !item.upgradeable) return 'not_upgradeable';
  if (!inv || (inv.quantity || 0) < 1) return 'not_owned';
  const lvl = inv.upgradeLevel || 0;
  const cost = (item.upgradeCosts || [])[lvl];
  if (lvl >= item.maxLevel || cost === undefined) return 'max_level';
  if ((petals ?? 0) < cost) return 'insufficient_petals';
  const need = (item.upgradeMaterials || [])[lvl] || [];
  for (const m of need) {
    if ((materials?.[m.id] ?? 0) < (m.qty || 0)) return 'insufficient_materials';
  }
  return null;
}

/** Trade completion validation. Returns an error code or null. */
function validateTradeComplete({ trade, uid, offerQtyOwned, wantQtyOwned }) {
  if (!trade || trade.status !== 'accepted') return 'bad_state';
  if (trade.offeredBy !== uid && trade.offeredTo !== uid) return 'not_participant';
  if ((offerQtyOwned ?? 0) < trade.offerQty || (wantQtyOwned ?? 0) < trade.wantQty)
    return 'insufficient_items';
  return null;
}

module.exports = {
  rollHunt,
  applyXp,
  validateList,
  validatePurchase,
  validateUpgrade,
  validateTradeComplete,
  weaponPower,
  maxUnlockedRarity,
  validateMerge,
};
