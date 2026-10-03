'use strict';
/**
 * Shared reward granting used by redeem codes and event claims.
 *
 * Firestore transactions require ALL reads before ALL writes, so this is
 * split in two phases:
 *   1. prepareItemGrants(db, tx, uid, items) — reads inventory docs. Must run
 *      before any tx write.
 *   2. applyRewardWrites(db, tx, opts) — petals/XP/item writes + public
 *      profile sync. Call only after every tx read is done.
 */
const { applyXp } = require('./game');
const contentApi = require('./content');

async function prepareItemGrants(db, tx, uid, items) {
  const invReads = [];
  for (const it of items || []) {
    const itemId = String((it && it.itemId) || '');
    const qty = Math.floor(Number((it && it.quantity) || 0));
    const item = contentApi.getItem(itemId);
    if (!item || qty <= 0) continue;
    const invRef = db
      .collection('inventories')
      .doc(uid)
      .collection('items')
      .doc(itemId);
    const invSnap = await tx.get(invRef);
    invReads.push({ item, itemId, qty, invRef, invSnap });
  }
  return invReads;
}

function applyRewardWrites(db, tx, { uid, player, petals, xp, invReads, now, setPlayer }) {
  const petalsGain = Math.max(0, Math.floor(petals || 0));
  const xpGain = Math.max(0, Math.floor(xp || 0));
  const applied = applyXp(player, xpGain, contentApi.content.xpCurve);
  const newPetals = (player.petals || 0) + petalsGain;

  const playerUpdate = {
    petals: newPetals,
    level: applied.level,
    xp: applied.xp,
    updatedAt: now,
  };
  const playerRef = db.collection('players').doc(uid);
  if (setPlayer) tx.set(playerRef, { ...player, ...playerUpdate });
  else tx.update(playerRef, playerUpdate);

  const grantedItems = [];
  for (const { item, itemId, qty, invRef, invSnap } of invReads) {
    if (invSnap.exists) {
      tx.update(invRef, {
        quantity: (invSnap.data().quantity || 0) + qty,
        updatedAt: now,
      });
    } else {
      tx.set(invRef, { quantity: qty, upgradeLevel: 0, obtainedAt: now, favorite: false });
    }
    grantedItems.push({ itemId, name: item.name, quantity: qty });
  }

  // Public profile rides along (level may have changed).
  tx.set(
    db.collection('publicProfiles').doc(uid),
    {
      displayName: player.displayName || 'Traveler',
      level: applied.level,
      playerCode: player.playerCode || null,
      updatedAt: now,
    },
    { merge: true }
  );

  return {
    petals: petalsGain,
    xp: xpGain,
    level: applied.level,
    leveledUp: applied.leveledUp,
    items: grantedItems,
  };
}

module.exports = { prepareItemGrants, applyRewardWrites };
