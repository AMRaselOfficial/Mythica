'use strict';
/**
 * Referral system endpoints.
 * POST /api/referral/claim { code } - Claim 50 petal bonus with a referral code
 * GET /api/referral/stats - Get referral stats: total income, invited count,
 *   latest 10 invited, top 10 earners
 */
const express = require('express');
const { db, USE_FAKE } = require('../lib/db');
const { claimReferralBonus } = require('../lib/referral');

const router = express.Router();

// Claim referral bonus (new user enters code)
router.post('/referral/claim', async (req, res) => {
  const uid = req.uid;
  const { code } = req.body || {};
  console.log(`[REFERRAL CLAIM] uid=${uid} code=${code}`);
  try {
    const out = await db.runTransaction(async (tx) => {
      const now = Date.now();
      return await claimReferralBonus(tx, uid, code, now);
    });
    console.log(`[REFERRAL CLAIM] result for uid=${uid} code=${code}:`, JSON.stringify(out));
    if (!out.ok) {
      return res.status(400).json({ ok: false, error: out.error });
    }
    return res.json({ ok: true, bonus: out.bonus, referrerUid: out.referrerUid });
  } catch (e) {
    console.error('[REFERRAL CLAIM] failed:', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Get referral stats for the current user
router.get('/referral/stats', async (req, res) => {
  const uid = req.uid;
  try {
    // Get player doc for referral code + totals
    const playerRef = db.collection('players').doc(uid);
    const playerSnap = await playerRef.get();
    if (!playerSnap.exists) {
      return res.status(404).json({ ok: false, error: 'player_not_found' });
    }
    const player = playerSnap.data();

    // Get all referrals for this user
    let referrals = [];
    if (USE_FAKE) {
      const all = db._listAll('referrals');
      referrals = all
        .map(({ data }) => data())
        .filter((r) => r.referrerUid === uid);
    } else {
      const snap = await db.collection('referrals')
        .where('referrerUid', '==', uid)
        .get();
      referrals = snap.docs.map((d) => d.data());
    }

    // Sort by createdAt desc for latest 10
    const sortedByDate = [...referrals].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const latest10 = sortedByDate.slice(0, 10).map((r) => ({
      referredUid: r.referredUid,
      referredName: r.referredName || 'Wanderer',
      totalEarned: r.totalEarned || 0,
      createdAt: r.createdAt || 0,
    }));

    // Sort by totalEarned desc for top 10
    const sortedByEarnings = [...referrals].sort((a, b) => (b.totalEarned || 0) - (a.totalEarned || 0));
    const top10 = sortedByEarnings.slice(0, 10).map((r) => ({
      referredUid: r.referredUid,
      referredName: r.referredName || 'Wanderer',
      totalEarned: r.totalEarned || 0,
      createdAt: r.createdAt || 0,
    }));

    // Total income = sum of all referral earnings
    const totalIncome = referrals.reduce((sum, r) => sum + (r.totalEarned || 0), 0);

    return res.json({
      ok: true,
      referralCode: player.playerCode || '',
      totalIncome,
      totalInvited: referrals.length,
      latest10,
      top10,
    });
  } catch (e) {
    console.error('GET /api/referral/stats failed:', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

module.exports = router;
