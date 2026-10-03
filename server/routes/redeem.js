'use strict';
/**
 * Redeem codes — promotional codes players redeem for rewards.
 *
 * POST /api/redeem { code }
 *
 * Fully transactional: validates the code, enforces once-per-user and the
 * code's max-redemptions limit, then grants petals / xp (with level-ups) /
 * items atomically. Codes are created and managed via the admin API
 * (routes/admin.js); clients can never read or write redeemCodes directly
 * (see firestore.rules).
 *
 * Error codes: invalid_code, inactive, expired, limit_reached, already_redeemed
 */
const express = require('express');
const { db } = require('../lib/db');
const { applyXp } = require('../lib/game');
const contentApi = require('../lib/content');
const { logActivity } = require('../lib/activity');

const router = express.Router();

/** Normalize a user-typed code: uppercase, trimmed, safe charset, capped. */
function normalizeCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 32);
}

router.post('/redeem', async (req, res) => {
  const uid = req.uid;
  const code = normalizeCode(req.body && req.body.code);
  if (!code) return res.status(400).json({ ok: false, error: 'invalid_code' });

  try {
    const out = await db.runTransaction(async (tx) => {
      const now = Date.now();
      const codeRef = db.collection('redeemCodes').doc(code);
      const claimRef = db.collection('redeemClaims').doc(`${code}_${uid}`);
      const playerRef = db.collection('players').doc(uid);

      const codeSnap = await tx.get(codeRef);
      const claimSnap = await tx.get(claimRef);
      const playerSnap = await tx.get(playerRef);

      if (!codeSnap.exists) return { error: 'invalid_code' };
      const rc = codeSnap.data();
      if (!rc.active) return { error: 'inactive' };
      if (rc.expiresAt && now > rc.expiresAt) return { error: 'expired' };
      const max = Math.max(0, Math.floor(rc.maxRedemptions || 0));
      if (max > 0 && (rc.redeemedCount || 0) >= max) return { error: 'limit_reached' };
      if (claimSnap.exists) return { error: 'already_redeemed' };
      if (!playerSnap.exists) return { error: 'not_found' };

      const player = playerSnap.data();
      const petalsGain = Math.max(0, Math.floor(rc.petals || 0));
      const xpGain = Math.max(0, Math.floor(rc.xp || 0));
      const items = Array.isArray(rc.items) ? rc.items : [];

      const applied = applyXp(player, xpGain, contentApi.content.xpCurve);
      const newPetals = (player.petals || 0) + petalsGain;

      // Firestore transactions require ALL reads before ALL writes, so the
      // inventory reads are hoisted here ahead of any write.
      const invReads = [];
      for (const it of items) {
        const itemId = String((it && it.itemId) || '');
        const qty = Math.floor(Number((it && it.quantity) || 0));
        const item = contentApi.getItem(itemId);
        if (!item || qty <= 0) continue;
        const invRef = db.collection('inventories').doc(uid).collection('items').doc(itemId);
        const invSnap = await tx.get(invRef);
        invReads.push({ item, itemId, qty, invRef, invSnap });
      }

      // ---- Writes only from this point on. ----
      tx.update(playerRef, {
        petals: newPetals,
        level: applied.level,
        xp: applied.xp,
        updatedAt: now,
      });

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

      tx.set(claimRef, { code, uid, redeemedAt: now });
      tx.update(codeRef, { redeemedCount: (rc.redeemedCount || 0) + 1, updatedAt: now });

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
        ok: true,
        rewards: {
          petals: petalsGain,
          xp: xpGain,
          level: applied.level,
          leveledUp: applied.leveledUp,
          items: grantedItems,
        },
      };
    });

    if (out.error) {
      const status = out.error === 'not_found' ? 404 : 400;
      return res.status(status).json({ ok: false, error: out.error });
    }

    try {
      await logActivity(db, { uid, type: 'redeem_code', details: { code, rewards: out.rewards } });
    } catch (e) {
      console.error('redeem activity log failed:', e && e.message);
    }
    return res.json(out);
  } catch (e) {
    console.error('POST /api/redeem failed:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

module.exports = router;
