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
import { getFirebase, isConfigured } from '../lib/firebase.js';
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

async function ensurePlayerDoc(db, user, displayName) {
  const ref = doc(db, 'players', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      displayName: displayName || user.displayName || user.email?.split('@')[0] || 'Wanderer',
      email: user.email || '',
      ...PLAYER_DEFAULTS,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastHuntAt: null,
    });
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
