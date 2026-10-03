'use strict';
/**
 * Player event routes.
 *
 * GET  /api/events            list events with the caller's join/progress state
 * POST /api/events/:id/join   join a live event
 * POST /api/events/:id/claim  claim the reward once progress reaches the goal
 *
 * Progress:
 *   hunt_count    — bumped server-side after each successful hunt (routes/hunt.js)
 *   invite_friends — counted live from accepted friendships the player requested
 *   minigame      — scored by the mini-game endpoint (coming later)
 *
 * Error codes: not_found, not_live, already_joined, not_joined, ended,
 *   incomplete, already_claimed, minigame_unavailable
 */
const express = require('express');
const { db, USE_FAKE } = require('../lib/db');
const { prepareItemGrants, applyRewardWrites } = require('../lib/rewards');
const { logActivity } = require('../lib/activity');
const {
  eventJoinId,
  isLive,
  publicEvent,
  countInvites,
  listCollection,
  whereEquals,
  txWhereEquals,
} = require('../lib/events');

const router = express.Router();

/** Merge the caller's join docs onto the event list. */
router.get('/events', async (req, res) => {
  const uid = req.uid;
  try {
    const rows = await listCollection(db, USE_FAKE, 'events');
    const events = [];
    for (const { id, data } of rows) events.push(publicEvent(id, data));
    events.sort((a, b) => (b.startAt || 0) - (a.startAt || 0));

    // Load the caller's joins in one query.
    const joinRows = await whereEquals(db, USE_FAKE, 'eventJoins', 'uid', uid);
    const joins = {};
    for (const r of joinRows) joins[r.data.eventId] = r.data;

    // Refresh invite-friends progress live (friendships change outside events).
    const now = Date.now();
    for (const ev of events) {
      const j = joins[ev.id];
      if (j && ev.type === 'invite_friends' && !j.claimed) {
        try {
          const invites = await countInvites(db, USE_FAKE, uid);
          if (invites !== (j.progress || 0)) {
            const update = { progress: invites };
            if (!j.completed && invites >= ev.goal) {
              update.completed = true;
              update.completedAt = now;
            }
            await db.collection('eventJoins').doc(eventJoinId(ev.id, uid)).update(update);
            j.progress = invites;
            if (update.completed) {
              j.completed = true;
              j.completedAt = now;
            }
          }
        } catch (e) {
          console.error('event invite sync failed:', e && e.message);
        }
      }
      ev.joined = !!j;
      ev.progress = j ? j.progress || 0 : 0;
      ev.completed = !!(j && j.completed);
      ev.claimed = !!(j && j.claimed);
    }

    return res.json({ ok: true, events });
  } catch (e) {
    console.error('GET /api/events failed:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.post('/events/:id/join', async (req, res) => {
  const uid = req.uid;
  const eventId = String(req.params.id || '').slice(0, 80);
  try {
    const now = Date.now();
    const eventRef = db.collection('events').doc(eventId);
    const joinRef = db.collection('eventJoins').doc(eventJoinId(eventId, uid));

    const [eventSnap, joinSnap, playerSnap] = await Promise.all([
      eventRef.get(),
      joinRef.get(),
      db.collection('players').doc(uid).get(),
    ]);
    if (!eventSnap.exists) return res.status(404).json({ ok: false, error: 'not_found' });
    const ev = publicEvent(eventId, eventSnap.data());
    if (!isLive(eventSnap.data(), now))
      return res.status(400).json({ ok: false, error: 'not_live' });
    if (joinSnap.exists) return res.status(400).json({ ok: false, error: 'already_joined' });

    const player = playerSnap.exists ? playerSnap.data() : {};
    let progress = 0;
    if (ev.type === 'invite_friends') {
      try {
        progress = await countInvites(db, USE_FAKE, uid);
      } catch (e) {
        console.error('event join invite count failed:', e && e.message);
      }
    }

    await joinRef.set({
      eventId,
      uid,
      displayName: player.displayName || 'Traveler',
      eventType: ev.type,
      joinedAt: now,
      progress,
      completed: progress >= ev.goal,
      completedAt: progress >= ev.goal ? now : null,
      claimed: false,
      claimedAt: null,
    });

    try {
      await logActivity(db, { uid, type: 'event_join', details: { eventId, title: ev.title } });
    } catch (e) {
      console.error('event join activity log failed:', e && e.message);
    }
    return res.json({ ok: true, joined: true, progress });
  } catch (e) {
    console.error('POST /api/events/:id/join failed:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

router.post('/events/:id/claim', async (req, res) => {
  const uid = req.uid;
  const eventId = String(req.params.id || '').slice(0, 80);
  try {
    const out = await db.runTransaction(async (tx) => {
      const now = Date.now();
      const eventRef = db.collection('events').doc(eventId);
      const joinRef = db.collection('eventJoins').doc(eventJoinId(eventId, uid));
      const playerRef = db.collection('players').doc(uid);

      const eventSnap = await tx.get(eventRef);
      const joinSnap = await tx.get(joinRef);
      const playerSnap = await tx.get(playerRef);

      if (!eventSnap.exists) return { error: 'not_found' };
      if (!joinSnap.exists) return { error: 'not_joined' };
      const ev = publicEvent(eventId, eventSnap.data());
      const join = joinSnap.data();
      if (join.claimed) return { error: 'already_claimed' };
      if (ev.type === 'minigame') return { error: 'minigame_unavailable' };
      if (!playerSnap.exists) return { error: 'not_found' };

      // Recompute invite progress inside the transaction for correctness.
      let progress = join.progress || 0;
      if (ev.type === 'invite_friends') {
        const rows = await txWhereEquals(db, tx, USE_FAKE, 'friendships', 'requesterUid', uid);
        progress = 0;
        for (const r of rows) if (r.data.status === 'accepted') progress += 1;
      }
      if (progress < ev.goal) return { error: 'incomplete', progress, goal: ev.goal };

      const player = playerSnap.data();
      const invReads = await prepareItemGrants(db, tx, uid, ev.rewards.items);

      // ---- Writes only from this point on. ----
      const rewards = applyRewardWrites(db, tx, {
        uid,
        player,
        petals: ev.rewards.petals,
        xp: ev.rewards.xp,
        invReads,
        now,
      });

      tx.update(joinRef, {
        progress,
        completed: true,
        completedAt: join.completedAt || now,
        claimed: true,
        claimedAt: now,
      });

      return { ok: true, rewards };
    });

    if (out.error) {
      const status = out.error === 'not_found' ? 404 : 400;
      return res.status(status).json({ ok: false, error: out.error });
    }
    try {
      await logActivity(db, {
        uid,
        type: 'event_claim',
        details: { eventId, rewards: out.rewards },
      });
    } catch (e) {
      console.error('event claim activity log failed:', e && e.message);
    }
    return res.json(out);
  } catch (e) {
    console.error('POST /api/events/:id/claim failed:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

module.exports = router;
