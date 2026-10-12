'use client';
/**
 * Web push helpers for Mythica (Firebase Cloud Messaging).
 *
 * Flow:
 *   1. ensurePush(uid) — registers the service worker, asks permission,
 *      gets an FCM token, and sends it to the server.
 *   2. The server sends pushes for Veyra private messages.
 *   3. Foreground messages are handled in-app (Veyra already updates live).
 *
 * Token is cached in localStorage to avoid re-registering every visit.
 */

import { getFirebase } from './firebase.js';
import { api } from './api.js';

const LS_TOKEN = 'mythica_fcm_token';
const LS_ASKED = 'mythica_push_asked';

function firebaseConfigForSw() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
}

/**
 * Register for push notifications. Safe to call on every load — no-ops when
 * already registered, unsupported, or previously declined.
 * Returns 'granted' | 'denied' | 'unsupported' | 'skipped'.
 */
export async function ensurePush() {
  try {
    if (typeof window === 'undefined') return 'unsupported';
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
    if (!('Notification' in window)) return 'unsupported';

    const vapidKey = process.env.NEXT_PUBLIC_FCM_VAPID_KEY;
    if (!vapidKey) return 'skipped';

    // Already have a token cached — assume registered.
    try {
      if (window.localStorage.getItem(LS_TOKEN)) return 'granted';
    } catch { /* ignore */ }

    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission !== 'granted') {
      // Only auto-prompt once; afterwards the user can enable in Settings.
      try {
        if (window.localStorage.getItem(LS_ASKED)) return 'skipped';
      } catch { /* ignore */ }
      const perm = await Notification.requestPermission();
      try { window.localStorage.setItem(LS_ASKED, '1'); } catch { /* ignore */ }
      if (perm !== 'granted') return 'denied';
    }

    // Register the service worker (config passed via query string).
    const cfg = firebaseConfigForSw();
    const swUrl = '/firebase-messaging-sw.js?config=' + btoa(JSON.stringify(cfg));
    const reg = await navigator.serviceWorker.register(swUrl);

    // Get the FCM token.
    const { getMessaging, getToken } = await import('firebase/messaging');
    const { app } = getFirebase();
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: reg });
    if (!token) return 'denied';

    await api.notifRegisterToken(token);
    try { window.localStorage.setItem(LS_TOKEN, token); } catch { /* ignore */ }
    return 'granted';
  } catch {
    return 'skipped';
  }
}

/** Forget the cached token (e.g., on sign out). */
export function clearPushCache() {
  try {
    window.localStorage.removeItem(LS_TOKEN);
    window.localStorage.removeItem(LS_ASKED);
  } catch { /* ignore */ }
}
