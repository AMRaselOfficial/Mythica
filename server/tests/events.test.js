'use strict';
/**
 * Event system tests: admin CRUD, player join/progress/claim, hunt hook,
 * invite counting. Fake modes: USE_FAKE_DB=1 FAKE_AUTH=1 (set in ./helpers).
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
  getPlayer,
  getInvQty,
} = require('./helpers');
const { bumpHuntEventProgress } = require('../lib/events');

const ADMIN = 'admin-1';
function adminHeaders(uid) {
  return { Authorization: 'Bearer ' + 'test' + '-admin-' + uid, 'Content-Type': 'application/json' };
}
async function adminReq(base, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: adminHeaders(ADMIN),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

function eventPayload(over = {}) {
  const now = Date.now();
  return {
    title: 'Test Hunt Fest',
    description: 'Hunt a bunch',
    banner: 'assets/events/test.webp',
    startAt: now - 1000,
    endAt: now + 7 * 24 * 3600 * 1000,
    type: 'hunt_count',
    goal: 3,
    rewards: { petals: 50, xp: 25, items: [{ itemId: 'ember-fox', quantity: 1 }] },
    active: true,
    featured: false,
    ...over,
  };
}

async function createEvent(base, over = {}) {
  return adminReq(base, 'POST', '/api/admin/events', eventPayload(over));
}

/* ------------------------------ admin CRUD ------------------------------ */

test('admin: create event, validation rejects bad input', async () => {
  const { base, close } = await startServer();
  try {
    resetFakeDb();
    let r = await createEvent(base);
    assert.equal(r.status, 200);
    assert.ok(r.json.id);
    assert.equal(r.json.event.title, 'Test Hunt Fest');
    assert.equal(r.json.event.goal, 3);

    r = await adminReq(base, 'POST', '/api/admin/events', eventPayload({ title: '' }));
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'title_required');

    r = await adminReq(base, 'POST', '/api/admin/events', eventPayload({ type: 'bogus' }));
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'invalid_type');

    r = await adminReq(base, 'POST', '/api/admin/events',
      eventPayload({ startAt: Date.now() + 5000, endAt: Date.now() + 1000 }));
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'invalid_dates');
  } finally {
    await close();
  }
});

test('admin: list shows join counts, patch toggles active, delete removes joins', async () => {
  const { base, close } = await startServer();
  try {
    resetFakeDb();
    await seedPlayer('u1');
    const created = await createEvent(base);
    const id = created.json.id;

    let r = await post(base, `/api/events/${id}/join`, 'u1', {});
    assert.equal(r.status, 200);

    r = await adminReq(base, 'GET', '/api/admin/events');
    assert.equal(r.status, 200);
    const ev = r.json.events.find((e) => e.id === id);
    assert.equal(ev.joinCount, 1);
    assert.equal(ev.completedCount, 0);

    r = await adminReq(base, 'PATCH', `/api/admin/events/${id}`, { active: false });
    assert.equal(r.status, 200);
    assert.equal(r.json.event.active, false);

    r = await adminReq(base, 'DELETE', `/api/admin/events/${id}`);
    assert.equal(r.status, 200);
    const joins = db._listAll('eventJoins');
    assert.equal(joins.length, 0);

    r = await adminReq(base, 'GET', '/api/admin/events');
    assert.ok(!r.json.events.find((e) => e.id === id));
  } finally {
    await close();
  }
});

/* --------------------------- player join/claim --------------------------- */

