'use strict';
/**
 * Referral system helpers.
 * - Referral code = playerCode (traveler code)
 * - New user enters code at signup → gets 50 petals, linked to referrer
 * - Referrer gets 10% of referred player's earnings from:
 *   - Hunt petals
 *   - Marketplace sales
 * - NOT from events, redeem codes, or trades (trades are item swaps, no petals)
 */
const { db, USE_FAKE } = require('./db');
const { uidByCode } = require('./playerCode');

const REFERRAL_BONUS = 50; // Petals new user gets for using a code
const REFERRAL_RATE = 0.10; // 10% of earnings

/**
 * Grant referral earnings to the referrer.
 * Called after a referred player earns petals from hunt or marketplace.
 * @param {object} tx - Firestore transaction
 * @param {string} referredUid - UID of the player who earned
 * @param {number} earnedPetals - Petals earned by the referred player
 * @param {string} source - 'hunt' | 'marketplace'
 * @param {number} now - Timestamp
 * @returns {number} Petals granted to referrer (0 if no referrer or no earnings)
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

  // Calculate 10% (rounded down, min 1 if earned > 0)
  const bonus = Math.floor(earnedPetals * REFERRAL_RATE);
  if (bonus <= 0) return 0;

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

  // Update referral relationship doc
  const relId = `${referrerUid}_${referredUid}`;
  const relRef = db.collection('referrals').doc(relId);
  const relSnap = await tx.get(relRef);
  if (relSnap.exists) {
    tx.update(relRef, {
      totalEarned: (relSnap.data().totalEarned || 0) + bonus,
      updatedAt: now,
    });
  }

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
  if (!code || typeof code !== 'string') {
    return { ok: false, error: 'invalid_code' };
  }
  const cleanCode = code.trim().toUpperCase();
  if (!cleanCode) return { ok: false, error: 'invalid_code' };

  // Find referrer by code
  const referrerUid = await uidByCode(cleanCode);
  if (!referrerUid) return { ok: false, error: 'code_not_found' };
  if (referrerUid === newUid) return { ok: false, error: 'self_referral' };

  // Check new user hasn't already claimed
  const newUserRef = db.collection('players').doc(newUid);
  const newUserSnap = await tx.get(newUserRef);
  if (!newUserSnap.exists) return { ok: false, error: 'player_not_found' };

  const newUserData = newUserSnap.data();
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
  REFERRAL_RATE,
  grantReferralEarning,
  claimReferralBonus,
};
