'use strict';
/**
 * POST /api/hunt
 * Transactional hunt: cooldown check (server time), set lastHuntAt at START,
 * resolve equipped weapon power, roll (power-gated), apply, update stats,
 * evaluate achievements, commit — then respond immediately.
 */
const express = require('express');
const { db, USE_FAKE } = require('../lib/db');
const { activityEntry } = require('../lib/activity');
const contentApi = require('../lib/content');
const { rollHunt, applyXp, weaponPower, maxUnlockedRarity } = require('../lib/game');
const { generateUniqueCode } = require('../lib/playerCode');
const { bumpHuntEventProgress } = require('../lib/events');
const { newPlayerEmailError } = require('../lib/emailProviders');
const { syncBestWeaponPower } = require('../lib/leaderboard');
const {
  readEarned,
  grantNewlyEarned,
  countFriends,
  weaponSummary,
  listInventory,
} = require('../lib/achievementsTx');

const router = express.Router();

const STARTER_WEAPON_ID = 'worn-blade';

async function newPlayer(now, uid) {
  return {
    uid: uid || '',
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
    equippedWeaponId: STARTER_WEAPON_ID,
    stats: {
      hunts: 0,
      trades: 0,
      upgrades: 0,
      legendaryLoot: 0,
      mythicLoot: 0,
      huntsToday: 0,
      lastHuntDay: '',
      nightHunts: 0,
      comebacks: 0,
    },
  };
}

function dayString(now) {
  return new Date(now).toISOString().slice(0, 10);
}

