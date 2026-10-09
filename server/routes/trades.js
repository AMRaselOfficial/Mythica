'use strict';
/**
 * POST /api/trades/complete {tradeId, idempotencyKey}
 *
 * Trade must be in `accepted` state and the caller must be a participant.
 * Atomically verifies both sides still own their offered quantities, swaps
 * them, marks the trade completed. Idempotent via `idempotency/{key}`.
 */
const express = require('express');
const { db, USE_FAKE } = require('../lib/db');
const { activityEntry } = require('../lib/activity');
const { validateTradeComplete, applyXp } = require('../lib/game');
const contentApi = require('../lib/content');
const { checkAndGrant } = require('../lib/achievementsTx');
const { syncBestWeaponPower } = require('../lib/leaderboard');

const router = express.Router();

function invRef(uid, itemId) {
  return db.collection('inventories').doc(uid).collection('items').doc(itemId);
}

async function qtyOf(tx, uid, itemId) {
  const snap = await tx.get(invRef(uid, itemId));
  return snap.exists ? snap.data().quantity || 0 : 0;
}

/** Read an inventory doc snapshot (read phase). */
async function readInvSnap(tx, uid, itemId) {
  return tx.get(invRef(uid, itemId));
}

/** Apply an inventory adjustment from a pre-read snapshot (write phase). */
function writeInvAdjust(tx, uid, itemId, snap, delta, now) {
  const ref = invRef(uid, itemId);
  if (snap.exists) {
    tx.update(ref, { quantity: (snap.data().quantity || 0) + delta });
  } else {
    tx.set(ref, { quantity: delta, upgradeLevel: 0, obtainedAt: now, favorite: false });
  }
}

/** Adjust inventory by delta (delta may be negative). Creates the doc if needed.
 *  For single adjustments outside multi-write transactions. */
async function adjustInv(tx, uid, itemId, delta, now) {
  const snap = await readInvSnap(tx, uid, itemId);
  writeInvAdjust(tx, uid, itemId, snap, delta, now);
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
      if (idemSnap.exists) return { result: idemSnap.data().result, replay: true };

      const tradeRef = db.collection('trades').doc(tradeId);
      const tSnap = await tx.get(tradeRef);
      const trade = tSnap.exists ? tSnap.data() : null;

      const offerQtyOwned = trade ? await qtyOf(tx, trade.offeredBy, trade.offerItemId) : 0;
      const wantQtyOwned = trade ? await qtyOf(tx, trade.offeredTo, trade.wantItemId) : 0;

      const err = validateTradeComplete({ trade, uid, offerQtyOwned, wantQtyOwned });
      if (err) return { error: err };

      const now = Date.now();
      // Firestore transactions require ALL reads before ALL writes: hoist the
      // four inventory reads ahead of the trade-status write below.
      const swap = [
        [trade.offeredBy, trade.offerItemId, -trade.offerQty],
        [trade.offeredBy, trade.wantItemId, trade.wantQty],
        [trade.offeredTo, trade.wantItemId, -trade.wantQty],
        [trade.offeredTo, trade.offerItemId, trade.offerQty],
      ];
      const swapSnaps = [];
      for (const [swapUid, itemId] of swap) {
        swapSnaps.push(await readInvSnap(tx, swapUid, itemId));
      }

      // ---- Writes only from this point on. ----
      // Atomic swap: offeredBy gives offerItemId, receives wantItemId (and vice versa).
      swap.forEach(([swapUid, itemId, delta], i) => {
        writeInvAdjust(tx, swapUid, itemId, swapSnaps[i], delta, now);
      });

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

      const result = { ok: true, offeredBy: trade.offeredBy, offeredTo: trade.offeredTo };
      tx.set(idemRef, { key: idempotencyKey, result, createdAt: now });
      return { result };
    });

    if (out.error) return res.status(400).json({ ok: false, error: out.error });
    // Best-effort: trade-count achievements for both parties. Never blocks.
    // Skipped on idempotent replays so stats aren't double-counted.
    if (!out.replay && out.result && out.result.offeredBy) {
      for (const party of [out.result.offeredBy, out.result.offeredTo]) {
        checkAndGrant(db, USE_FAKE, contentApi.content, (id) => contentApi.getItem(id), applyXp, party, {
          trades: 1,
        }).catch(() => {});
        // Best-effort: refresh best weapon power (trade can move weapons).
        db.runTransaction(async (tx) => {
          await syncBestWeaponPower(tx, party);
        }).catch(() => {});
      }
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/trades/complete failed:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

module.exports = router;
