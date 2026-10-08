'use strict';
/**
 * Support ticket tests (player + admin flows).
 * Fake modes: USE_FAKE_DB=1 FAKE_AUTH=1 (set in ./helpers).
 * Admin tokens: `Bearer <redacted><uid>`; plain users: `Bearer <redacted><uid>`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

require('./helpers');
const {
  db,
  resetFakeDb,
  startServer,
  post,
  get,
  seedPlayer,
  authHeaders,
} = require('./helpers');

function adminHeaders(uid) {
  return { Authorization: `Bearer test-admin-${uid}`, 'Content-Type': 'application/json' };
}

async function adminPost(base, path, uid, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: adminHeaders(uid),
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function adminGet(base, path, uid) {
  const res = await fetch(base + path, { headers: adminHeaders(uid) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function seedPlayerWithContact(uid, displayName, email) {
  await seedPlayer(uid);
  await db.collection('players').doc(uid).update({ displayName, email });
}

test('support: create ticket stores server-side name/email, defaults to pending', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    await seedPlayerWithContact('u1', 'Rasel', 'rasel@example.com');
    const r = await post(base, '/api/support', 'u1', {
      title: 'Hunt stuck',
      description: 'My hunt never finishes.',
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    const t = r.json.ticket;
    assert.match(t.ticketId, /^SUP-[A-Z0-9]{6}$/);
    assert.equal(t.title, 'Hunt stuck');
    assert.equal(t.status, 'pending');
    assert.deepEqual(t.messages, []);

    // Name/email came from the player doc, not the request.
    const snap = await db.collection('supportTickets').doc(t.ticketId).get();
    assert.equal(snap.data().displayName, 'Rasel');
    assert.equal(snap.data().email, 'rasel@example.com');
    assert.equal(snap.data().unreadByAdmin, true);
  } finally {
    await close();
  }
});

test('support: validation rejects empty/oversized title and description', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    await seedPlayer('u1');
    let r = await post(base, '/api/support', 'u1', { title: '', description: 'x' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'bad_title');

    r = await post(base, '/api/support', 'u1', { title: 't', description: '' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'bad_description');

    r = await post(base, '/api/support', 'u1', { title: 't'.repeat(121), description: 'x' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'bad_title');
  } finally {
    await close();
  }
});

test('support: mine lists only the caller tickets, newest first', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    await seedPlayer('u1');
    await seedPlayer('u2');
    await post(base, '/api/support', 'u1', { title: 'one', description: 'd1' });
    await post(base, '/api/support', 'u2', { title: 'other', description: 'd2' });
    await post(base, '/api/support', 'u1', { title: 'two', description: 'd3' });

    const r = await get(base, '/api/support/mine', authHeaders('u1'));
    assert.equal(r.status, 200);
    assert.equal(r.json.tickets.length, 2);
    assert.equal(r.json.tickets[0].title, 'two');
    assert.equal(r.json.tickets[1].title, 'one');
  } finally {
    await close();
  }
});

test('support: user reply appends to thread and flags admin; forbidden for others', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    await seedPlayer('u1');
    await seedPlayer('u2');
    const created = await post(base, '/api/support', 'u1', { title: 't', description: 'd' });
    const id = created.json.ticket.ticketId;

    const r = await post(base, `/api/support/${id}/reply`, 'u1', { text: 'More details here.' });
    assert.equal(r.status, 200);
    assert.equal(r.json.ticket.messages.length, 1);
    assert.equal(r.json.ticket.messages[0].sender, 'user');
    assert.equal(r.json.ticket.messages[0].text, 'More details here.');

    const snap = await db.collection('supportTickets').doc(id).get();
    assert.equal(snap.data().unreadByAdmin, true);

    // Another user cannot reply to someone else's ticket.
    const r2 = await post(base, `/api/support/${id}/reply`, 'u2', { text: 'hijack' });
    assert.equal(r2.status, 403);
    assert.equal(r2.json.error, 'forbidden');

    // Empty text rejected.
    const r3 = await post(base, `/api/support/${id}/reply`, 'u1', { text: '  ' });
    assert.equal(r3.status, 400);
    assert.equal(r3.json.error, 'bad_text');
  } finally {
    await close();
  }
});

test('support: admin list/reply/status/read flow', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    await seedPlayerWithContact('u1', 'Rasel', 'rasel@example.com');
    const created = await post(base, '/api/support', 'u1', { title: 'help', description: 'stuck' });
    const id = created.json.ticket.ticketId;

    // Non-admin cannot use admin endpoints.
    let r = await get(base, '/api/admin/support', authHeaders('u1'));
    assert.equal(r.status, 403);

    // Admin list shows the ticket with unread flag.
    r = await adminGet(base, '/api/admin/support', 'admin1');
    assert.equal(r.status, 200);
    assert.equal(r.json.tickets.length, 1);
    assert.equal(r.json.tickets[0].ticketId, id);
    assert.equal(r.json.tickets[0].displayName, 'Rasel');
    assert.equal(r.json.tickets[0].email, 'rasel@example.com');
    assert.equal(r.json.unreadCount, 1);

    // Admin reply clears unreadByAdmin, sets unreadByUser.
    r = await adminPost(base, `/api/admin/support/${id}/reply`, 'admin1', { text: 'What device?' });
    assert.equal(r.status, 200);
    assert.equal(r.json.ticket.messages.length, 1);
    assert.equal(r.json.ticket.messages[0].sender, 'admin');
    let snap = await db.collection('supportTickets').doc(id).get();
    assert.equal(snap.data().unreadByAdmin, false);
    assert.equal(snap.data().unreadByUser, true);

    // Status change.
    r = await adminPost(base, `/api/admin/support/${id}/status`, 'admin1', { status: 'checking' });
    assert.equal(r.status, 200);
    assert.equal(r.json.ticket.status, 'checking');

    r = await adminPost(base, `/api/admin/support/${id}/status`, 'admin1', { status: 'bogus' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'bad_status');

    // Filter by status.
    r = await adminGet(base, '/api/admin/support?status=checking', 'admin1');
    assert.equal(r.json.tickets.length, 1);
    r = await adminGet(base, '/api/admin/support?status=solved', 'admin1');
    assert.equal(r.json.tickets.length, 0);

    // User marks read; user reply re-flags admin.
    await post(base, `/api/support/${id}/read`, 'u1', {});
    snap = await db.collection('supportTickets').doc(id).get();
    assert.equal(snap.data().unreadByUser, false);

    await post(base, `/api/support/${id}/reply`, 'u1', { text: 'Android phone.' });
    snap = await db.collection('supportTickets').doc(id).get();
    assert.equal(snap.data().unreadByAdmin, true);

    // Admin read clears the flag.
    r = await adminPost(base, `/api/admin/support/${id}/read`, 'admin1', {});
    assert.equal(r.status, 200);
    snap = await db.collection('supportTickets').doc(id).get();
    assert.equal(snap.data().unreadByAdmin, false);

    // 404 for unknown ticket.
    r = await adminGet(base, '/api/admin/support/SUP-NOPE00', 'admin1');
    assert.equal(r.status, 404);
  } finally {
    await close();
  }
});

test('support: unauthenticated requests are rejected', async () => {
  resetFakeDb();
  const { base, close } = await startServer();
  try {
    const res = await fetch(base + '/api/support/mine');
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});
