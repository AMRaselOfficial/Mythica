'use strict';
/**
 * Referral system helpers.
 * - Referral code = playerCode (traveler code)
 * - New user enters code at signup → gets 50 petals, linked to referrer
 * - Referrer gets 10 petals for every 100 petals the referred player earns
 *   from hunts + marketplace (cumulative, threshold-based).
 *   Example: referred earns 100 total → referrer gets 10.
 *   Referred earns 200 total → referrer gets another 10.
 *   Based on cumulative earnings, NOT current balance.
 * - NOT from events, redeem codes, or trades (trades are item swaps, no petals)
 */
const { db, USE_FAKE } = require('./db');
const { uidByCode } = require('./playerCode');

const REFERRAL_BONUS = 50; // Petals new user gets for using a code
const REFERRAL_THRESHOLD = 100; // Petals referred must earn (cumulative) per payout
const REFERRAL_PAYOUT = 10; // Petals referrer gets per threshold crossed (10% of 100)

/**
 * Grant referral earnings to the referrer.
 * Threshold-based: every time the referred player's CUMULATIVE earnings
 * (hunts + marketplace) cross a multiple of 100, referrer gets 10 petals.
 * Example: referred earns 100 total → referrer gets 10.
 *          referred earns 250 total → referrer has 20 (next payout at 300).
 * Based on cumulative earnings, NOT current balance.
 * @param {object} tx - Firestore transaction
 * @param {string} referredUid - UID of the player who earned
 * @param {number} earnedPetals - Petals earned by the referred player
 * @param {string} source - 'hunt' | 'marketplace'
 * @param {number} now - Timestamp
 * @returns {number} Petals granted to referrer (0 if threshold not crossed)
 */
async function grantReferralEarning(tx, referredUid, earnedPetals, source, now) {
  if (!earnedPetals || earnedPetals <= 0) return 0;

  // Get referred player's doc to find referrer
  const referredRef = db.collection('players').doc(referredUid);
  const referredSnap = await tx.get(referredRef);
  if (!referredSnap.exists) return 0;

  const referredData = referredSnap.data();
  const referrerUid = referredData.referredBy;
  if (!referrerUid) return 0;

  // Get referral relationship doc
  const relId = `${referrerUid}_${referredUid}`;
  const relRef = db.collection('referrals').doc(relId);
  const relSnap = await tx.get(relRef);
  if (!relSnap.exists) return 0;

  const relData = relSnap.data();
  const prevTotal = relData.totalEarned || 0;
  const newTotal = prevTotal + earnedPetals;
  const prevThresholds = Math.floor(prevTotal / REFERRAL_THRESHOLD);
  const newThresholds = Math.floor(newTotal / REFERRAL_THRESHOLD);

  // Update total earned (always, even if no payout yet)
  tx.update(relRef, {
    totalEarned: newTotal,
    updatedAt: now,
  });

  // No new threshold crossed → no payout yet
  if (newThresholds <= prevThresholds) return 0;

  // Calculate payout: 10 petals per new threshold crossed
  const thresholdsCrossed = newThresholds - prevThresholds;
  const bonus = thresholdsCrossed * REFERRAL_PAYOUT;

  // Grant to referrer
  const referrerRef = db.collection('players').doc(referrerUid);
  const referrerSnap = await tx.get(referrerRef);
  if (!referrerSnap.exists) return 0;

  const referrerData = referrerSnap.data();
  tx.update(referrerRef, {
    petals: (referrerData.petals || 0) + bonus,
    referralEarnings: (referrerData.referralEarnings || 0) + bonus,
    updatedAt: now,
  });

  // Log the earning event
  const logRef = db.collection('referralEarnings').doc();
  tx.set(logRef, {
    referrerUid,
    referredUid,
    amount: bonus,
    source,
    earnedPetals,
    createdAt: now,
  });

  return bonus;
}

/**
 * Claim a referral bonus for a new user.
 * Validates the code, grants 50 petals, links accounts.
 * @param {object} tx - Firestore transaction
 * @param {string} newUid - UID of the new user
 * @param {string} code - Referral code entered
 * @param {number} now - Timestamp
 * @returns {object} { ok, error?, referrerUid?, bonus? }
 */
async function claimReferralBonus(tx, newUid, code, now) {
  console.log(`[claimReferralBonus] newUid=${newUid} code=${code}`);
  if (!code || typeof code !== 'string') {
    console.log(`[claimReferralBonus] invalid_code: code=${code}`);
    return { ok: false, error: 'invalid_code' };
  }
  const cleanCode = code.trim().toUpperCase();
  if (!cleanCode) return { ok: false, error: 'invalid_code' };

  // Find referrer by code
  const referrerUid = await uidByCode(cleanCode);
  console.log(`[claimReferralBonus] uidByCode(${cleanCode}) = ${referrerUid}`);
  if (!referrerUid) return { ok: false, error: 'code_not_found' };
  if (referrerUid === newUid) return { ok: false, error: 'self_referral' };

  // Get or create new user's player doc.
  // The client creates the doc async via AuthContext, but the claim can
  // race ahead of it. If the doc doesn't exist yet, create a minimal one
  // here - the client will fill in displayName/email/etc. on next load.
  // This is the root fix for player_not_found on referral claims.
  const newUserRef = db.collection('players').doc(newUid);
  let newUserSnap = await tx.get(newUserRef);
  console.log(`[claimReferralBonus] newUser exists=${newUserSnap.exists}`);
  let newUserData;
  if (!newUserSnap.exists) {
    console.log(`[claimReferralBonus] creating minimal player doc for ${newUid}`);
    newUserData = {
      displayName: 'Wanderer',
      email: '',
      petals: 20,
      level: 1,
      xp: 0,
      createdAt: now,
      updatedAt: now,
      lastHuntAt: null,
      musicEnabled: true,
      sfxEnabled: true,
      accountStatus: 'active',
    };
    tx.set(newUserRef, newUserData);
  } else {
    newUserData = newUserSnap.data();
  }

  if (newUserData.referredBy) return { ok: false, error: 'already_claimed' };
  if (newUserData.referralClaimed) return { ok: false, error: 'already_claimed' };

  // Check referrer exists
  const referrerRef = db.collection('players').doc(referrerUid);
  const referrerSnap = await tx.get(referrerRef);
  if (!referrerSnap.exists) return { ok: false, error: 'referrer_not_found' };

  // Grant 50 petals to new user
  tx.update(newUserRef, {
    petals: (newUserData.petals || 0) + REFERRAL_BONUS,
    referredBy: referrerUid,
    referralClaimed: true,
    updatedAt: now,
  });

  // Increment referrer's count
  const referrerData = referrerSnap.data();
  tx.update(referrerRef, {
    referralCount: (referrerData.referralCount || 0) + 1,
    updatedAt: now,
  });

  // Create referral relationship
  const relId = `${referrerUid}_${newUid}`;
  const relRef = db.collection('referrals').doc(relId);
  tx.set(relRef, {
    referrerUid,
    referredUid: newUid,
    referredName: newUserData.displayName || 'Wanderer',
    totalEarned: 0,
    createdAt: now,
    updatedAt: now,
  });

  return { ok: true, referrerUid, bonus: REFERRAL_BONUS };
}

module.exports = {
  REFERRAL_BONUS,
  REFERRAL_THRESHOLD,
  REFERRAL_PAYOUT,
  grantReferralEarning,
  claimReferralBonus,
};
