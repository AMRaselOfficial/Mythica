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

module.exports = { generateUniqueCode, ensurePlayerCode, uidByCode, CODE_LEN };
