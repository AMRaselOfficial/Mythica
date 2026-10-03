'use strict';
/**
 * POST /api/hunt
 * Transactional hunt: cooldown check (server time), set lastHuntAt at START,
 * roll, apply, commit — THEN sleep the theater delay and respond.
 */
const express = require('express');
const { db, USE_FAKE } = require('../lib/db');
const { activityEntry } = require('../lib/activity');
const contentApi = require('../lib/content');
const { rollHunt, applyXp } = require('../lib/game');
const { generateUniqueCode, ensurePlayerCode } = require('../lib/playerCode');
const { bumpHuntEventProgress } = require('../lib/events');

const router = express.Router();

async function newPlayer(now) {
  return {
    displayName: '',
    email: '',
    playerCode: await generateUniqueCode(),
    petals: contentApi.startingPetals(),
    level: 1,
    xp: 0,
    createdAt: now,
    updatedAt: now,
    lastHuntAt: 0,
    musicEnabled: true,
    sfxEnabled: true,
    accountStatus: 'active',
  };
}

function theaterMs() {
  const min = Number(process.env.THEATER_MIN_MS ?? 10000);
  const max = Number(process.env.THEATER_MAX_MS ?? 30000);
  return min + Math.random() * Math.max(0, max - min);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

router.post('/hunt', async (req, res) => {
  const uid = req.uid;
  try {
    const out = await db.runTransaction(async (tx) => {
      const now = Date.now();
      const playerRef = db.collection('players').doc(uid);
      const snap = await tx.get(playerRef);
      const isNew = !snap.exists;
      const player = isNew ? await newPlayer(now) : snap.data();

      const cd = contentApi.cooldownMs();
      const elapsed = now - (player.lastHuntAt || 0);
      if (elapsed < cd) {
        return { error: 'cooldown', retryAfterMs: cd - elapsed };
      }

      const roll = rollHunt(Math.random, contentApi.content);
      const applied = applyXp(player, roll.xpGained, contentApi.content.xpCurve);
      const petals = (player.petals ?? 0) + roll.petalsFound;

      // Firestore transactions require ALL reads before ALL writes, so the
      // inventory read is hoisted here ahead of any write.
      let drop = null;
      let invRef = null;
      let invSnap = null;
      let item = null;
      if (roll.dropItemId) {
        item = contentApi.getItem(roll.dropItemId);
        invRef = db
          .collection('inventories')
          .doc(uid)
          .collection('items')
          .doc(roll.dropItemId);
        invSnap = await tx.get(invRef);
      }

      // ---- Writes only from this point on. ----
      const playerUpdate = {
        lastHuntAt: now,
        level: applied.level,
        xp: applied.xp,
        petals,
        updatedAt: now,
      };
      if (isNew) {
        tx.set(playerRef, { ...player, ...playerUpdate });
      } else {
        tx.update(playerRef, playerUpdate);
      }

      // Public traveler profile: base info for Agora, Veyra and friends.
      // Server-maintained; clients can read but never write (see firestore.rules).
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

      if (roll.dropItemId) {
        let quantity;
        if (invSnap.exists) {
          quantity = (invSnap.data().quantity || 0) + 1;
          tx.update(invRef, { quantity });
        } else {
          quantity = 1;
          tx.set(invRef, { quantity: 1, upgradeLevel: 0, obtainedAt: now, favorite: false });
        }
        drop = {
          itemId: item.id,
          name: item.name,
          rarity: item.rarity,
          quantity,
          image: item.image,
        };
      }

      // Activity log rides in the same transaction as the hunt itself.
      const [logRef, logDoc] = activityEntry(db, {
        uid,
        type: 'hunt',
        details: {
          xpGained: roll.xpGained,
          petalsFound: roll.petalsFound,
          dropItemId: roll.dropItemId,
          dropRarity: drop ? drop.rarity : null,
          leveledUp: applied.leveledUp,
        },
      });
      tx.set(logRef, logDoc);

      return {
        ok: true,
        xpGained: roll.xpGained,
        petalsFound: roll.petalsFound,
        drop,
        leveledUp: applied.leveledUp,
        level: applied.level,
        xp: applied.xp,
        petals,
        nextHuntAt: now + cd,
      };
    });

    if (out.error === 'cooldown') {
      return res.status(429).json({ ok: false, error: 'cooldown', retryAfterMs: out.retryAfterMs });
    }

    // Theater delay happens AFTER the transaction commits.
    await sleep(theaterMs());

    // Best-effort: progress any joined hunt_count events. Never blocks the response.
    bumpHuntEventProgress(db, USE_FAKE, uid).catch(() => {});

    return res.json(out);
  } catch (e) {
    console.error('POST /api/hunt failed:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

module.exports = router;