test('player: join -> progress via hunt hook -> claim grants rewards', async () => {
  const { base, close } = await startServer();
  try {
    resetFakeDb();
    await seedPlayer('hunter1', 20);
    const created = await createEvent(base, { goal: 2 });
    const id = created.json.id;

    // Join
    let r = await post(base, `/api/events/${id}/join`, 'hunter1', {});
    assert.equal(r.status, 200);
    assert.equal(r.json.joined, true);

    // Double join rejected
    r = await post(base, `/api/events/${id}/join`, 'hunter1', {});
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'already_joined');

    // Claim too early
    r = await post(base, `/api/events/${id}/claim`, 'hunter1', {});
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'incomplete');

    // Simulate 2 hunts via the progress hook
    await bumpHuntEventProgress(db, true, 'hunter1');
    await bumpHuntEventProgress(db, true, 'hunter1');

    // List shows progress + completed
    r = await get(base, '/api/events', { Authorization: 'Bearer ' + 'test-hunter1' });
    const ev = r.json.events.find((e) => e.id === id);
    assert.equal(ev.joined, true);
    assert.equal(ev.progress, 2);
    assert.equal(ev.completed, true);

    // Claim grants petals/xp/items
    r = await post(base, `/api/events/${id}/claim`, 'hunter1', {});
    assert.equal(r.status, 200);
    assert.equal(r.json.rewards.petals, 50);
    assert.equal(r.json.rewards.xp, 25);
    assert.equal(r.json.rewards.items[0].itemId, 'ember-fox');
    const p = await getPlayer('hunter1');
    assert.equal(p.petals, 70);
    assert.equal(await getInvQty('hunter1', 'ember-fox'), 1);

    // Double claim rejected
    r = await post(base, `/api/events/${id}/claim`, 'hunter1', {});
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'already_claimed');
  } finally {
    await close();
  }
});

test('player: cannot join inactive or ended event', async () => {
  const { base, close } = await startServer();
  try {
    resetFakeDb();
    await seedPlayer('u2');
    const now = Date.now();

    let created = await createEvent(base, { active: false });
    let r = await post(base, `/api/events/${created.json.id}/join`, 'u2', {});
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'not_live');

    created = await createEvent(base, { startAt: now - 20000, endAt: now - 10000 });
    r = await post(base, `/api/events/${created.json.id}/join`, 'u2', {});
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'not_live');

    r = await post(base, '/api/events/nope/join', 'u2', {});
    assert.equal(r.status, 404);
  } finally {
    await close();
  }
});

/* ------------------------------ invite type ------------------------------ */

test('invite_friends: join seeds progress from friendships, claim works', async () => {
  const { base, close } = await startServer();
  try {
    resetFakeDb();
    await seedPlayer('inviter');
    await seedPlayer('friend1');
    await seedPlayer('friend2');
    // Two accepted friendships requested by inviter.
    const now = Date.now();
    await db.collection('friendships').doc('friend1_inviter').set({
      users: ['friend1', 'inviter'], status: 'accepted', requesterUid: 'inviter',
      createdAt: now, updatedAt: now,
    });
    await db.collection('friendships').doc('friend2_inviter').set({
      users: ['friend2', 'inviter'], status: 'accepted', requesterUid: 'inviter',
      createdAt: now, updatedAt: now,
    });

    const created = await createEvent(base, { type: 'invite_friends', goal: 2, title: 'Invite Fest' });
    const id = created.json.id;

    const r = await post(base, `/api/events/${id}/join`, 'inviter', {});
    assert.equal(r.status, 200);
    assert.equal(r.json.progress, 2);

    const c = await post(base, `/api/events/${id}/claim`, 'inviter', {});
    assert.equal(c.status, 200);
    assert.equal(c.json.rewards.petals, 50);
  } finally {
    await close();
  }
});

/* --------------------------- admin joins detail --------------------------- */

test('admin: event joins detail shows participants and stats', async () => {
  const { base, close } = await startServer();
  try {
    resetFakeDb();
    await seedPlayer('p1');
    await seedPlayer('p2');
    const created = await createEvent(base, { goal: 1 });
    const id = created.json.id;

    await post(base, `/api/events/${id}/join`, 'p1', {});
    await post(base, `/api/events/${id}/join`, 'p2', {});
    await bumpHuntEventProgress(db, true, 'p1');
    await post(base, `/api/events/${id}/claim`, 'p1', {});

    const r = await adminReq(base, 'GET', `/api/admin/events/${id}/joins`);
    assert.equal(r.status, 200);
    assert.equal(r.json.stats.joined, 2);
    assert.equal(r.json.stats.completed, 1);
    assert.equal(r.json.stats.claimed, 1);
    assert.equal(r.json.joins.length, 2);
    const p1 = r.json.joins.find((j) => j.uid === 'p1');
    assert.equal(p1.progress, 1);
    assert.equal(p1.claimed, true);
  } finally {
    await close();
  }
});
