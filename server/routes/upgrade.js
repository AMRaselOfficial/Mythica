'use strict';
/**
 * POST /api/upgrade {itemId, idempotencyKey}
 *
 * Validates the item is upgradeable, owned, below max level, and the player
 * can afford upgradeCosts[upgradeLevel]. Atomically deducts petals and bumps
 * upgradeLevel. Idempotent via `idempotency/{key}`.
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

      const err = validateUpgrade({ item, inv, petals });
      if (err) return { error: err };

      const level = inv.upgradeLevel || 0;
      const cost = item.upgradeCosts[level];
      const now = Date.now();
      tx.update(playerRef, { petals: petals - cost, updatedAt: now });
      tx.update(invRef, { upgradeLevel: level + 1 });

      const [logRef, logDoc] = activityEntry(db, {
        uid,
        type: 'upgrade',
        details: { itemId, newLevel: level + 1, cost },
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
