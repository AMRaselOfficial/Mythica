'use strict';
/**
 * Notification routes.
 *
 * In-app bell notifications are read directly from Firestore by the client
 * (real-time via onSnapshot; rules restrict to the user's own docs). These
 * endpoints handle the server-side pieces:
 *
 * POST /api/notifications/friend-request  {recipientUid} — notify after client
 *   creates a friendship doc (validates the pending request exists)
 * POST /api/notifications/veyra-push  {chatId, recipientUid, text} — send FCM
 *   push for a Veyra private message (validates participants)
 * POST /api/notifications/fcm-token  {token} — register a device token
 * DELETE /api/notifications/fcm-token  {token} — unregister a device token
 *
 * Admin send/broadcast endpoints live in server/routes/admin.js.
 */
const express = require('express');
const { db, USE_FAKE } = require('../lib/db');
const { createNotification, sendFcmToUser } = require('../lib/notifications');

const router = express.Router();

function getMessaging() {
  const admin = require('firebase-admin');
  return admin.messaging();
}

/**
 * POST /api/notifications/friend-request — create a bell notification for
 * the recipient after the client writes the friendships doc.
 */
router.post('/notifications/friend-request', async (req, res) => {
  try {
    const uid = req.uid;
    const recipientUid = String(req.body?.recipientUid || '').trim();
    if (!recipientUid || recipientUid === uid) {
      return res.status(400).json({ ok: false, error: 'bad_uid' });
    }

    // Validate: a pending friendship where the caller is the requester.
    const pairId = [uid, recipientUid].sort().join('_');
    const fsSnap = await db.collection('friendships').doc(pairId).get();
    if (!fsSnap.exists) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    const fs = fsSnap.data();
    if (fs.status !== 'pending' || fs.requesterUid !== uid) {
      return res.status(400).json({ ok: false, error: 'bad_state' });
    }

    // Don't notify banned recipients.
    const recipSnap = await db.collection('players').doc(recipientUid).get();
    if (recipSnap.exists && recipSnap.data().accountStatus === 'banned') {
      return res.status(400).json({ ok: false, error: 'forbidden' });
    }

    const senderSnap = await db.collection('players').doc(uid).get();
    const senderName = senderSnap.exists ? (senderSnap.data().displayName || 'A traveler') : 'A traveler';

    const id = await createNotification(db, {
      uid: recipientUid,
      type: 'friend_request',
      title: 'New friend request',
      body: `${senderName} sent you a friend request.`,
      link: '/profile',
      relatedId: uid,
    });
    res.json({ ok: true, id });
  } catch (e) {
    console.error('POST /api/notifications/friend-request failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

/**
 * POST /api/notifications/veyra-push — send an FCM device push for a Veyra
 * private message. The message itself stays in Veyra (not in the bell).
 */
router.post('/notifications/veyra-push', async (req, res) => {
  try {
    const uid = req.uid;
    const chatId = String(req.body?.chatId || '').trim();
    const recipientUid = String(req.body?.recipientUid || '').trim();
    const text = String(req.body?.text || '').trim().slice(0, 120);
    if (!chatId || !recipientUid || recipientUid === uid || !text) {
      return res.status(400).json({ ok: false, error: 'bad_request' });
    }

    // Validate: chat exists, caller is a participant, recipient is the other one.
    const chatSnap = await db.collection('private_chats').doc(chatId).get();
    if (!chatSnap.exists) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    const participants = chatSnap.data().participants || [];
    if (!participants.includes(uid) || !participants.includes(recipientUid)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const senderSnap = await db.collection('players').doc(uid).get();
    const senderName = senderSnap.exists ? (senderSnap.data().displayName || 'A friend') : 'A friend';

    const result = await sendFcmToUser(db, USE_FAKE, getMessaging, recipientUid, {
      title: senderName,
      body: text,
      link: '/veyra',
    });
    res.json({ ok: true, sent: result.sent });
  } catch (e) {
    console.error('POST /api/notifications/veyra-push failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

/**
 * POST /api/notifications/fcm-token — register a device FCM token.
 */
router.post('/notifications/fcm-token', async (req, res) => {
  try {
    const uid = req.uid;
    const token = String(req.body?.token || '').trim();
    if (!token || token.length < 10 || token.length > 500) {
      return res.status(400).json({ ok: false, error: 'bad_token' });
    }
    const now = Date.now();
    const id = `${uid}_${Buffer.from(token).toString('base64url').slice(0, 40)}`;
    await db.collection('fcmTokens').doc(id).set({
      uid,
      token,
      platform: 'web',
      createdAt: now,
      updatedAt: now,
    }, { merge: true });
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/notifications/fcm-token failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

/**
 * DELETE /api/notifications/fcm-token — unregister a device token.
 */
router.delete('/notifications/fcm-token', async (req, res) => {
  try {
    const uid = req.uid;
    const token = String(req.body?.token || '').trim();
    if (!token) return res.status(400).json({ ok: false, error: 'bad_token' });
    const id = `${uid}_${Buffer.from(token).toString('base64url').slice(0, 40)}`;
    await db.collection('fcmTokens').doc(id).delete();
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/notifications/fcm-token failed:', e);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

module.exports = router;
