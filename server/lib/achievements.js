'use strict';
/**
 * Achievement evaluation — pure logic, no I/O.
 *
 * checkAchievements({ content, earned, stats, friendCount, weapons })
 *   earned: Set/object of already-earned achievement ids
 *   stats: { hunts, trades, upgrades, legendaryLoot, mythicLoot,
 *            huntsToday, nightHunts, comebacks }
 *   friendCount: number of accepted friendships
 *   weapons: [{ power, stars, maxed }] for owned weapons
 * Returns: array of achievement defs newly earned.
 *
 * Trigger types: hunts, trades, friends, upgrades, legendary_loot,
 * mythic_loot, night_hunt, hunts_today, comeback, maxed_weapon, stars,
 * max_power.
 */

function triggerValue(type, { stats, friendCount, weapons }) {
  const s = stats || {};
  switch (type) {
    case 'hunts':
      return s.hunts || 0;
    case 'trades':
      return s.trades || 0;
    case 'friends':
      return friendCount || 0;
    case 'upgrades':
      return s.upgrades || 0;
    case 'legendary_loot':
      return s.legendaryLoot || 0;
    case 'mythic_loot':
      return s.mythicLoot || 0;
    case 'night_hunt':
      return s.nightHunts || 0;
    case 'hunts_today':
      return s.huntsToday || 0;
    case 'comeback':
      return s.comebacks || 0;
    case 'maxed_weapon':
      return (weapons || []).some((w) => w.maxed) ? 1 : 0;
    case 'stars':
      return Math.max(0, ...(weapons || []).map((w) => w.stars || 0));
    case 'max_power':
      return Math.max(0, ...(weapons || []).map((w) => w.power || 0));
    default:
      return 0;
  }
}

function checkAchievements({ content, earned, stats, friendCount, weapons }) {
  const defs = (content && content.achievements) || [];
  const out = [];
  for (const a of defs) {
    if (earned && earned[a.id]) continue;
    const t = a.trigger || {};
    const value = triggerValue(t.type, { stats, friendCount, weapons });
    if (value >= (t.target || 1)) out.push(a);
  }
  return out;
}

/** Progress toward each unearned, non-hidden achievement (for profile UI). */
function achievementProgress({ content, earned, stats, friendCount, weapons }) {
  const defs = (content && content.achievements) || [];
  return defs.map((a) => {
    const t = a.trigger || {};
    const value = triggerValue(t.type, { stats, friendCount, weapons });
    return { id: a.id, value, target: t.target || 1, completed: !!(earned && earned[a.id]) };
  });
}

module.exports = { checkAchievements, achievementProgress, triggerValue };
