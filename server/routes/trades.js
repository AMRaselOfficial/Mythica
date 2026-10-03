'use strict';
/**
 * POST /api/trades/complete {tradeId, idempotencyKey}
 *
 * Trade must be in `accepted` state and the caller must be a participant.
 * Atomically verifies both sides still own their offered quantities, swaps
 * them, marks the trade completed. Idempotent via `idempotency/{key}`.
 */
const express = require('express');
const { db } = require('../lib/db');
const { activityEntry } = require('../lib/activity');
const { validateTradeComplete } = require('../lib/game');

const router = express.Router();

function invRef(uid, itemId) {
  return db.collection('inventories').doc(uid).collection('items').doc(itemId);
}

async function qtyOf(tx, uid, itemId) {
  const snap = await tx.get(invRef(uid, itemId));
  return snap.exists ? snap.data().quantity || 0 : 0;
}

/** Adjust inventory by delta (delta may be negative). Creates the doc if needed. */
async function adjustInv(tx, uid, itemId, delta, now) {
  const ref = invRef(uid, itemId);
  const snap = await tx.get(ref);
  if (snap.exists) {
    tx.update(ref, { quantity: (snap.data().quantity || 0) + delta });
  } else {
    tx.set(ref, { quantity: delta, upgradeLevel: 0, obtainedAt: now, favorite: false });
  }
}

router.post('/trades/complete', async (req, res) => {
  const uid = req.uid;
  const { tradeId, idempotencyKey } = req.body || {};
  if (!tradeId || !idempotencyKey) {
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }
  try {
    const out = await db.runTransaction(async (tx) => {
      const idemRef = db.collection('idempotency').doc(idempotencyKey);
      const idemSnap = await tx.get(idemRef);
      if (idemSnap.exists) return { result: idemSnap.data().result };

      const tradeRef = db.collection('trades').doc(tradeId);
      const tSnap = await tx.get(tradeRef);
      const trade = tSnap.exists ? tSnap.data() : null;

      const offerQtyOwned = trade ? await qtyOf(tx, trade.offeredBy, trade.offerItemId) : 0;
      const wantQtyOwned = trade ? await qtyOf(tx, trade.offeredTo, trade.wantItemId) : 0;

      const err = validateTradeComplete({ trade, uid, offerQtyOwned, wantQtyOwned });
      if (err) return { error: err };

      const now = Date.now();
      // Atomic swap: offeredBy gives offerItemId, receives wantItemId (and vice versa).
      await adjustInv(tx, trade.offeredBy, trade.offerItemId, -trade.offerQty, now);
      await adjustInv(tx, trade.offeredBy, trade.wantItemId, trade.wantQty, now);
      await adjustInv(tx, trade.offeredTo, trade.wantItemId, -trade.wantQty, now);
      await adjustInv(tx, trade.offeredTo, trade.offerItemId, trade.offerQty, now);

      tx.update(tradeRef, { status: 'completed', completedAt: now });

      const [logRef, logDoc] = activityEntry(db, {
        uid,
        type: 'trade_completed',
        details: {
          tradeId,
          offeredBy: trade.offeredBy,
          offeredTo: trade.offeredTo,
          offerItemId: trade.offerItemId,
          offerQty: trade.offerQty,
          wantItemId: trade.wantItemId,
          wantQty: trade.wantQty,
        },
      });
      tx.set(logRef, logDoc);

      const result = { ok: true };
      tx.set(idemRef, { key: idempotencyKey, result, createdAt: now });
      return { result };
    });

    if (out.error) return res.status(400).json({ ok: false, error: out.error });
    return res.json(out.result);
  } catch (e) {
    console.error('POST /api/trades/complete failed:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

module.exports = router;
