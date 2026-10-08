'use strict';
/**
 * Player support-ticket routes.
 *
 * POST /api/support                 create a ticket {title, description}
 * GET  /api/support/mine            list the caller's tickets (newest first)
 * POST /api/support/:ticketId/reply add a message to the caller's ticket {text}
 * POST /api/support/:ticketId/read  mark the caller's ticket as read
 *
 * Name/email are taken server-side from the player's account document —
 * the client never supplies them. Tickets are server-managed; Firestore
 * rules deny direct client access (see firestore.rules).
 *
 * Error codes: bad_title, bad_description, bad_text, not_found, forbidden
 */
const express = require('express');
const { db, USE_FAKE } = require('../lib/db');
const { whereEquals } = require('../lib/events');

const router = express.Router();

const STATUSES = ['pending', 'checking', 'solved'];
const ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no ambiguous chars

function newTicketId() {
  let s = '';
  for (let i = 0; i < 6; i++) s += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  return `SUP-${s}`;
}

function toMillis(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return 0;
}

function publicTicket(id, d) {
  return {
    ticketId: id,
    title: d.title || '',
    description: d.description || '',
    status: d.status || 'pending',
    unreadByUser: !!d.unreadByUser,
    createdAt: toMillis(d.createdAt),
    updatedAt: toMillis(d.updatedAt),
    messages: (d.messages || []).map((m) => ({
      sender: m.sender,
      text: m.text,
      createdAt: toMillis(m.createdAt),
    })),
  };
}

async function getPlayer(uid) {
  const snap = await db.collection('players').doc(uid).get();
  return snap.exists ? snap.data() : null;
}

async function getOwnTicket(ticketId, uid) {
  const snap = await db.collection('supportTickets').doc(ticketId).get();
  if (!snap.exists) return { error: 'not_found' };
  const d = snap.data();
  if (d.uid !== uid) return { error: 'forbidden' };
  return { ref: snap.ref, data: d };
}

/** Create a support ticket. */
router.post('/support', async (req, res) => {
  const uid = req.uid;
  try {
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    if (!title || title.length > 120) {
      return res.status(400).json({ ok: false, error: 'bad_title' });
    }
    if (!description || description.length > 2000) {
      return res.status(400).json({ ok: false, error: 'bad_description' });
    }
    const player = await getPlayer(uid);
    const now = Date.now();

    // Generate a collision-free ticket id.
    let ticketId = null;
    for (let i = 0; i < 5 && !ticketId; i++) {
      const candidate = newTicketId();
      const existing = await db.collection('supportTickets').doc(candidate).get();
      if (!existing.exists) ticketId = candidate;
    }
    if (!ticketId) return res.status(500).json({ ok: false, error: 'internal' });

    const doc = {
      ticketId,
      uid,
      displayName: player?.displayName || '',
      email: player?.email || '',
      title,
      description,
      status: 'pending',
      messages: [],
      unreadByAdmin: true,
      unreadByUser: false,
      createdAt: now,
      updatedAt: now,
    };
    await db.collection('supportTickets').doc(ticketId).set(doc);
    return res.json({ ok: true, ticket: publicTicket(ticketId, doc) });
  } catch (e) {
    console.error('POST /api/support failed:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

/** List the caller's tickets, newest first. */
router.get('/support/mine', async (req, res) => {
  const uid = req.uid;
  try {
    const rows = await whereEquals(db, USE_FAKE, 'supportTickets', 'uid', uid);
    rows.sort((a, b) => (b.data.createdAt || 0) - (a.data.createdAt || 0));
    return res.json({ ok: true, tickets: rows.map((r) => publicTicket(r.id, r.data)) });
  } catch (e) {
    console.error('GET /api/support/mine failed:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

/** Add a message to the caller's ticket (continues the thread). */
router.post('/support/:ticketId/reply', async (req, res) => {
  const uid = req.uid;
  try {
    const text = String(req.body?.text || '').trim();
    if (!text || text.length > 2000) {
      return res.status(400).json({ ok: false, error: 'bad_text' });
    }
    const found = await getOwnTicket(req.params.ticketId, uid);
    if (found.error) {
      const code = found.error === 'not_found' ? 404 : 403;
      return res.status(code).json({ ok: false, error: found.error });
    }
    const msg = { sender: 'user', text, createdAt: Date.now() };
    const messages = [...(found.data.messages || []), msg];
    await found.ref.update({
      messages,
      unreadByAdmin: true,
      updatedAt: Date.now(),
    });
    const snap = await found.ref.get();
    return res.json({ ok: true, ticket: publicTicket(found.ref.id, snap.data()) });
  } catch (e) {
    console.error('POST /api/support/:ticketId/reply failed:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

/** Mark the caller's ticket as read (clears the "new reply" flag). */
router.post('/support/:ticketId/read', async (req, res) => {
  const uid = req.uid;
  try {
    const found = await getOwnTicket(req.params.ticketId, uid);
    if (found.error) {
      const code = found.error === 'not_found' ? 404 : 403;
      return res.status(code).json({ ok: false, error: found.error });
    }
    await found.ref.update({ unreadByUser: false });
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/support/:ticketId/read failed:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

module.exports = router;
module.exports.STATUSES = STATUSES;
module.exports.publicTicket = publicTicket;
