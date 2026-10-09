'use strict';
/**
 * Shared event helpers for player routes and the admin event manager.
 *
 * Event doc (collection `events`, id = slug):
 *   title, description, banner (https URL or "assets/..." path),
 *   startAt/endAt (epoch ms), active, featured,
 *   type: 'hunt_count' | 'invite_friends' | 'minigame',
 *   goal (number), rewards { petals, xp, items: [{itemId, quantity}] },
 *   createdAt, updatedAt, createdBy
 *
 * Join doc (collection `eventJoins`, id `${eventId}_${uid}`):
 *   eventId, uid, displayName, eventType (denormalized), joinedAt,
 *   progress, completed, completedAt, claimed, claimedAt
 */
const EVENT_TYPES = ['hunt_count', 'invite_friends', 'minigame'];

const TYPE_LABELS = {
  hunt_count: 'Hunt challenge',
  invite_friends: 'Invite friends',
  minigame: 'Mini-game',
};

const MEDAL_TIERS = ['gold', 'silver', 'bronze'];

const DEFAULT_MEDAL_NAMES = {
  gold: 'Champion',
  silver: 'Runner-up',
  bronze: 'Third Place',
};

const TIER_LABELS = {
  gold: 'Gold',
  silver: 'Silver',
  bronze: 'Bronze',
};

function eventJoinId(eventId, uid) {
  return `${eventId}_${uid}`;
}

/** Medal grant doc id inside players/{uid}/medals. */
function medalGrantId(eventId, medalIndex) {
  return `${eventId}_${medalIndex}`;
}

/** Normalize a Firestore Timestamp / Date / epoch ms to epoch ms. */
function toMillis(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return 0;
}

/** An event is joinable/playable when active and inside its date window. */
function isLive(ev, now = Date.now()) {
  if (!ev || ev.active === false) return false;
  const start = toMillis(ev.startAt);
  const end = toMillis(ev.endAt);
  if (start && now < start) return false;
  if (end && now > end) return false;
  return true;
}

function hasEnded(ev, now = Date.now()) {
  const end = toMillis(ev.endAt);
  return !!end && now > end;
}

/** Sanitize rewards input from admin/user payloads. */
function sanitizeRewards(raw) {
  const r = raw || {};
  const items = Array.isArray(r.items)
    ? r.items
        .map((it) => ({
          itemId: String((it && it.itemId) || '').trim(),
          quantity: Math.max(0, Math.floor(Number((it && it.quantity) || 0))),
        }))
        .filter((it) => it.itemId && it.quantity > 0)
    : [];
  return {
    petals: Math.max(0, Math.floor(Number(r.petals) || 0)),
    xp: Math.max(0, Math.floor(Number(r.xp) || 0)),
    items,
  };
}

/** Sanitize the 0–3 medal definitions attached to an event. */
function sanitizeMedals(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw.slice(0, 3)) {
    const tier = String((m && m.tier) || '').toLowerCase();
    const finalTier = MEDAL_TIERS.includes(tier) ? tier : MEDAL_TIERS[out.length] || 'bronze';
    const name = String((m && m.name) || '').trim().slice(0, 40) || DEFAULT_MEDAL_NAMES[finalTier];
    out.push({ name, tier: finalTier });
  }
  return out;
}

/** Validate + normalize an event payload for create/update. Returns { event } or { error }. */
function normalizeEventInput(body) {
  const title = String((body && body.title) || '').trim().slice(0, 80);
  if (!title) return { error: 'title_required' };
  const type = String((body && body.type) || 'hunt_count');
  if (!EVENT_TYPES.includes(type)) return { error: 'invalid_type' };
  const goal = Math.max(1, Math.floor(Number((body && body.goal) || 0)));
  if (!goal) return { error: 'goal_required' };

  const startAt = toMillis((body && body.startAt) ?? 0) || Date.now();
  const endAt = toMillis((body && body.endAt) ?? 0) || startAt + 7 * 24 * 3600 * 1000;
  if (endAt <= startAt) return { error: 'invalid_dates' };

  return {
    event: {
      title,
      description: String((body && body.description) || '').trim().slice(0, 2000),
      banner: String((body && body.banner) || '').trim().slice(0, 500),
      startAt,
      endAt,
      active: (body && body.active) !== false,
      featured: !!(body && body.featured),
      type,
      goal,
      rewards: sanitizeRewards(body && body.rewards),
      medals: sanitizeMedals(body && body.medals),
    },
  };
}

