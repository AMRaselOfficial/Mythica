'use strict';
/**
 * Firestore access layer. All game logic goes through this module —
 * routes must NEVER touch firebase-admin directly.
 *
 * Real mode: firebase-admin firestore (service account from
 * FIREBASE_SERVICE_ACCOUNT env JSON or GOOGLE_APPLICATION_CREDENTIALS).
 * Test/dev mode (USE_FAKE_DB=1): in-memory stand-in exposing the same
 * interface: collection(name).doc(id?) with get/set/update/delete,
 * doc().collection(name) for subcollections, and
 * runTransaction(async tx => ...) with tx.get/tx.set/tx.update/tx.delete.
 */

const { randomUUID } = require('crypto');

const USE_FAKE = process.env.USE_FAKE_DB === '1';

function deepClone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/* ------------------------------- Fake impl ------------------------------ */

class FakeSnapshot {
  constructor(ref, data) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = data !== undefined;
    this._data = data;
  }
  data() {
    return deepClone(this._data);
  }
}

class FakeDocRef {
  constructor(store, path) {
    this._store = store;
    this.path = path;
    const parts = path.split('/');
    this.id = parts[parts.length - 1];
  }
  collection(name) {
    return new FakeCollectionRef(this._store, `${this.path}/${name}`);
  }
  async get() {
    const d = this._store.get(this.path);
    return new FakeSnapshot(this, d === undefined ? undefined : deepClone(d));
  }
  async set(data, opts) {
    const cur = this._store.get(this.path);
    const val =
      opts && opts.merge && cur !== undefined
        ? { ...deepClone(cur), ...deepClone(data) }
        : deepClone(data);
    this._store.set(this.path, val);
  }
  async update(data) {
    if (!this._store.has(this.path)) {
      const err = new Error(`firestore: document not found: ${this.path}`);
      err.code = 'not-found';
      throw err;
    }
    const cur = deepClone(this._store.get(this.path));
    this._store.set(this.path, { ...cur, ...deepClone(data) });
  }
  async delete() {
    this._store.delete(this.path);
  }
}

class FakeCollectionRef {
  constructor(store, path) {
    this._store = store;
    this.path = path;
  }
  doc(id) {
    return new FakeDocRef(this._store, `${this.path}/${id || randomUUID()}`);
  }
}

class FakeTransaction {
  constructor(store) {
    this._store = store;
  }
  get(ref) {
    return ref.get();
  }
  set(ref, data, opts) {
    return ref.set(data, opts);
  }
  update(ref, data) {
    return ref.update(data);
  }
  delete(ref) {
    return ref.delete();
  }
}

class FakeFirestore {
  constructor() {
    this._store = new Map();
  }
  collection(name) {
    return new FakeCollectionRef(this._store, name);
  }
  async runTransaction(fn) {
    return fn(new FakeTransaction(this._store));
  }
  /**
   * Fake-only helper: list every doc directly under a collection path
   * (no recursion into subcollections). Returns [{id, data}]. The admin
   * routes use this for players/activityLogs scans; real mode uses a
   * bounded .get() query instead.
   */
  _listAll(collectionPath) {
    const prefix = `${collectionPath}/`;
    const out = [];
    for (const [path, data] of this._store) {
      if (path.startsWith(prefix) && !path.slice(prefix.length).includes('/')) {
        out.push({ id: path.slice(prefix.length), data: () => deepClone(data) });
      }
    }
    return out;
  }
  /** Test helper: wipe all documents. */
  _reset() {
    this._store.clear();
  }
}

/* ------------------------------- Real impl ------------------------------ */

function loadAdmin() {
  let admin;
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    admin = require('firebase-admin');
  } catch (e) {
    const err = new Error('firebase-admin is not installed');
    err.code = 'ADMIN_UNAVAILABLE';
    throw err;
  }
  if (!admin.apps.length) {
    const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (svc) {
      admin.initializeApp({ credential: admin.credential.cert(JSON.parse(svc)) });
    } else {
      admin.initializeApp(); // uses GOOGLE_APPLICATION_CREDENTIALS
    }
  }
  return admin;
}

function realDb() {
  const fs = loadAdmin().firestore();
  return {
    collection: (name) => fs.collection(name),
    runTransaction: (fn) => fs.runTransaction(fn),
  };
}

const db = USE_FAKE ? new FakeFirestore() : realDb();

function resetFakeDb() {
  if (USE_FAKE) db._reset();
}

module.exports = { db, resetFakeDb, loadAdmin, USE_FAKE };
