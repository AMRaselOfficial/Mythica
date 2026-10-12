'use strict';
/**
 * Notification system tests.
 *
 * Covers:
 * - createNotification validation and storage
 * - broadcastNotification fan-out (skips banned players)
 * - POST /api/notifications/friend-request (validates pending request)
 * - POST /api/admin/notifications/send (message + petal adjust)
 * - POST /api/admin/notifications/broadcast
 */
const test = require('node:test');
const assert = require('node:assert/strict');

require('./helpers');
const {
  db,
  resetFakeDb,
  startServer,
  post,
  seedPlayer,
} = require('./helpers');
const { createNotification, broadcastNotification } = require('../lib/notifications');

test('notifications: createNotification stores with read=false', async () => {
  resetFakeDb();
  await seedPlayer('u1');
  const id = await createNotification(db, {
    uid: 'u1', type: 'system_update', title: 'Hi', body: 'Hello',
  });
  const snap = await db.collection('notifications').doc(id).get();
  assert.equal(snap.exists, true);
  assert.equal(snap.data().read, false);
  assert.equal(snap.data().uid, 'u1');
});

test('notifications: createNotification rejects invalid type', async () => {
  resetFakeDb();
  await assert.rejects(
    createNotification(db, { uid: 'u1', type: 'nope', title: 'Hi', body: 'Hello' }),
    /bad_notification/
  );
});

test('notifications: broadcast skips banned players', async () => {
  resetFakeDb();
  await seedPlayer('u1');
  await seedPlayer('u2');
  await db.collection('players').doc('u3').set({
    displayName: 'u3', email: '', petals: 20,
    accountStatus: 'banned', createdAt: Date.now(),
  });
  const count = await broadcastNotification(db, true, {
    type: 'system_update', title: 'Update', body: 'Stuff happened',
  });
  assert.equal(count, 2);
  const all = db._listAll('notifications');
  const uids = all.map(({ data }) => data().uid).sort();
  assert.deepEqual(uids, ['u1', 'u2']);
});

test('notifications: broadcast rejects non-broadcast types', async () => {
  resetFakeDb();
  await assert.rejects(
    broadcastNotification(db, true, { type: 'admin_message', title: 'Hi', body: 'Hello' }),
    /bad_broadcast_type/
  );
});

test('notifications: friend-request creates notification for valid pending request', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('sender');
    await seedPlayer('recip');
    await db.collection('friendships').doc('recip_sender').set({
      users: ['recip', 'sender'],
      status: 'pending',
      requesterUid: 'sender',
      createdAt: Date.now(),
    });
    const res = await post(base, '/api/notifications/friend-request', 'sender', { recipientUid: 'recip' });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    const all = db._listAll('notifications');
    assert.equal(all.length, 1);
    assert.equal(all[0].data().type, 'friend_request');
    assert.equal(all[0].data().uid, 'recip');
  } finally {
    await close();
  }
});

test('notifications: friend-request rejects when no pending request', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('sender');
    await seedPlayer('recip');
    const res = await post(base, '/api/notifications/friend-request', 'sender', { recipientUid: 'recip' });
    assert.equal(res.status, 404);
  } finally {
    await close();
  }
});

test('notifications: friend-request rejects self', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('sender');
    const res = await post(base, '/api/notifications/friend-request', 'sender', { recipientUid: 'sender' });
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});

test('notifications: admin send deducts petals and notifies', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('target', 500);
    const res = await post(base, '/api/admin/notifications/send', 'admin-root', {
      uid: 'target', title: 'Deduction', body: 'Abuse', petalChange: -100,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.petalChange, -100);
    assert.equal(res.json.newBalance, 400);
    const player = await db.collection('players').doc('target').get();
    assert.equal(player.data().petals, 400);
    const notifs = db._listAll('notifications');
    assert.equal(notifs.length, 1);
    assert.equal(notifs[0].data().type, 'admin_message');
  } finally {
    await close();
  }
});

test('notifications: admin send clamps balance at zero', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('target', 50);
    const res = await post(base, '/api/admin/notifications/send', 'admin-root', {
      uid: 'target', title: 'Deduction', body: 'Abuse', petalChange: -100,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.newBalance, 0);
  } finally {
    await close();
  }
});

test('notifications: admin send requires admin', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('target');
    const res = await post(base, '/api/admin/notifications/send', 'target', {
      uid: 'target', title: 'Hi', body: 'Hello',
    });
    assert.equal(res.status, 403);
  } finally {
    await close();
  }
});

test('notifications: admin send 404 for unknown user', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    const res = await post(base, '/api/admin/notifications/send', 'admin-root', {
      uid: 'ghost', title: 'Hi', body: 'Hello',
    });
    assert.equal(res.status, 404);
  } finally {
    await close();
  }
});

test('notifications: admin broadcast reaches active players', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('u1');
    await seedPlayer('u2');
    const res = await post(base, '/api/admin/notifications/broadcast', 'admin-root', {
      title: 'Update', body: 'Hello all',
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.sent, 2);
  } finally {
    await close();
  }
});

test('notifications: admin broadcast requires title and body', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    const res = await post(base, '/api/admin/notifications/broadcast', 'admin-root', {
      title: '', body: 'Hello',
    });
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});

test('notifications: admin can list and delete notifications', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('u1');
    const id = await createNotification(db, {
      uid: 'u1', type: 'system_update', title: 'Hi', body: 'Hello',
    });

    // List
    const listRes = await fetch(base + '/api/admin/notifications', {
      headers: { Authorization: 'Bearer test-admin-root' },
    });
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    assert.equal(listJson.ok, true);
    assert.equal(listJson.notifications.length, 1);
    assert.equal(listJson.notifications[0].id, id);

    // Filter by type
    const filterRes = await fetch(base + '/api/admin/notifications?type=friend_request', {
      headers: { Authorization: 'Bearer test-admin-root' },
    });
    const filterJson = await filterRes.json();
    assert.equal(filterJson.notifications.length, 0);

    // Delete
    const delRes = await fetch(base + `/api/admin/notifications/${id}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer test-admin-root' },
    });
    assert.equal(delRes.status, 200);
    const remaining = db._listAll('notifications');
    assert.equal(remaining.length, 0);

    // Delete non-existent -> 404
    const del404 = await fetch(base + '/api/admin/notifications/nope', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer test-admin-root' },
    });
    assert.equal(del404.status, 404);
  } finally {
    await close();
  }
});

test('notifications: admin list/delete requires admin', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('u1');
    const listRes = await fetch(base + '/api/admin/notifications', {
      headers: { Authorization: 'Bearer test-u1' },
    });
    assert.equal(listRes.status, 403);
    const delRes = await fetch(base + '/api/admin/notifications/x', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer test-u1' },
    });
    assert.equal(delRes.status, 403);
  } finally {
    await close();
  }
});

test('notifications: admin can edit a notification', async () => {
  const { base, close } = await startServer();
  try {
    await resetFakeDb();
    await seedPlayer('u1');
    const id = await createNotification(db, {
      uid: 'u1', type: 'system_update', title: 'Old', body: 'Old body',
    });
    const res = await fetch(base + `/api/admin/notifications/${id}`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer test-admin-root', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New', body: 'New body' }),
    });
    assert.equal(res.status, 200);
    const snap = await db.collection('notifications').doc(id).get();
    assert.equal(snap.data().title, 'New');
    assert.equal(snap.data().body, 'New body');
  } finally {
    await close();
  }
});
