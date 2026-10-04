'use strict';
/**
 * POST /api/upgrade {itemId, idempotencyKey}
 *
 * Validates the item is upgradeable, owned, below max level, and the player
 * can afford upgradeCosts[upgradeLevel] plus the required upgradeMaterials.
 * Atomically deducts petals + materials and bumps upgradeLevel.
 * Idempotent via `idempotency/{key}`.
 */
const express = require('express');
const { db } = require('../lib/db');
const { activityEntry } = require('../lib/activity');
const contentApi = require('../lib/content');
const { validateUpgrade } = require('../lib/game');

const router = express.Router();

router.post('/upgrade', async (req, res) => {
  const uid = req.uid;
  const { itemId, idempotencyKey } = req.body || {};
  if (!itemId || !idempotencyKey) {
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }
  try {
    const out = await db.runTransaction(async (tx) => {
      const idemRef = db.collection('idempotency').doc(idempotencyKey);
      const idemSnap = await tx.get(idemRef);
      if (idemSnap.exists) return { result: idemSnap.data().result };

      const item = contentApi.getItem(itemId);
      const invRef = db.collection('inventories').doc(uid).collection('items').doc(itemId);
      const iSnap = await tx.get(invRef);
      const inv = iSnap.exists ? iSnap.data() : null;

      const playerRef = db.collection('players').doc(uid);
      const pSnap = await tx.get(playerRef);
      const petals = pSnap.exists ? pSnap.data().petals ?? 0 : 0;

      // Hoist material reads ahead of any writes (Firestore transaction rule).
      const level = inv ? inv.upgradeLevel || 0 : 0;
      const needMats = (item && item.upgradeMaterials && item.upgradeMaterials[level]) || [];
      const matSnaps = [];
      for (const m of needMats) {
        const mRef = db.collection('inventories').doc(uid).collection('items').doc(m.id);
        matSnaps.push({ id: m.id, qty: m.qty || 0, snap: await tx.get(mRef) });
      }
      const materials = {};
      for (const { id, snap } of matSnaps) {
        materials[id] = snap.exists ? snap.data().quantity || 0 : 0;
      }

      const err = validateUpgrade({ item, inv, petals, materials });
      if (err) return { error: err };

      const cost = item.upgradeCosts[level];
      const now = Date.now();
      tx.update(playerRef, { petals: petals - cost, updatedAt: now });
      tx.update(invRef, { upgradeLevel: level + 1 });
      // Deduct upgrade materials.
      for (const { id, qty, snap } of matSnaps) {
        const mRef = db.collection('inventories').doc(uid).collection('items').doc(id);
        const remaining = (snap.exists ? snap.data().quantity || 0 : 0) - qty;
        if (remaining <= 0) tx.delete(mRef);
        else tx.update(mRef, { quantity: remaining });
      }

      const [logRef, logDoc] = activityEntry(db, {
        uid,
        type: 'upgrade',
        details: { itemId, newLevel: level + 1, cost, materials: needMats },
      });
      tx.set(logRef, logDoc);

      const result = { ok: true, itemId, newLevel: level + 1 };
      tx.set(idemRef, { key: idempotencyKey, result, createdAt: now });
      return { result };
    });

    if (out.error) return res.status(400).json({ ok: false, error: out.error });
    return res.json(out.result);
  } catch (e) {
    console.error('POST /api/upgrade failed:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

module.exports = router;
