'use strict';
/**
 * Shared test helpers. Sets fake-auth/fake-db env BEFORE any server module
 * is required (lib/db and lib/content read env at require time), then boots
 * the app on an ephemeral port and talks to it with global fetch.
 */
process.env.USE_FAKE_DB = '1';
process.env.FAKE_AUTH = '1';
process.env.THEATER_MIN_MS = '0';
process.env.THEATER_MAX_MS = '0';

const { db, resetFakeDb } = require('../lib/db');
const contentApi = require('../lib/content');

async function startServer() {
  const app = require('../server');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

function authHeaders(uid) {
  return { Authorization: `Bearer test-${uid}`, 'Content-Type': 'application/json' };
}

async function post(base, path, uid, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: authHeaders(uid),
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function get(base, path, headers) {
  const res = await fetch(base + path, { headers: headers || {} });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function seedPlayer(uid, petals = 20) {
  const now = Date.now();
  await db.collection('players').doc(uid).set({
    displayName: uid,
    email: '',
    petals,
    level: 1,
    xp: 0,
    createdAt: now,
    updatedAt: now,
    lastHuntAt: 0,
    musicEnabled: true,
    sfxEnabled: true,
    accountStatus: 'active',
  });
}

async function seedInv(uid, itemId, quantity, upgradeLevel = 0) {
  await db
    .collection('inventories')
    .doc(uid)
    .collection('items')
    .doc(itemId)
    .set({ quantity, upgradeLevel, obtainedAt: Date.now(), favorite: false });
}

async function getPlayer(uid) {
  const snap = await db.collection('players').doc(uid).get();
  return snap.exists ? snap.data() : null;
}

async function getInvQty(uid, itemId) {
  const snap = await db.collection('inventories').doc(uid).collection('items').doc(itemId).get();
  return snap.exists ? snap.data().quantity || 0 : 0;
}

module.exports = {
  db,
  resetFakeDb,
  contentApi,
  startServer,
  post,
  get,
  authHeaders,
  seedPlayer,
  seedInv,
  getPlayer,
  getInvQty,
};
