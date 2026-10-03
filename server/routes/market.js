'use strict';
/**
 * POST /api/market/list    {itemId, quantity, price}
 * POST /api/market/purchase {listingId, idempotencyKey}
 *
 * Purchase is idempotent: results are stored in `idempotency/{key}` and
 * replaying the same key returns the stored result without double-spend.
 */
const express = require('express');
const { db } = require('../lib/db');
const { activityEntry } = require('../lib/activity');
const contentApi = require('../lib/content');
const { validateList, validatePurchase } = require('../lib/game');

const router = express.Router();

function newPlayer(now) {
  return {
    displayName: '',
    email: '',
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

router.post('/market/list', async (req, res) => {
  const uid = req.uid;
  const { itemId, quantity, price } = req.body || {};
  try {
    const out = await db.runTransaction(async (tx) => {
      const item = contentApi.getItem(itemId);
      const invRef = db.collection('inventories').doc(uid).collection('items').doc(itemId);
      const invSnap = await tx.get(invRef);
      const ownedQty = invSnap.exists ? invSnap.data().quantity || 0 : 0;

      const err = validateList({ item, quantity, price, ownedQty });
      if (err) return { error: err };

      tx.update(invRef, { quantity: ownedQty - quantity });
      const listingRef = db.collection('marketplace').doc();
      const now = Date.now();
      tx.set(listingRef, {
        sellerUid: uid,
        itemId,
        quantity,
        price,
        status: 'active',
        createdAt: now,
      });
      const [logRef, logDoc] = activityEntry(db, {
        uid,
        type: 'listing_created',
        details: { listingId: listingRef.id, itemId, quantity, price },
      });
      tx.set(logRef, logDoc);
      return { ok: true, listingId: listingRef.id };
    });

    if (out.error) return res.status(400).json({ ok: false, error: out.error });
    return res.json(out);
  } catch (e) {
    console.error('POST /api/market/list failed:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.post('/market/purchase', async (req, res) => {
  const uid = req.uid;
  const { listingId, idempotencyKey } = req.body || {};
  if (!listingId || !idempotencyKey) {
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }
  try {
    const out = await db.runTransaction(async (tx) => {
      const idemRef = db.collection('idempotency').doc(idempotencyKey);
      const idemSnap = await tx.get(idemRef);
      if (idemSnap.exists) return { result: idemSnap.data().result };

      const listingRef = db.collection('marketplace').doc(listingId);
      const lSnap = await tx.get(listingRef);
      const listing = lSnap.exists ? lSnap.data() : null;

      const buyerRef = db.collection('players').doc(uid);
      const bSnap = await tx.get(buyerRef);
      const buyer = bSnap.exists ? bSnap.data() : null;

      const err = validatePurchase({
        listing,
        buyerUid: uid,
        buyerPetals: buyer ? buyer.petals ?? 0 : 0,
      });
      if (err) return { error: err };

      const now = Date.now();
      // Firestore transactions require ALL reads before ALL writes: hoist the
      // seller and buyer-inventory reads ahead of the buyer write below.
      const sellerRef = db.collection('players').doc(listing.sellerUid);
      const sSnap = await tx.get(sellerRef);
      const invRef = db.collection('inventories').doc(uid).collection('items').doc(listing.itemId);
      const iSnap = await tx.get(invRef);

      // ---- Writes only from this point on. ----
      const buyerPetals = (buyer ? buyer.petals ?? contentApi.startingPetals() : contentApi.startingPetals()) - listing.price;
      if (bSnap.exists) {
        tx.update(buyerRef, { petals: buyerPetals, updatedAt: now });
      } else {
        tx.set(buyerRef, { ...newPlayer(now), petals: buyerPetals });
      }

      if (sSnap.exists) {
        tx.update(sellerRef, { petals: (sSnap.data().petals ?? 0) + listing.price, updatedAt: now });
      } else {
        tx.set(sellerRef, { ...newPlayer(now), petals: contentApi.startingPetals() + listing.price });
      }

      if (iSnap.exists) {
        tx.update(invRef, { quantity: (iSnap.data().quantity || 0) + listing.quantity });
      } else {
        tx.set(invRef, {
          quantity: listing.quantity,
          upgradeLevel: 0,
          obtainedAt: now,
          favorite: false,
        });
      }

      tx.update(listingRef, { status: 'sold', buyerUid: uid, soldAt: now });

      const [logRef, logDoc] = activityEntry(db, {
        uid,
        type: 'purchase',
        details: {
          listingId,
          itemId: listing.itemId,
          quantity: listing.quantity,
          price: listing.price,
          sellerUid: listing.sellerUid,
          buyerUid: uid,
        },
      });
      tx.set(logRef, logDoc);

      const result = { ok: true, itemId: listing.itemId, quantity: listing.quantity, price: listing.price };
      tx.set(idemRef, { key: idempotencyKey, result, createdAt: now });
      return { result };
    });

    if (out.error) return res.status(400).json({ ok: false, error: out.error });
    return res.json(out.result);
  } catch (e) {
    console.error('POST /api/market/purchase failed:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.post('/market/cancel', async (req, res) => {
  const uid = req.uid;
  const { listingId } = req.body || {};
  if (!listingId) {
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }
  try {
    const out = await db.runTransaction(async (tx) => {
      const listingRef = db.collection('marketplace').doc(listingId);
      const lSnap = await tx.get(listingRef);
      if (!lSnap.exists) return { error: 'not_found' };
      const listing = lSnap.data();
      if (listing.sellerUid !== uid) return { error: 'not_seller' };
      if (listing.status !== 'active') return { error: 'bad_state' };

      const now = Date.now();
      // Firestore transactions require ALL reads before ALL writes: hoist the
      // inventory read ahead of the listing-status write below.
      const invRef = db.collection('inventories').doc(uid).collection('items').doc(listing.itemId);
      const iSnap = await tx.get(invRef);

      // ---- Writes only from this point on. ----
      tx.update(listingRef, { status: 'canceled', canceledAt: now });

      // Restore the escrowed quantity to the seller's inventory.
      if (iSnap.exists) {
        tx.update(invRef, { quantity: (iSnap.data().quantity || 0) + listing.quantity });
      } else {
        tx.set(invRef, {
          quantity: listing.quantity,
          upgradeLevel: 0,
          obtainedAt: now,
          favorite: false,
        });
      }

      const [logRef, logDoc] = activityEntry(db, {
        uid,
        type: 'listing_canceled',
        details: { listingId },
      });
      tx.set(logRef, logDoc);

      return { ok: true, listingId };
    });

    if (out.error) {
      const code = out.error === 'not_found' ? 404 : out.error === 'not_seller' ? 403 : 400;
      return res.status(code).json({ ok: false, error: out.error });
    }
    return res.json(out);
  } catch (e) {
    console.error('POST /api/market/cancel failed:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

module.exports = router;
