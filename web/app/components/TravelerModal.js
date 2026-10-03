'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { link } from '../../lib/paths.js';
import { sfx } from '../../lib/audio.js';
import { useAuth } from '../../contexts/AuthContext.js';
import {
  getPublicProfile,
  getFriendshipStatus,
  sendFriendRequest,
  acceptFriendRequest,
  openPrivateChat,
} from '../../lib/social.js';

/**
 * TravelerCard — public base profile modal. Opened by clicking a traveler's
 * name in the Agora. Shows base info and lets you add them as a friend or
 * open a Veyra private chat (friends only).
 */
export default function TravelerModal({ uid, onClose }) {
  const { user } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [status, setStatus] = useState('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!uid) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const [p, s] = await Promise.all([
          getPublicProfile(uid),
          user ? getFriendshipStatus(user.uid, uid) : Promise.resolve('none'),
        ]);
        if (cancelled) return;
        setProfile(p);
        setStatus(s);
      } catch (e) {
        if (!cancelled) setError('Could not load this traveler.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, user]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!uid) return null;
  const isSelf = user?.uid === uid;

  const doAdd = async () => {
    setBusy(true);
    setError('');
    try {
      await sendFriendRequest(user.uid, uid);
      sfx.click();
      setStatus('pending-sent');
    } catch (e) {
      setError(e.message || 'Could not send the request.');
    } finally {
      setBusy(false);
    }
  };

  const doAccept = async () => {
    setBusy(true);
    setError('');
    try {
      await acceptFriendRequest(user.uid, uid);
      sfx.click();
      setStatus('accepted');
    } catch (e) {
      setError(e.message || 'Could not accept the request.');
    } finally {
      setBusy(false);
    }
  };

  const doMessage = async () => {
    setBusy(true);
    setError('');
    try {
      const chatId = await openPrivateChat(user.uid, uid);
      sfx.click();
      onClose();
      router.push(`${link('/veyra')}?chat=${encodeURIComponent(chatId)}`);
    } catch (e) {
      setError(e.message || 'Could not open the chat.');
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Traveler profile"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(8, 6, 14, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
        padding: '1rem',
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: '380px', margin: 0 }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
          <div style={{ flex: 1 }}>
            <h3 className="serif" style={{ margin: '0 0 0.25rem' }}>
              {profile?.displayName || 'Traveler'}
            </h3>
            <p style={{ margin: 0, color: 'var(--ink-dim)', fontSize: '0.9rem' }}>
              Level {profile?.level ?? '—'}
              {profile?.playerCode && (
                <> · <span style={{ letterSpacing: '0.1em' }}>{profile.playerCode}</span></>
              )}
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {error && <p className="error" style={{ marginTop: '0.75rem' }}>{error}</p>}

        {!isSelf && (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            {status === 'loading' && <p className="muted">Checking…</p>}
            {status === 'none' && (
              <button className="btn btn-primary btn-sm" onClick={doAdd} disabled={busy}>
                {busy ? 'Sending…' : '➕ Add Friend'}
              </button>
            )}
            {status === 'rejected' && (
              <button className="btn btn-primary btn-sm" onClick={doAdd} disabled={busy}>
                {busy ? 'Sending…' : '➕ Add Friend'}
              </button>
            )}
            {status === 'pending-sent' && (
              <p className="muted" style={{ margin: 0 }}>Friend request sent.</p>
            )}
            {status === 'pending-received' && (
              <button className="btn btn-primary btn-sm" onClick={doAccept} disabled={busy}>
                {busy ? 'Accepting…' : '✓ Accept Request'}
              </button>
            )}
            {status === 'accepted' && (
              <button className="btn btn-primary btn-sm" onClick={doMessage} disabled={busy}>
                {busy ? 'Opening…' : '✉️ Message in Veyra'}
              </button>
            )}
          </div>
        )}
        {isSelf && (
          <p className="muted" style={{ marginTop: '1rem', marginBottom: 0 }}>
            This is you, traveler.
          </p>
        )}
      </div>
    </div>
  );
}
