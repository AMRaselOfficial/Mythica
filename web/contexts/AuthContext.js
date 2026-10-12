'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { getFirebase, getApiUrl, isConfigured } from '../lib/firebase.js';
import { onAccountBanned } from '../lib/api.js';
import { link } from '../lib/paths.js';
import { setMusicEnabled, setSfxEnabled } from '../lib/audio.js';

const AuthContext = createContext(null);

const PLAYER_DEFAULTS = {
  petals: 20,
  level: 1,
  xp: 0,
  musicEnabled: true,
  sfxEnabled: true,
  accountStatus: 'active',
};

// Prevents concurrent ensurePlayerDoc calls for the same user (signup/login
// both trigger it directly AND via onAuthStateChanged). Without this, two
// calls race: both see "doc missing", both setDoc, and the loser gets a
// Firestore "Missing or insufficient permissions" because its write lands as
// an update with fields the rules don't allow clients to change.
const pendingEnsures = new Map();

async function ensurePlayerDoc(db, user, displayName) {
  const uid = user.uid;
  if (pendingEnsures.has(uid)) return pendingEnsures.get(uid);
  const run = (async () => {
    await ensurePlayerDocInner(db, user, displayName);
  })();
  pendingEnsures.set(uid, run);
  try {
    return await run;
  } finally {
    pendingEnsures.delete(uid);
  }
}

async function ensurePlayerDocInner(db, user, displayName) {
  // Right after signup/login, Firestore may not see the auth token yet,
  // causing a spurious "Missing or insufficient permissions" on the first
  // write. Force a token refresh so request.auth is populated in the rules.
  try {
    await user.getIdToken(true);
  } catch {
    /* ignore; the Firestore call will surface a real error if auth is broken */
  }
  const ref = doc(db, 'players', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const docData = {
      displayName: displayName || user.displayName || user.email?.split('@')[0] || 'Wanderer',
      email: user.email || '',
      ...PLAYER_DEFAULTS,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastHuntAt: null,
    };
    // The auth token can take a moment to propagate to Firestore after
    // signup. Retry permission-denied errors with backoff instead of
    // surfacing a spurious error to the user.
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await setDoc(ref, docData);
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        const isPermissionError = e?.code === 'permission-denied'
          || /insufficient permissions/i.test(e?.message || '');
        if (isPermissionError && attempt < 3) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          try { await user.getIdToken(true); } catch { /* ignore */ }
          continue;
        }
        throw e;
      }
    }
    if (lastError) throw lastError;
    // New accounts need a traveler code right away. The client can't write
    // playerCode itself (Firestore rules forbid it), so ask the game server
    // to generate one via /api/player/me (which calls ensurePlayerIdentity).
    try {
      const token = await user.getIdToken();
      const apiUrl = getApiUrl();
      if (apiUrl && token) {
        await fetch(`${apiUrl}/api/player/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {
      /* non-fatal: the code will be generated on the first hunt instead */
    }
  } else if (!snap.data()?.playerCode) {
    // Older accounts created before the traveler-code feature (or ones that
    // missed it) get a code now. Same server call as above.
    try {
      const token = await user.getIdToken();
      const apiUrl = getApiUrl();
      if (apiUrl && token) {
        await fetch(`${apiUrl}/api/player/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {
      /* non-fatal: the code will be generated on the first hunt instead */
    }
  }
}

export function AuthProvider({ children }) {
  const configured = isConfigured();
  const [user, setUser] = useState(null);
  const [player, setPlayer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [banned, setBanned] = useState(false);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return undefined;
    }
    const fb = getFirebase();
    const unsub = onAuthStateChanged(fb.auth, async (u) => {
      setAuthError('');
      setUser(u);
      if (u) {
        try {
          await ensurePlayerDoc(fb.db, u);
        } catch (e) {
          setAuthError('Could not load your traveler record.');
        }
      } else {
        setPlayer(null);
      }
      setLoading(false);
    });
    return unsub;
  }, [configured]);

  // Live player doc subscription (keeps petals/level/settings fresh).
  useEffect(() => {
    if (!configured || !user) return undefined;
    const fb = getFirebase();
    const unsub = onSnapshot(
      doc(fb.db, 'players', user.uid),
      (snap) => {
        if (snap.exists()) {
          const p = { id: snap.id, ...snap.data() };
          setPlayer(p);
          // Sync audio flags from the authoritative player doc.
          setMusicEnabled(p.musicEnabled !== false);
          setSfxEnabled(p.sfxEnabled !== false);
        }
      },
      () => {}
    );
    return unsub;
  }, [configured, user]);

  const idToken = useCallback(async () => {
    const fb = getFirebase();
    if (!fb?.auth?.currentUser) return null;
    return fb.auth.currentUser.getIdToken();
  }, []);

  const signup = useCallback(
    async (email, password, displayName) => {
      const fb = getFirebase();
      const cred = await createUserWithEmailAndPassword(fb.auth, email, password);
      if (displayName) {
        try {
          await updateProfile(cred.user, { displayName });
        } catch {
          /* ignore */
        }
      }
      await ensurePlayerDoc(fb.db, cred.user, displayName);
    },
    []
  );

  const login = useCallback(async (email, password) => {
    const fb = getFirebase();
    const cred = await signInWithEmailAndPassword(fb.auth, email, password);
    await ensurePlayerDoc(fb.db, cred.user);
  }, []);

  const logout = useCallback(async () => {
    const fb = getFirebase();
    setPlayer(null);
    await signOut(fb.auth);
  }, []);

  // Global banned-account handling: the API layer calls this for ANY 403 +
  // account_banned response — even mid-session. Show the suspension screen
  // and sign the user out immediately.
  useEffect(() => onAccountBanned(() => setBanned(true)), []);
  useEffect(() => {
    if (banned) logout();
  }, [banned, logout]);

  const resetPassword = useCallback(async (email) => {
    const fb = getFirebase();
    await sendPasswordResetEmail(fb.auth, email);
  }, []);

  const value = useMemo(
    () => ({
      configured,
      user,
      player,
      loading,
      authError,
      idToken,
      signup,
      login,
      logout,
      resetPassword,
    }),
    [configured, user, player, loading, authError, idToken, signup, login, logout, resetPassword]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {banned && <BannedOverlay onClose={() => setBanned(false)} />}
    </AuthContext.Provider>
  );
}

function BannedOverlay({ onClose }) {
  const router = useRouter();
  const { logout } = useAuth();
  const dismiss = async () => {
    try {
      await logout();
    } catch {
      /* ignore */
    }
    onClose();
    router.push(link('/'));
  };
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="banned-title"
      aria-describedby="banned-desc"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        background: 'rgba(4, 6, 14, 0.96)',
      }}
    >
      <div className="card" style={{ maxWidth: '26rem', textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem' }} aria-hidden="true">
          ⛔
        </div>
        <h2 id="banned-title" className="serif">
          Your account has been suspended.
        </h2>
        <p id="banned-desc" style={{ color: 'var(--ink-dim)' }}>
          This traveler’s account was suspended for breaking the realm’s rules, so the wilds are
          closed to you for now. If you believe this is a mistake, contact support.
        </p>
        <button className="btn btn-primary" onClick={dismiss} autoFocus>
          Sign out
        </button>
      </div>
    </div>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
