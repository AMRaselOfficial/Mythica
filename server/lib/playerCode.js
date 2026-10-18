'use strict';
/**
 * Short player codes (e.g. "X8BL09") for trading.
 * 6 chars, uppercase alphanumeric, unique per player.
 */
const { db, USE_FAKE } = require('./db');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1 (confusing)
const CODE_LEN = 6;

function randomCode() {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return s;
}

async function codeExists(code) {
  if (USE_FAKE) {
    const all = db._listAll('players');
    return all.some(({ data }) => data().playerCode === code);
  }
  const snap = await db.collection('players').where('playerCode', '==', code).limit(1).get();
  return !snap.empty;
}

/** Generate a unique 6-char player code. Retries on collision. */
async function generateUniqueCode(maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const code = randomCode();
    if (!(await codeExists(code))) return code;
  }
  // Fallback: timestamp-based (extremely unlikely to reach here)
  return randomCode() + Date.now().toString(36).slice(-2).toUpperCase();
}

/** Ensure a player document has a playerCode; generates and saves if missing.
 *  Returns the code. Safe to call on every request (no-op if code exists). */
async function ensurePlayerCode(uid) {
  const ref = db.collection('players').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data.playerCode) return data.playerCode;
  const code = await generateUniqueCode();
  try {
    await ref.update({ playerCode: code, updatedAt: Date.now() });
  } catch (e) {
    // If update fails (e.g. race), re-read
    const retry = await ref.get();
    if (retry.exists && retry.data().playerCode) return retry.data().playerCode;
    throw e;
  }
  return code;
}

/** Find a player's UID by their short code. Returns null if not found. */
async function uidByCode(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return null;
  if (USE_FAKE) {
    const all = db._listAll('players');
    const hit = all.find(({ data }) => data().playerCode === normalized);
    return hit ? hit.id : null;
  }
  const snap = await db.collection('players').where('playerCode', '==', normalized).limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

const STARTER_WEAPON_ID = 'worn-blade';

/**
 * Ensure the player owns the starter weapon (Worn Blade) in their inventory
 * and has it equipped. Called at signup via ensurePlayerIdentity so new
 * players start with a weapon. Safe to call on every request (no-op if the
 * player already owns the weapon).
 */
async function ensureStarterWeapon(uid) {
  try {
    const invRef = db.collection('inventories').doc(uid).collection('items').doc(STARTER_WEAPON_ID);
    const invSnap = await invRef.get();
    if (!invSnap.exists) {
      await invRef.set({
        quantity: 1,
        upgradeLevel: 0,
        stars: 0,
        obtainedAt: Date.now(),
      });
    }
    // Ensure the player doc has the starter equipped.
    const playerRef = db.collection('players').doc(uid);
    const playerSnap = await playerRef.get();
    if (playerSnap.exists) {
      const data = playerSnap.data();
      if (!data.equippedWeaponId) {
        await playerRef.update({ equippedWeaponId: STARTER_WEAPON_ID, updatedAt: Date.now() });
      }
    }
  } catch (e) {
    // Non-fatal: the weapon will be granted on first hunt as a fallback.
    console.error('ensureStarterWeapon failed for', uid, e.message);
  }
}

/**
 * Ensure a player document carries its own identity fields: `uid` (the
 * Firebase Auth UID, also the doc ID) and a unique `playerCode`.
 * Self-healing for docs created before these fields existed — safe to call
 * on every request (no-op when both are present).
 * Returns the playerCode (or null when the player doc does not exist).
 */
async function ensurePlayerIdentity(uid) {
  const ref = db.collection('players').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  const update = {};
  if (!data.uid) update.uid = uid;
  if (!data.playerCode) update.playerCode = await generateUniqueCode();
  if (Object.keys(update).length) {
    update.updatedAt = Date.now();
    try {
      await ref.update(update);
    } catch (e) {
      // Race: re-read; whoever won already wrote the fields.
      const retry = await ref.get();
      if (retry.exists) return retry.data().playerCode || null;
      throw e;
    }
  }
  // Grant the starter weapon (no-op if already owned).
  await ensureStarterWeapon(uid);
  return data.playerCode || update.playerCode || null;
}

module.exports = { generateUniqueCode, ensurePlayerCode, ensurePlayerIdentity, ensureStarterWeapon, uidByCode, CODE_LEN };
