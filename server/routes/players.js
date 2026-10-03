'use strict';
/**
 * Player profile endpoints.
 * GET /api/player/me          - current player's profile (ensures playerCode)
 * GET /api/players/by-code/:code - look up a player by short code (for trades)
 */
const express = require('express');
const { db } = require('../lib/db');
const { ensurePlayerCode, uidByCode } = require('../lib/playerCode');

const router = express.Router();

function toMillis(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return 0;
}

router.get('/player/me', async (req, res) => {
  try {
    const uid = req.uid;
    const code = await ensurePlayerCode(uid);
    const snap = await db.collection('players').doc(uid).get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'not_found' });
    const p = snap.data();
    res.json({
      ok: true,
      uid,
      displayName: p.displayName || '',
      email: p.email || '',
      playerCode: code || p.playerCode || '',
      petals: p.petals ?? 0,
      level: p.level ?? 1,
      xp: p.xp ?? 0,
      createdAt: toMillis(p.createdAt),
    });
  } catch (e) {
    console.error('GET /api/player/me failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.get('/players/by-code/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ ok: false, error: 'invalid_code' });
    const uid = await uidByCode(code);
    if (!uid) return res.status(404).json({ ok: false, error: 'not_found' });
    // Don't reveal full UID to non-admins; return display info only
    const snap = await db.collection('players').doc(uid).get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'not_found' });
    const p = snap.data();
    res.json({
      ok: true,
      uid, // needed for trade creation; only visible to authenticated users
      displayName: p.displayName || 'Unnamed traveler',
      playerCode: p.playerCode || code,
      level: p.level ?? 1,
    });
  } catch (e) {
    console.error('GET /api/players/by-code failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

module.exports = router;