/** Client-safe shape of an event doc. */
function publicEvent(id, data) {
  return {
    id,
    title: data.title || 'Untitled event',
    description: data.description || '',
    banner: data.banner || '',
    startAt: toMillis(data.startAt),
    endAt: toMillis(data.endAt),
    active: data.active !== false,
    featured: !!data.featured,
    type: EVENT_TYPES.includes(data.type) ? data.type : 'hunt_count',
    typeLabel: TYPE_LABELS[data.type] || TYPE_LABELS.hunt_count,
    goal: Math.max(1, Math.floor(Number(data.goal) || 1)),
    rewards: sanitizeRewards(data.rewards),
    medals: sanitizeMedals(data.medals),
    live: isLive(data),
    ended: hasEnded(data),
  };
}

/**
 * Count accepted friendships where `uid` was the requester (inviter).
 * Single-field query + in-code filter to avoid a composite index.
 */
async function countInvites(db, useFake, uid) {
  const rows = await whereEquals(db, useFake, 'friendships', 'requesterUid', uid);
  let n = 0;
  for (const r of rows) if (r.data.status === 'accepted') n += 1;
  return n;
}

/**
 * List all docs directly under a collection. Works in real + fake mode.
 * Returns [{ id, data }].
 */
async function listCollection(db, useFake, collPath) {
  if (useFake) {
    return db
      ._listAll(collPath)
      .map(({ id, data }) => ({ id, data: data() }));
  }
  const snap = await db.collection(collPath).get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

/**
 * List docs where field == value. Works in real Firestore and the fake DB.
 * Returns [{ id, data }].
 */
async function whereEquals(db, useFake, collPath, field, value) {
  if (useFake) {
    return db
      ._listAll(collPath)
      .filter(({ data }) => data()[field] === value)
      .map(({ id, data }) => ({ id, data: data() }));
  }
  const snap = await db.collection(collPath).where(field, '==', value).get();
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

/** whereEquals inside a transaction (real mode runs the query through tx). */
async function txWhereEquals(db, tx, useFake, collPath, field, value) {
  if (useFake) {
    return db
      ._listAll(collPath)
      .filter(({ data }) => data()[field] === value)
      .map(({ id, data }) => ({ id, data: data() }));
  }
  const snap = await tx.get(db.collection(collPath).where(field, '==', value));
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

/**
 * Best-effort progress bump after a successful hunt: +1 on every joined,
 * live hunt_count event the player hasn't finished. Hunts have a cooldown,
 * so read-then-write races are not a concern; the claim endpoint re-validates
 * progress transactionally anyway.
 */
async function bumpHuntEventProgress(db, useFake, uid) {
  const now = Date.now();
  try {
    const joins = await whereEquals(db, useFake, 'eventJoins', 'uid', uid);
    for (const { id, data } of joins) {
      if (data.eventType !== 'hunt_count' || data.completed || data.claimed) continue;
      const esnap = await db.collection('events').doc(data.eventId).get();
      if (!esnap.exists || !isLive(esnap.data(), now)) continue;
      const goal = Math.max(1, Math.floor(Number(esnap.data().goal) || 1));
      const progress = (data.progress || 0) + 1;
      const update = { progress };
      if (progress >= goal) {
        update.completed = true;
        update.completedAt = now;
      }
      await db.collection('eventJoins').doc(id).update(update);
    }
  } catch (e) {
    console.error('bumpHuntEventProgress failed:', e && e.message);
  }
}

module.exports = {
  EVENT_TYPES,
  TYPE_LABELS,
  MEDAL_TIERS,
  DEFAULT_MEDAL_NAMES,
  TIER_LABELS,
  eventJoinId,
  medalGrantId,
  toMillis,
  isLive,
  hasEnded,
  sanitizeRewards,
  sanitizeMedals,
  normalizeEventInput,
  publicEvent,
  countInvites,
  listCollection,
  whereEquals,
  txWhereEquals,
  bumpHuntEventProgress,
};
