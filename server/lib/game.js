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
 */
function rollHunt(rng, content) {
  const h = content.hunt;
  const xpGained = randInt(rng, h.xpMin, h.xpMax);
  const petalsFound =
    rng() < h.petalFindChance ? randInt(rng, h.petalFindMin, h.petalFindMax) : 0;
  let dropItemId = null;
  if (rng() < h.dropChance) {
    const pool = content.items.filter((i) => i.active && (i.dropWeight || 0) > 0);
    if (pool.length > 0) dropItemId = weightedPick(rng, pool).id;
  }
  return { xpGained, petalsFound, dropItemId };
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

/** Upgrade validation. Returns an error code or null. */
function validateUpgrade({ item, inv, petals }) {
  if (!item || !item.upgradeable) return 'not_upgradeable';
  if (!inv || (inv.quantity || 0) < 1) return 'not_owned';
  const lvl = inv.upgradeLevel || 0;
  const cost = (item.upgradeCosts || [])[lvl];
  if (lvl >= item.maxLevel || cost === undefined) return 'max_level';
  if ((petals ?? 0) < cost) return 'insufficient_petals';
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
};
