'use strict';
/**
 * Transaction helpers for the achievement system.
 * Works with real Firestore and the fake test DB.
 */
const { checkAchievements } = require('./achievements');
const { weaponPower } = require('./game');

/** Read earned achievement ids for a player (hoist before writes). */
async function readEarned(tx, db, uid, useFake) {
  if (useFake) {
    const earned = {};
    for (const { id } of db._listAll(`players/${uid}/achievements`)) earned[id] = true;
    return earned;
  }
  const snap = await tx.get(db.collection('players').doc(uid).collection('achievements'));
  const earned = {};
  snap.forEach((d) => {
    earned[d.id] = true;
  });
  return earned;
}

/**
 * Evaluate and grant newly-earned achievements inside a transaction.
 * Returns { newly: [defs], xp: totalXp }. Writes the achievement docs.
 * Caller is responsible for applying the XP to the player (via applyXp).
 */
function grantNewlyEarned(tx, db, { uid, content, earned, stats, friendCount, weapons, now }) {
  const newly = checkAchievements({ content, earned, stats, friendCount, weapons });
  let xp = 0;
  for (const a of newly) {
    xp += a.xp || 0;
    tx.set(db.collection('players').doc(uid).collection('achievements').doc(a.id), {
      completed: true,
      earnedAt: now,
      xp: a.xp || 0,
      hidden: !!a.hidden,
    });
  }
  return { newly, xp };
}

/**
 * Count accepted friendships for a uid (either side).
 * Uses single-field queries + in-code filter to avoid composite indexes.
 */
async function countFriends(tx, db, useFake, uid) {
  const asRequester = await txWhereEquals(db, tx, useFake, 'friendships', 'requesterUid', uid);
  const asAddressee = await txWhereEquals(db, tx, useFake, 'friendships', 'addresseeUid', uid);
  const seen = new Set();
  let n = 0;
  for (const r of [...asRequester, ...asAddressee]) {
    if (r.data.status === 'accepted' && !seen.has(r.id)) {
      seen.add(r.id);
      n += 1;
    }
  }
  return n;
}

async function txWhereEquals(db, tx, useFake, collPath, field, value) {
  if (useFake) {
    return db
      ._listAll(collPath)
      .filter(({ data }) => data()[field] === value)
      .map(({ id, data }) => ({ id, data: data() }));
  }
  const snap = await tx.get(db.collection(collPath).where(field, '==', value));
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

/**
 * Build the weapons summary for achievement checks from inventory rows.
 * rows: [{id, data}] of inventory items. Returns [{power, stars, maxed}].
 */
function weaponSummary(content, rows, getItem) {
  const out = [];
  for (const { id, data } of rows) {
    const item = getItem(id);
    if (!item || item.type !== 'weapon') continue;
    const upg = data.upgradeLevel || 0;
    const stars = data.stars || 0;
    const power = weaponPower(content, item, upg, stars);
    const maxUpg = (item.upgradeCosts || []).length;
    out.push({ power, stars, maxed: upg >= maxUpg && maxUpg > 0 });
  }
  return out;
}

/** List all inventory rows for a player (hoist before writes). */
async function listInventory(tx, db, uid, useFake) {
  if (useFake) {
    return db._listAll(`inventories/${uid}/items`).map(({ id, data }) => ({ id, data: data() }));
  }
  const snap = await tx.get(db.collection('inventories').doc(uid).collection('items'));
  const rows = [];
  snap.forEach((d) => rows.push({ id: d.id, data: d.data() }));
  return rows;
}

/**
 * Standalone achievement check in its own transaction. Applies statUpdates
 * to player.stats, evaluates triggers, grants achievements + XP.
 * Best-effort: safe to call after trades/upgrades. Returns newly earned.
 */
async function checkAndGrant(db, useFake, content, getItem, applyXpFn, uid, statUpdates) {
  return db.runTransaction(async (tx) => {
    const now = Date.now();
    const playerRef = db.collection('players').doc(uid);
    const pSnap = await tx.get(playerRef);
    if (!pSnap.exists) return { newly: [] };
    const player = pSnap.data();

    const stats = { ...(player.stats || {}) };
    for (const [k, v] of Object.entries(statUpdates || {})) {
      stats[k] = (stats[k] || 0) + v;
    }

    const earned = await readEarned(tx, db, uid, useFake);
    const invRows = await listInventory(tx, db, uid, useFake);
    const needsFriends = (content.achievements || []).some(
      (a) => a.trigger && a.trigger.type === 'friends' && !earned[a.id]
    );
    const friendCount = needsFriends ? await countFriends(tx, db, useFake, uid) : 0;
    const weapons = weaponSummary(content, invRows, getItem);

    const { newly, xp } = grantNewlyEarned(tx, db, {
      uid,
      content,
      earned,
      stats,
      friendCount,
      weapons,
      now,
    });

    const update = { stats, updatedAt: now };
    if (xp > 0) {
      const applied = applyXpFn(
        { level: player.level || 1, xp: player.xp || 0 },
        xp,
        content.xpCurve
      );
      update.xp = applied.xp;
      update.level = applied.level;
    }
    tx.update(playerRef, update);
    return { newly: newly.map((a) => ({ id: a.id, name: a.name, xp: a.xp })) };
  });
}

module.exports = {
  readEarned,
  grantNewlyEarned,
  countFriends,
  weaponSummary,
  listInventory,
  checkAndGrant,
};
