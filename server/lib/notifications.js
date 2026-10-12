'use strict';
/**
 * Notification helpers — create in-app notifications and send FCM pushes.
 *
 * In-app notifications live in the `notifications` collection (server-written,
 * user-readable via Firestore rules). The game client subscribes in real time
 * via onSnapshot for the bell icon.
 *
 * Types:
 *   friend_request — someone sent you a friend request
 *   friend_accepted — someone accepted your friend request
 *   admin_message — direct message from an admin (e.g., petal deduction notice)
 *   event_update — new or updated event
 *   support_reply — admin replied to your support ticket
 *   system_update — broadcast from admin to all players
 *
 * Veyra private messages do NOT create bell notifications — they trigger
 * FCM device pushes only (via sendVeyraPush), and appear in Veyra in-app.
 */

const NOTIFICATION_TYPES = [
  'friend_request',
  'friend_accepted',
  'admin_message',
  'event_update',
  'support_reply',
  'system_update',
];

/**
 * Create a single notification for a user.
 * Returns the new doc ID.
 */
async function createNotification(db, { uid, type, title, body, link = '', relatedId = '' }) {
  if (!uid || !NOTIFICATION_TYPES.includes(type)) {
    throw new Error('bad_notification');
  }
  const now = Date.now();
  const ref = db.collection('notifications').doc();
  await ref.set({
    uid,
    type,
    title: String(title || '').slice(0, 120),
    body: String(body || '').slice(0, 500),
    link: String(link || '').slice(0, 200),
    relatedId: String(relatedId || '').slice(0, 100),
    read: false,
    createdAt: now,
  });
  return ref.id;
}

/**
 * Broadcast a notification to all active (non-banned) players.
 * Fans out individual docs so each user gets their own read state.
 */
async function broadcastNotification(db, useFake, { type, title, body, link = '', relatedId = '' }) {
  if (!['event_update', 'system_update'].includes(type)) {
    throw new Error('bad_broadcast_type');
  }
  const now = Date.now();
  const titleClean = String(title || '').slice(0, 120);
  const bodyClean = String(body || '').slice(0, 500);

  // Get all active player UIDs.
  let uids;
  if (useFake) {
    uids = db._listAll('players')
      .filter(({ data }) => (data().accountStatus || 'active') !== 'banned')
      .map(({ id }) => id);
  } else {
    const snap = await db.collection('players').select().get();
    uids = [];
    snap.forEach((d) => {
      const data = d.data();
      if ((data.accountStatus || 'active') !== 'banned') uids.push(d.id);
    });
  }

  // Batch writes (500 per batch).
  const batchSize = 450;
  for (let i = 0; i < uids.length; i += batchSize) {
    const chunk = uids.slice(i, i + batchSize);
    if (useFake) {
      for (const uid of chunk) {
        const ref = db.collection('notifications').doc();
        await ref.set({
          uid, type, title: titleClean, body: bodyClean,
          link: String(link || '').slice(0, 200),
          relatedId: String(relatedId || '').slice(0, 100),
          read: false, createdAt: now,
        });
      }
    } else {
      const batch = db.batch();
      for (const uid of chunk) {
        const ref = db.collection('notifications').doc();
        batch.set(ref, {
          uid, type, title: titleClean, body: bodyClean,
          link: String(link || '').slice(0, 200),
          relatedId: String(relatedId || '').slice(0, 100),
          read: false, createdAt: now,
        });
      }
      await batch.commit();
    }
  }
  return uids.length;
}

/**
 * Send an FCM push to all of a user's registered device tokens.
 * `getMessaging` is injected so tests can stub it.
 */
async function sendFcmToUser(db, useFake, getMessaging, uid, { title, body, link = '' }) {
  let tokens;
  if (useFake) {
    tokens = db._listAll('fcmTokens')
      .filter(({ data }) => data().uid === uid)
      .map(({ data }) => data().token)
      .filter(Boolean);
  } else {
    const snap = await db.collection('fcmTokens').where('uid', '==', uid).get();
    tokens = snap.docs.map((d) => d.data().token).filter(Boolean);
  }
  if (!tokens.length) return { sent: 0 };

  const messaging = getMessaging();
  const message = {
    notification: {
      title: String(title || '').slice(0, 100),
      body: String(body || '').slice(0, 200),
    },
    data: {
      link: String(link || ''),
      type: 'veyra_message',
    },
    tokens,
  };
  const resp = await messaging.sendEachForMulticast(message);

  // Clean up invalid tokens.
  if (resp && Array.isArray(resp.responses)) {
    const badTokens = [];
    resp.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error && r.error.code;
        if (code === 'messaging/invalid-registration-token' || code === 'messaging/registration-token-not-registered') {
          badTokens.push(tokens[i]);
        }
      }
    });
    for (const t of badTokens) {
      if (useFake) {
        const all = db._listAll('fcmTokens');
        for (const { id, data } of all) {
          if (data().token === t) await db.collection('fcmTokens').doc(id).delete();
        }
      } else {
        const snap = await db.collection('fcmTokens').where('token', '==', t).get();
        const batch = db.batch();
        snap.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }
  }
  return { sent: resp ? resp.successCount || 0 : 0 };
}

module.exports = {
  NOTIFICATION_TYPES,
  createNotification,
  broadcastNotification,
  sendFcmToUser,
};
