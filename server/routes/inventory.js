'use strict';
/**
 * POST /api/inventory/equip { itemId } — equip a weapon for hunts.
 * POST /api/inventory/merge { itemId } — merge a duplicate weapon into stars.
 *
 * Merge: requires 2+ copies. Consumes one copy, adds a star (first merge of
 * two fresh copies yields 2 stars). Max 6 stars. Keeps the highest
 * upgrade level. Achievements are evaluated after merging.
 */
const express = require('express');
const { db, USE_FAKE } = require('../lib/db');
const contentApi = require('../lib/content');
const { applyXp, weaponPower, validateMerge } = require('../lib/game');
const {
  readEarned,
  grantNewlyEarned,
  countFriends,
  weaponSummary,
  listInventory,
} = require('../lib/achievementsTx');

const router = express.Router();

router.post('/inventory/equip', async (req, res) => {
  const uid = req.uid;
  const { itemId } = req.body || {};
  if (!itemId) return res.status(400).json({ ok: false, error: 'bad_request' });
  try {
    const item = contentApi.getItem(itemId);
    if (!item || item.type !== 'weapon') {
      return res.status(400).json({ ok: false, error: 'not_a_weapon' });
    }
    const invRef = db.collection('inventories').doc(uid).collection('items').doc(itemId);
    const snap = await invRef.get();
    if (!snap.exists || (snap.data().quantity || 0) < 1) {
      return res.status(400).json({ ok: false, error: 'not_owned' });
    }
    await db.collection('players').doc(uid).update({
      equippedWeaponId: itemId,
      updatedAt: Date.now(),
    });
    return res.json({ ok: true, equippedWeaponId: itemId });
  } catch (e) {
    console.error('POST /api/inventory/equip failed:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.post('/inventory/merge', async (req, res) => {
  const uid = req.uid;
  const { itemId } = req.body || {};
  if (!itemId) return res.status(400).json({ ok: false, error: 'bad_request' });
  try {
    const out = await db.runTransaction(async (tx) => {
      const now = Date.now();
      const item = contentApi.getItem(itemId);
      const invRef = db.collection('inventories').doc(uid).collection('items').doc(itemId);
      const iSnap = await tx.get(invRef);
      const inv = iSnap.exists ? iSnap.data() : null;

      const maxStars = (contentApi.content.weaponPower || {}).maxStars || 6;
      const err = validateMerge({ item, inv, maxStars });
      if (err) return { error: err };

      // Hoisted reads for achievements.
      const playerRef = db.collection('players').doc(uid);
      const pSnap = await tx.get(playerRef);
      const player = pSnap.exists ? pSnap.data() : {};
      const earned = await readEarned(tx, db, uid, USE_FAKE);
      const invRows = await listInventory(tx, db, uid, USE_FAKE);
      const needsFriends = (contentApi.content.achievements || []).some(
        (a) => a.trigger && a.trigger.type === 'friends' && !earned[a.id]
      );
      const friendCount = needsFriends ? await countFriends(tx, db, USE_FAKE, uid) : 0;

      // Merge: consume one copy, add a star (first merge of two fresh
      // copies lands on 2 stars).
      const stars = inv.stars || 0;
      const newStars = stars === 0 ? 2 : Math.min(maxStars, stars + 1);
      const newQty = (inv.quantity || 0) - 1;
      tx.update(invRef, { quantity: newQty, stars: newStars });

      // Achievements with the post-merge weapon state.
      const weapons = weaponSummary(contentApi.content, invRows, (id) => contentApi.getItem(id)).map(
        (w, i) => (invRows[i].id === itemId ? { ...w, stars: newStars } : w)
      );
      // Ensure the merged weapon is represented even if summary missed it.
      if (!weapons.some((w, i) => invRows[i] && invRows[i].id === itemId)) {
        weapons.push({
          power: weaponPower(contentApi.content, item, inv.upgradeLevel || 0, newStars),
          stars: newStars,
          maxed: (inv.upgradeLevel || 0) >= (item.upgradeCosts || []).length,
        });
      }
      const stats = player.stats || {};
      const { newly, xp: achXp } = grantNewlyEarned(tx, db, {
        uid,
        content: contentApi.content,
        earned,
        stats,
        friendCount,
        weapons,
        now,
      });
      let applied = { level: player.level || 1, xp: player.xp || 0, leveledUp: false };
      if (achXp > 0) {
        applied = applyXp(applied, achXp, contentApi.content.xpCurve);
        tx.update(playerRef, { xp: applied.xp, level: applied.level, updatedAt: now });
      }

      return {
        ok: true,
        itemId,
        stars: newStars,
        quantity: newQty,
        power: weaponPower(contentApi.content, item, inv.upgradeLevel || 0, newStars),
        achievements: newly.map((a) => ({ id: a.id, name: a.name, xp: a.xp })),
        leveledUp: applied.leveledUp,
        level: applied.level,
      };
    });

    if (out.error) return res.status(400).json({ ok: false, error: out.error });
    return res.json(out);
  } catch (e) {
    console.error('POST /api/inventory/merge failed:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

module.exports = router;