router.post('/hunt', async (req, res) => {
  const uid = req.uid;
  try {
    const out = await db.runTransaction(async (tx) => {
      const now = Date.now();
      const playerRef = db.collection('players').doc(uid);
      const snap = await tx.get(playerRef);
      const isNew = !snap.exists;
      // Backup gate: new accounts must use a verified mail provider.
      // (Primary enforcement is the Firestore players/{uid} create rule.)
      const emailErr = newPlayerEmailError(req.email);
      if (isNew && emailErr) {
        return { error: emailErr };
      }
      const player = isNew ? await newPlayer(now, uid) : snap.data();

      const cd = contentApi.cooldownMs();
      const elapsed = now - (player.lastHuntAt || 0);
      if (elapsed < cd) {
        return { error: 'cooldown', retryAfterMs: cd - elapsed };
      }

      // ---- Hoisted reads (before any writes) ----
      const invRows = await listInventory(tx, db, uid, USE_FAKE);
      const earned = await readEarned(tx, db, uid, USE_FAKE);
      // Friend count only matters if friend achievements are still unearned.
      const needsFriends = (contentApi.content.achievements || []).some(
        (a) => a.trigger && a.trigger.type === 'friends' && !earned[a.id]
      );
      const friendCount = needsFriends ? await countFriends(tx, db, USE_FAKE, uid) : 0;

      // Resolve equipped weapon power.
      const getItem = (id) => contentApi.getItem(id);
      let equippedId = player.equippedWeaponId || null;
      let equippedRow = equippedId ? invRows.find((r) => r.id === equippedId) : null;
      let equippedItem = equippedRow ? getItem(equippedRow.id) : null;
      let equippedUpgrade = equippedRow ? equippedRow.data.upgradeLevel || 0 : 0;
      let equippedStars = equippedRow ? equippedRow.data.stars || 0 : 0;
      // Brand-new players: the starter weapon is granted below; use it now.
      if (isNew) {
        equippedId = STARTER_WEAPON_ID;
        equippedItem = getItem(STARTER_WEAPON_ID);
        equippedUpgrade = 0;
        equippedStars = 0;
      }
      // Fallback: best owned weapon.
      if (!equippedItem || equippedItem.type !== 'weapon') {
        let best = null;
        let bestPower = -1;
        for (const r of invRows) {
          const it = getItem(r.id);
          if (!it || it.type !== 'weapon') continue;
          const p = weaponPower(contentApi.content, it, r.data.upgradeLevel || 0, r.data.stars || 0);
          if (p > bestPower) {
            bestPower = p;
            best = { row: r, item: it };
          }
        }
        if (best) {
          equippedId = best.row.id;
          equippedRow = best.row;
          equippedItem = best.item;
          equippedUpgrade = best.row.data.upgradeLevel || 0;
          equippedStars = best.row.data.stars || 0;
        }
      }
      // No weapons at all (pre-weapon-system accounts): grant the starter now.
      let grantStarter = false;
      if (!equippedItem || equippedItem.type !== 'weapon') {
        grantStarter = true;
        equippedId = STARTER_WEAPON_ID;
        equippedItem = getItem(STARTER_WEAPON_ID);
        equippedUpgrade = 0;
        equippedStars = 0;
      }
      const power = equippedItem
        ? weaponPower(contentApi.content, equippedItem, equippedUpgrade, equippedStars)
        : 0;

      const roll = rollHunt(Math.random, contentApi.content, power, player.level || 1);

      // Drop inventory read (hoisted).
      let invRef = null;
      let invSnap = null;
      let item = null;
      if (roll.dropItemId) {
        item = getItem(roll.dropItemId);
        invRef = db.collection('inventories').doc(uid).collection('items').doc(roll.dropItemId);
        invSnap = await tx.get(invRef);
      }

      // ---- Stats update ----
      const stats = { ...(player.stats || {}) };
      const today = dayString(now);
      const lastDay = stats.lastHuntDay || '';
      stats.hunts = (stats.hunts || 0) + 1;
      stats.huntsToday = lastDay === today ? (stats.huntsToday || 0) + 1 : 1;
      stats.lastHuntDay = today;
      const hour = new Date(now).getHours();
      if (hour >= 0 && hour < 4) stats.nightHunts = (stats.nightHunts || 0) + 1;
      // Comeback: previous hunt was 7+ days ago.
      const lastHunt = player.lastHuntAt || 0;
      if (lastHunt > 0 && now - lastHunt > 7 * 24 * 3600 * 1000) {
        stats.comebacks = (stats.comebacks || 0) + 1;
      }
      if (item) {
        if (item.rarity === 'legendary') stats.legendaryLoot = (stats.legendaryLoot || 0) + 1;
        if (item.rarity === 'mythic') stats.mythicLoot = (stats.mythicLoot || 0) + 1;
      }

      // ---- Writes only from this point on. ----
      // XP from the hunt itself.
      const applied = applyXp({ level: player.level || 1, xp: player.xp || 0 }, roll.xpGained, contentApi.content.xpCurve);
      const petals = (player.petals ?? 0) + roll.petalsFound;

      // Achievements: evaluate with post-hunt stats, grant XP on top.
      const weapons = weaponSummary(contentApi.content, invRows, getItem);
      const { newly, xp: achXp } = grantNewlyEarned(tx, db, {
        uid,
        content: contentApi.content,
        earned,
        stats,
        friendCount,
        weapons,
        now,
      });
      const final = applyXp(
        { level: applied.level, xp: applied.xp },
        achXp,
        contentApi.content.xpCurve
      );
      // Preserve a level-up from the hunt XP itself.
      final.leveledUp = applied.leveledUp || final.leveledUp;

      const playerUpdate = {
        lastHuntAt: now,
        level: final.level,
        xp: final.xp,
        petals,
        stats,
        updatedAt: now,
      };
      // Persist equipped weapon if we resolved a fallback.
      if (equippedId && equippedId !== player.equippedWeaponId) {
        playerUpdate.equippedWeaponId = equippedId;
      }
      if (isNew) {
        tx.set(playerRef, { ...player, ...playerUpdate });
        // Grant the starter weapon to brand-new players.
        tx.set(db.collection('inventories').doc(uid).collection('items').doc(STARTER_WEAPON_ID), {
          quantity: 1,
          upgradeLevel: 0,
          stars: 0,
          obtainedAt: now,
          favorite: false,
        });
      } else {
        tx.update(playerRef, playerUpdate);
        // Backfill the starter for pre-weapon-system accounts that own no weapons.
        if (grantStarter) {
          tx.set(db.collection('inventories').doc(uid).collection('items').doc(STARTER_WEAPON_ID), {
            quantity: 1,
            upgradeLevel: 0,
            stars: 0,
            obtainedAt: now,
            favorite: false,
          });
        }
      }

      // Public traveler profile: base info for Agora, Veyra and friends.
      tx.set(
        db.collection('publicProfiles').doc(uid),
        {
          displayName: player.displayName || 'Traveler',
          level: final.level,
          playerCode: player.playerCode || null,
          updatedAt: now,
        },
        { merge: true }
      );

      let drop = null;
      if (roll.dropItemId) {
        let quantity;
        if (invSnap.exists) {
          quantity = (invSnap.data().quantity || 0) + 1;
          tx.update(invRef, { quantity });
        } else {
          quantity = 1;
          tx.set(invRef, { quantity: 1, upgradeLevel: 0, stars: 0, obtainedAt: now, favorite: false });
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
          leveledUp: final.leveledUp,
          weaponPower: power,
          achievements: newly.map((a) => a.id),
        },
      });
      tx.set(logRef, logDoc);

      return {
        ok: true,
        xpGained: roll.xpGained,
        petalsFound: roll.petalsFound,
        drop,
        leveledUp: final.leveledUp,
        level: final.level,
        xp: final.xp,
        petals,
        nextHuntAt: now + cd,
        weaponPower: power,
        equippedWeaponId: equippedId,
        maxRarity: maxUnlockedRarity(contentApi.content, power),
        achievements: newly.map((a) => ({ id: a.id, name: a.name, xp: a.xp })),
      };
    });

    if (out.error === 'cooldown') {
      return res.status(429).json({ ok: false, error: 'cooldown', retryAfterMs: out.retryAfterMs });
    }
    if (out.error === 'email_provider_not_allowed') {
      return res.status(403).json({ ok: false, error: 'email_provider_not_allowed' });
    }

    // Best-effort: progress any joined hunt_count events. Never blocks the response.
    bumpHuntEventProgress(db, USE_FAKE, uid).catch(() => {});

    // Best-effort: refresh best weapon power (a hunt can grant weapons).
    // Runs outside the transaction (reads after the commit).
    db.runTransaction(async (tx) => {
      await syncBestWeaponPower(tx, uid);
    }).catch(() => {});

    return res.json(out);
  } catch (e) {
    console.error('POST /api/hunt failed:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

module.exports = router;
