'use strict';
/**
 * Leaderboard helpers — rank players by their strongest weapon power.
 *
 * bestWeaponPower is stored on the player doc and mirrored to publicProfiles
 * (readable by all signed-in players). It is refreshed inside the same
 * transaction as every inventory mutation that can change it: hunt drops,
 * upgrades, merges, trades, marketplace buys/sells, and admin grants.
 */
const { db, USE_FAKE } = require('./db');
const contentApi = require('./content');
const { weaponPower } = require('./game');
const { listInventory } = require('./achievementsTx');

/**
 * Recompute uid's best weapon power from their inventory and sync it to
 * the player doc + publicProfiles. Call inside a transaction (tx).
 * Returns the best power.
 */
async function syncBestWeaponPower(tx, uid) {
  const rows = await listInventory(tx, db, uid, USE_FAKE);
  let best = 0;
  for (const r of rows) {
    const item = contentApi.getItem(r.id);
    if (!item || item.type !== 'weapon') continue;
    const p = weaponPower(
      contentApi.content,
      item,
      r.data.upgradeLevel || 0,
      r.data.stars || 0
    );
    if (p > best) best = p;
  }
  const now = Date.now();
  tx.set(
    db.collection('players').doc(uid),
    { bestWeaponPower: best, updatedAt: now },
    { merge: true }
  );
  tx.set(
    db.collection('publicProfiles').doc(uid),
    { bestWeaponPower: best, updatedAt: now },
    { merge: true }
  );
  return best;
}

/**
 * List public profiles for leaderboard queries. Works in real + fake mode.
 * Returns [{ id, data }] sorted by bestWeaponPower desc.
 */
async function listProfilesByPower() {
  if (USE_FAKE) {
    const rows = db
      ._listAll('publicProfiles')
      .map(({ id, data }) => ({ id, data: data() }))
      .filter((r) => (r.data.bestWeaponPower || 0) > 0);
    rows.sort((a, b) => (b.data.bestWeaponPower || 0) - (a.data.bestWeaponPower || 0));
    return rows;
  }
  const snap = await db
    .collection('publicProfiles')
    .orderBy('bestWeaponPower', 'desc')
    .limit(500)
    .get();
  return snap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    .filter((r) => (r.data.bestWeaponPower || 0) > 0);
}

/** Public shape of a leaderboard entry. */
function entryShape(row, rank) {
  return {
    rank,
    uid: row.id,
    displayName: row.data.displayName || 'Traveler',
    level: row.data.level ?? 1,
    bestWeaponPower: row.data.bestWeaponPower || 0,
  };
}

module.exports = {
  syncBestWeaponPower,
  listProfilesByPower,
  entryShape,
};
