'use strict';
/**
 * Silent activity logging: every authoritative server action writes one doc
 * to `activityLogs/{autoId}` = {uid, type, details, createdAt}.
 *
 * createdAt is the Firestore server timestamp in real mode and Date.now()
 * in fake mode (the fake stand-in has no FieldValue sentinels).
 *
 * Two call styles:
 * - logActivity(db, {uid, type, details}): writes outside a transaction.
 *   Callers await it inside try/catch so a logging failure never breaks
 *   gameplay.
 * - activityEntry(db, {uid, type, details}): returns the [ref, doc] pair so
 *   the caller can include the write in the SAME Firestore transaction as
 *   the action (atomic with the game state change).
 */
const { loadAdmin, USE_FAKE } = require('./db');

function serverTs() {
  if (USE_FAKE) return Date.now();
  return loadAdmin().firestore.FieldValue.serverTimestamp();
}

function activityEntry(db, { uid, type, details }) {
  const ref = db.collection('activityLogs').doc();
  const doc = {
    uid,
    type,
    details: details || {},
    createdAt: serverTs(),
  };
  return [ref, doc];
}

async function logActivity(db, entry) {
  const [ref, doc] = activityEntry(db, entry);
  await ref.set(doc);
}

module.exports = { logActivity, activityEntry };
