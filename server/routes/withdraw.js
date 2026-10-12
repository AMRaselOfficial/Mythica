'use strict';
/**
 * Petal withdrawal routes — players convert Petals to real money.
 *
 * Rate: 1000 Petals = $0.10  →  10000 Petals = $1.00
 * Minimum withdrawal: $1.00 (10000 Petals)
 * Payout method: Binance (player supplies their Binance UID)
 *
 * Player endpoints (auth required):
 *   POST /api/withdraw          create a withdrawal request {binanceUid, petals}
 *   GET  /api/withdraw/mine     list the caller's requests (newest first)
 *   GET  /api/withdraw/rates    public rate info
 *
 * Admin endpoints live in server/routes/admin.js:
 *   GET  /api/admin/withdrawals
 *   GET  /api/admin/withdrawals/:id
 *   POST /api/admin/withdrawals/:id/approve
 *   POST /api/admin/withdrawals/:id/reject   (refunds petals)
 *   POST /api/admin/withdrawals/:id/complete (marks as paid)
 *
 * Flow: player requests → petals deducted immediately → admin reviews in the
 * admin panel → admin sends USD via Binance manually → admin marks completed.
 * If admin rejects, the petals are refunded automatically.
 *
 * Queries go through lib/events helpers (whereEquals/listCollection) so they
 * work in both real Firestore and the fake in-memory DB used by tests.
 *
 * Error codes: bad_binance_uid, bad_petals, insufficient_petals,
 *              below_minimum, pending_exists, not_found, forbidden
 */
const express = require('express');
const { db, USE_FAKE } = require('../lib/db');
const { whereEquals, txWhereEquals, toMillis } = require('../lib/events');

const router = express.Router();

// 1000 Petals = $0.10
const PETALS_PER_USD = 10000;        // 10000 petals = $1.00
const MIN_PETALS = 10000;            // $1.00 minimum
const MAX_PETALS_PER_REQUEST = 10000000; // sanity cap: $1000 per request

function petalsToUsd(petals) {
  // Keep 2 decimal places; 1000 petals = $0.10 exactly.
  return Math.round((petals / PETALS_PER_USD) * 100) / 100;
}

function publicWithdrawal(id, d) {
  return {
    id,
    petals: d.petals || 0,
    usd: d.usd || 0,
    binanceUid: d.binanceUid || '',
    status: d.status || 'pending',
    adminNote: d.adminNote || '',
    createdAt: toMillis(d.createdAt),
    updatedAt: toMillis(d.updatedAt),
    processedAt: toMillis(d.processedAt),
  };
}

/**
 * POST /api/withdraw — create a withdrawal request.
 * Body: { binanceUid: string, petals: number }
 */
router.post('/withdraw', async (req, res) => {
  try {
    const uid = req.uid;
    const binanceUid = String(req.body?.binanceUid || '').trim();
    const petals = Math.floor(Number(req.body?.petals));

    if (!binanceUid || binanceUid.length < 4 || binanceUid.length > 64) {
      return res.status(400).json({ ok: false, error: 'bad_binance_uid' });
    }
    if (!Number.isFinite(petals) || petals <= 0) {
      return res.status(400).json({ ok: false, error: 'bad_petals' });
    }
    if (petals < MIN_PETALS) {
      return res.status(400).json({ ok: false, error: 'below_minimum', minPetals: MIN_PETALS });
    }
    if (petals > MAX_PETALS_PER_REQUEST) {
      return res.status(400).json({ ok: false, error: 'bad_petals' });
    }

    const now = Date.now();
    const usd = petalsToUsd(petals);

    const result = await db.runTransaction(async (tx) => {
      const playerRef = db.collection('players').doc(uid);
      const playerSnap = await tx.get(playerRef);
      if (!playerSnap.exists) {
        return { error: 'not_found' };
      }
      const player = playerSnap.data();
      if (player.accountStatus === 'banned') {
        return { error: 'forbidden' };
      }
      const balance = player.petals || 0;
      if (balance < petals) {
        return { error: 'insufficient_petals', balance };
      }

      // One pending/approved request at a time per player.
      const existing = await txWhereEquals(db, tx, USE_FAKE, 'withdrawals', 'uid', uid);
      if (existing.some((r) => r.data.status === 'pending' || r.data.status === 'approved')) {
        return { error: 'pending_exists' };
      }

      // Deduct petals immediately so they can't be double-spent.
      tx.update(playerRef, {
        petals: balance - petals,
        updatedAt: now,
      });

      const wdRef = db.collection('withdrawals').doc();
      const wdData = {
        uid,
        displayName: player.displayName || 'Unnamed traveler',
        email: player.email || '',
        binanceUid,
        petals,
        usd,
        status: 'pending',
        adminNote: '',
        createdAt: now,
        updatedAt: now,
        processedAt: null,
      };
      tx.set(wdRef, wdData);

      // Audit log
      const logRef = db.collection('activityLogs').doc();
      tx.set(logRef, {
        type: 'withdraw_request',
        uid,
        withdrawalId: wdRef.id,
        petals,
        usd,
        createdAt: now,
      });

      return { withdrawalId: wdRef.id, usd, newBalance: balance - petals };
    });

    if (result.error) {
      const status = result.error === 'forbidden' ? 403 : result.error === 'not_found' ? 404 : 400;
      return res.status(status).json({ ok: false, error: result.error, balance: result.balance });
    }

    res.json({
      ok: true,
      withdrawalId: result.withdrawalId,
      petals,
      usd: result.usd,
      newBalance: result.newBalance,
    });
  } catch (e) {
    console.error('POST /api/withdraw failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

/**
 * GET /api/withdraw/mine — list the caller's withdrawal requests, newest first.
 */
router.get('/withdraw/mine', async (req, res) => {
  try {
    const uid = req.uid;
    const rows = await whereEquals(db, USE_FAKE, 'withdrawals', 'uid', uid);
    rows.sort((a, b) => (b.data.createdAt || 0) - (a.data.createdAt || 0));
    const items = rows.slice(0, 50).map((r) => publicWithdrawal(r.id, r.data));
    res.json({ ok: true, withdrawals: items });
  } catch (e) {
    console.error('GET /api/withdraw/mine failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

/**
 * GET /api/withdraw/rates — public rate info for the Withdraw tab.
 */
router.get('/withdraw/rates', async (req, res) => {
  res.json({
    ok: true,
    petalsPerUsd: PETALS_PER_USD,
    minPetals: MIN_PETALS,
    minUsd: petalsToUsd(MIN_PETALS),
    payoutMethod: 'Binance',
  });
});

module.exports = router;
module.exports.PETALS_PER_USD = PETALS_PER_USD;
module.exports.MIN_PETALS = MIN_PETALS;
module.exports.petalsToUsd = petalsToUsd;
