/**
 * Social helpers for Agora (public chat), Veyra (private chat) and friendships.
 * Deterministic IDs: friendship/chat doc ID = the two UIDs sorted and joined
 * with '_', matching the firestore.rules friendshipId() helper.
 */
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { getFirebase } from './firebase.js';

export const AGORA_SEND_MIN_LEVEL = 10;
export const AGORA_MESSAGE_MAX = 500;
export const VEYRA_MESSAGE_MAX = 2000;

/** Canonical doc ID for a friendship / private chat between two users. */
export function pairId(uidA, uidB) {
  return [uidA, uidB].sort().join('_');
}

/** The other participant's UID given the pair and my UID. */
export function otherUid(pair, myUid) {
  const [a, b] = pair.split('_');
  return a === myUid ? b : a;
}

function db() {
  const fb = getFirebase();
  if (!fb?.db) throw new Error('Firebase is not configured.');
  return fb.db;
}

/** Load a traveler's public base profile. Returns null when missing. */
export async function getPublicProfile(uid) {
  const snap = await getDoc(doc(db(), 'publicProfiles', uid));
  return snap.exists() ? { uid: snap.id, ...snap.data() } : null;
}

/**
 * Friendship status between me and another user.
 * Returns 'none' | 'pending-sent' | 'pending-received' | 'accepted' | 'rejected'.
 */
export async function getFriendshipStatus(myUid, theirUid) {
  if (myUid === theirUid) return 'self';
  const snap = await getDoc(doc(db(), 'friendships', pairId(myUid, theirUid)));
  if (!snap.exists()) return 'none';
  const f = snap.data();
  if (f.status === 'accepted') return 'accepted';
  if (f.status === 'pending') {
    return f.requesterUid === myUid ? 'pending-sent' : 'pending-received';
  }
  return 'rejected';
}

/** Send a friend request to another traveler. */
export async function sendFriendRequest(myUid, theirUid) {
  const now = Date.now();
  await setDoc(doc(db(), 'friendships', pairId(myUid, theirUid)), {
    users: [myUid, theirUid].sort(),
    status: 'pending',
    requesterUid: myUid,
    createdAt: now,
    updatedAt: now,
  });
}

/** Accept a pending friend request (must be the recipient). */
export async function acceptFriendRequest(myUid, theirUid) {
  await updateDoc(doc(db(), 'friendships', pairId(myUid, theirUid)), {
    status: 'accepted',
    updatedAt: Date.now(),
  });
}

/** Reject a request or unfriend. Either side may do this. */
export async function rejectFriendship(myUid, theirUid) {
  await updateDoc(doc(db(), 'friendships', pairId(myUid, theirUid)), {
    status: 'rejected',
    updatedAt: Date.now(),
  });
}

/** Post a message to the Agora public square. */
export async function sendAgoraMessage({ senderUid, senderName, senderLevel, text }) {
  const clean = text.trim().slice(0, AGORA_MESSAGE_MAX);
  if (!clean) throw new Error('Write something first.');
  await addDoc(collection(db(), 'agora_messages'), {
    senderUid,
    senderName: senderName || 'Traveler',
    senderLevel: senderLevel || 1,
    text: clean,
    createdAt: Date.now(),
  });
}

/**
 * Open (or create) the Veyra private chat with a friend.
 * Requires an accepted friendship — enforced by firestore.rules.
 * Returns the chat doc ID.
 */
export async function openPrivateChat(myUid, theirUid) {
  const id = pairId(myUid, theirUid);
  const ref = doc(db(), 'private_chats', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      participants: [myUid, theirUid].sort(),
      lastMessage: '',
      lastMessageAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  return id;
}

/** Send a Veyra private message and bump the chat preview. */
export async function sendPrivateMessage(chatId, senderUid, text) {
  const clean = text.trim().slice(0, VEYRA_MESSAGE_MAX);
  if (!clean) throw new Error('Write something first.');
  const database = db();
  await addDoc(collection(database, 'private_chats', chatId, 'messages'), {
    senderUid,
    text: clean,
    createdAt: Date.now(),
  });
  await updateDoc(doc(database, 'private_chats', chatId), {
    lastMessage: clean.slice(0, 120),
    lastMessageAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export { serverTimestamp };
