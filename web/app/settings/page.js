'use client';
import { useEffect, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth';
import Protected from '../components/Protected.js';
import { ErrorNotice } from '../components/ui.js';
import { useAuth } from '../../contexts/AuthContext.js';
import { getFirebase } from '../../lib/firebase.js';
import { friendlyAuthError } from '../login/page.js';
import {
  isMusicEnabled,
  isSfxEnabled,
  setMusicEnabled,
  setSfxEnabled,
  sfx,
} from '../../lib/audio.js';

export default function SettingsPage() {
  return (
    <Protected>
      <SettingsInner />
    </Protected>
  );
}

function SettingsInner() {
  const { user, player } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [music, setMusic] = useState(true);
  const [sfxOn, setSfxOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwSaved, setPwSaved] = useState('');
  const [pwError, setPwError] = useState('');

  // Seed from the authoritative player doc (falls back to localStorage via audio lib).
  useEffect(() => {
    if (player?.displayName) setDisplayName(player.displayName);
    setMusic(player?.musicEnabled ?? isMusicEnabled());
    setSfxOn(player?.sfxEnabled ?? isSfxEnabled());
  }, [player?.displayName, player?.musicEnabled, player?.sfxEnabled]);

  const persist = async (patch) => {
    const fb = getFirebase();
    if (!fb || !user) return;
    setBusy(true);
    setError('');
    setSaved('');
    try {
      await updateDoc(doc(fb.db, 'players', user.uid), patch);
      setSaved('Saved.');
      setTimeout(() => setSaved(''), 2500);
    } catch (e) {
      sfx.error();
      setError('Could not save. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const saveName = async (e) => {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) {
      setError('Traveler name cannot be empty.');
      return;
    }
    await persist({ displayName: name });
    sfx.click();
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPwError('');
    setPwSaved('');
    if (!oldPw) {
      setPwError('Enter your current password.');
      return;
    }
    if (newPw.length < 6) {
      setPwError('Choose a new password of at least 6 characters.');
      return;
    }
    if (newPw !== confirmPw) {
      sfx.error();
      setPwError('The two new passwords do not match.');
      return;
    }
    if (newPw === oldPw) {
      setPwError('The new password must be different from the old one.');
      return;
    }
    const fb = getFirebase();
    if (!fb || !user?.email) {
      setPwError('Could not verify your session. Try signing in again.');
      return;
    }
    setPwBusy(true);
    try {
      const cred = EmailAuthProvider.credential(user.email, oldPw);
      await reauthenticateWithCredential(fb.auth.currentUser, cred);
      await updatePassword(fb.auth.currentUser, newPw);
      setOldPw('');
      setNewPw('');
      setConfirmPw('');
      sfx.levelup();
      setPwSaved('Password changed.');
      setTimeout(() => setPwSaved(''), 3000);
    } catch (err) {
      sfx.error();
      setPwError(friendlyAuthError(err));
    } finally {
      setPwBusy(false);
    }
  };

  // INDEPENDENT toggles: music and SFX are separate flags, persisted both to
  // the player doc (authoritative) and localStorage (instant, offline-safe).
  const toggleMusic = async (v) => {
    setMusic(v);
    setMusicEnabled(v); // localStorage + live gain, immediate
    sfx.click();
    await persist({ musicEnabled: v });
  };

  const toggleSfx = async (v) => {
    setSfxOn(v);
    setSfxEnabled(v);
    if (v) sfx.click();
    await persist({ sfxEnabled: v });
  };

  return (
    <div className="page page-narrow">
      <h1 className="serif">Settings</h1>

      {error && <ErrorNotice message={error} />}
      {saved && (
        <div className="notice notice-info" role="status">
          {saved}
        </div>
      )}

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h2 className="serif" style={{ marginTop: 0 }}>
          Traveler
        </h2>
        <form onSubmit={saveName}>
          <div className="field">
            <label htmlFor="displayName">Display name</label>
            <input
              id="displayName"
              className="input"
              type="text"
              maxLength={40}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save Name'}
          </button>
        </form>
      </div>

      <div className="card">
        <h2 className="serif" style={{ marginTop: 0 }}>
          Sound
        </h2>
        <p style={{ color: 'var(--ink-dim)', fontSize: '0.9rem', marginTop: 0 }}>
          Music and sound effects are controlled independently.
        </p>
        <div className="toggle-row">
          <div>
            <strong>Background music</strong>
            <p style={{ margin: '0.25rem 0 0', color: 'var(--ink-dim)', fontSize: '0.9rem' }}>
              The dark-fantasy ambient loop.
            </p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={music}
              onChange={(e) => toggleMusic(e.target.checked)}
              aria-label="Background music"
            />
            <span className="track" aria-hidden="true" />
          </label>
        </div>
        <div className="toggle-row">
          <div>
            <strong>Sound effects</strong>
            <p style={{ margin: '0.25rem 0 0', color: 'var(--ink-dim)', fontSize: '0.9rem' }}>
              Clicks, fanfares, and hunt cues.
            </p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={sfxOn}
              onChange={(e) => toggleSfx(e.target.checked)}
              aria-label="Sound effects"
            />
            <span className="track" aria-hidden="true" />
          </label>
        </div>
      </div>

      <div className="card" style={{ marginTop: '1.25rem' }}>
        <h2 className="serif" style={{ marginTop: 0 }}>
          Account
        </h2>
        <p className="qty-badge" style={{ margin: 0 }}>
          Signed in as {user?.email}
        </p>
      </div>

      <div className="card" style={{ marginTop: '1.25rem' }}>
        <h2 className="serif" style={{ marginTop: 0 }}>
          Change password
        </h2>
        {pwError && <ErrorNotice message={pwError} />}
        {pwSaved && (
          <div className="notice notice-info" role="status" style={{ marginBottom: '0.75rem' }}>
            {pwSaved}
          </div>
        )}
        <form onSubmit={changePassword}>
          <div className="field">
            <label htmlFor="oldPw">Current password</label>
            <input
              id="oldPw"
              className="input"
              type="password"
              autoComplete="current-password"
              value={oldPw}
              onChange={(e) => setOldPw(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="newPw">New password</label>
            <input
              id="newPw"
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={6}
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="confirmPw">Confirm new password</label>
            <input
              id="confirmPw"
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={6}
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
            />
          </div>
          <button className="btn btn-primary btn-sm" type="submit" disabled={pwBusy}>
            {pwBusy ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </div>
    </div>
  );
}
