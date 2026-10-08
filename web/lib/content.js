import content from '../../content/mythica-content.json';

// Single data-driven content source: the full game content.
// (content/STUB-content.json remains as a minimal schema example for dev.)
export default content;

export function rarityColor(rarityId) {
  const r = content.rarities.find((x) => x.id === rarityId);
  return r ? r.color : '#9aa3b2';
}

export function itemById(itemId) {
  return content.items.find((x) => x.id === itemId);
}

export function activeItems() {
  return content.items.filter((x) => x.active !== false);
}

/** Weapon power: mirrors server/lib/game.js weaponPower. */
export function weaponPower(item, upgradeLevel = 0, stars = 0) {
  if (!item || item.type !== 'weapon') return 0;
  const cfg = content.weaponPower || {};
  const base = (cfg.baseByRarity && cfg.baseByRarity[item.rarity]) || 0;
  const upBonus = cfg.upgradeBonus != null ? cfg.upgradeBonus : 0.5;
  const starMult = cfg.starMultiplier != null ? cfg.starMultiplier : 1.5;
  const upg = Math.max(0, upgradeLevel || 0);
  const st = Math.max(0, stars || 0);
  return Math.round(base * (1 + upBonus * upg) * Math.pow(starMult, st));
}

/** Highest rarity a weapon power can find. */
export function maxUnlockedRarity(power) {
  const unlock = (content.weaponPower && content.weaponPower.rarityUnlock) || {};
  const order = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
  let idx = 0;
  for (const [rarity, need] of Object.entries(unlock)) {
    if (power >= need) idx = Math.max(idx, order.indexOf(rarity));
  }
  return order[idx];
}

/** Pretty power number with commas. */
export function formatPower(n) {
  return (n || 0).toLocaleString('en-US');
}

/** Star display: '☆☆☆' for 3 stars, '' for 0. */
export function starDisplay(stars) {
  return '☆'.repeat(Math.max(0, stars || 0));
}
