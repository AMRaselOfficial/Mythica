'use strict';
/**
 * Player leaderboard — rank by strongest weapon power.
 *
 * GET /api/leaderboard
 *   Returns:
 *     global: top 20 players by bestWeaponPower
 *     league: 11 players with the caller centered (5 above, 5 below by power)
 *     you:    { rank, bestWeaponPower } for the caller (rank null if unranked)
 *
 * Error codes: internal
 */
const express = require('express');
const { db, USE_FAKE } = require('../lib/db');
const { listProfilesByPower, entryShape } = require('../lib/leaderboard');

const router = express.Router();

router.get('/leaderboard', async (req, res) => {
  const uid = req.uid;
  try {
    const rows = await listProfilesByPower();

    const global = rows.slice(0, 20).map((r, i) => entryShape(r, i + 1));

    // Caller's position.
    const myIdx = rows.findIndex((r) => r.id === uid);
    let you;
    if (myIdx === -1) {
      // Not ranked (no weapons yet) — check their actual power for display.
      let myPower = 0;
      try {
        const meSnap = await db.collection('publicProfiles').doc(uid).get();
        if (meSnap.exists) myPower = meSnap.data().bestWeaponPower || 0;
      } catch {
        /* ignore */
      }
      you = { rank: null, bestWeaponPower: myPower };
    } else {
      you = { rank: myIdx + 1, bestWeaponPower: rows[myIdx].data.bestWeaponPower || 0 };
    }

    // Your League: 5 above + you + 5 below by power. If the caller is
    // unranked, show the bottom of the board.
    let league = [];
    if (myIdx === -1) {
      const start = Math.max(0, rows.length - 11);
      league = rows.slice(start, start + 11).map((r, i) => entryShape(r, start + i + 1));
    } else {
      const maxStart = Math.max(0, rows.length - 11);
      const start = Math.max(0, Math.min(myIdx - 5, maxStart));
      const end = Math.min(rows.length, start + 11);
      league = rows.slice(start, end).map((r, i) => entryShape(r, start + i + 1));
    }

    return res.json({ ok: true, global, league, you });
  } catch (e) {
    console.error('GET /api/leaderboard failed:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

module.exports = router;
