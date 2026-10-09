'use client';
import { Icon } from './icons.js';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext.js';
import { getFirebase } from '../../lib/firebase.js';
import { link } from '../../lib/paths.js';
import { sfx } from '../../lib/audio.js';
import {
  acceptFriendRequest,
  getPublicProfile,
  otherUid,
  rejectFriendship,
} from '../../lib/social.js';

/**
 * FriendsSection — friend requests (accept/reject) and the friend list,
 * shown on the traveler's own profile. Each friend row opens a Veyra chat.
 */
export default function FriendsSection() {
  const { user } = useAuth();
  const router = useRouter();
  const [friendships, setFriendships] = useState(null);
  const [profiles, setProfiles] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return undefined;
    const fb = getFirebase();
    if (!fb?.db) return undefined;
    const q = query(
      collection(fb.db, 'friendships'),
      where('users', 'array-contains', user.uid)
    );
    return onSnapshot(
      q,
      (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
        setFriendships(rows);
      },
      () => setFriendships([])
    );
  }, [user]);

  useEffect(() => {
    if (!user || !friendships) return;
    const missing = friendships
      .map((f) => otherUid(f.id, user.uid))
      .filter((u) => u && !profiles[u]);
    if (!missing.length) return;
    let cancelled = false;
    (async () => {
      const next = {};
      await Promise.all(
        missing.map(async (u) => {
          try {
            const p = await getPublicProfile(u);
            if (p) next[u] = p;
          } catch {
            /* leave unresolved */
          }
        })
      );
      if (!cancelled) setProfiles((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendships, user]);

  if (!user) return null;

  const rows = friendships || [];
  const received = rows.filter(
    (f) => f.status === 'pending' && f.requesterUid !== user.uid
  );
  const sent = rows.filter(
    (f) => f.status === 'pending' && f.requesterUid === user.uid
  );
  const friends = rows.filter((f) => f.status === 'accepted');

  const nameOf = (f) => {
    const other = otherUid(f.id, user.uid);
    return profiles[other]?.displayName || 'Traveler';
  };
  const levelOf = (f) => {
    const other = otherUid(f.id, user.uid);
    return profiles[other]?.level ?? '—';
  };

  const doAccept = async (f) => {
    setBusyId(f.id);
    setError('');
    try {
      await acceptFriendRequest(user.uid, otherUid(f.id, user.uid));
      sfx.click();
    } catch (e) {
      setError(e.message || 'Could not accept the request.');
    } finally {
      setBusyId(null);
    }
  };

  const doReject = async (f) => {
    setBusyId(f.id);
    setError('');
    try {
      await rejectFriendship(user.uid, otherUid(f.id, user.uid));
      sfx.click();
    } catch (e) {
      setError(e.message || 'Could not update the request.');
    } finally {
      setBusyId(null);
    }
  };

  const doChat = (f) => {
    sfx.click();
    // NOTE: router.push auto-prepends the Pages basePath — pass the raw route.
    router.push(`/veyra?chat=${encodeURIComponent(otherUid(f.id, user.uid))}`);
  };

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h2 className="serif">Friends</h2>
      {error && <p className="error">{error}</p>}
      {!friendships && <p className="muted">Loading friendships…</p>}
      {friendships && received.length === 0 && sent.length === 0 && friends.length === 0 && (
        <p className="muted">
          No friends yet. Meet travelers in the{' '}
          <a href={link('/agora')} onClick={() => sfx.click()}>
            Agora
          </a>{' '}
          — tap anyone's name to view their profile and add them.
        </p>
      )}

      {received.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 className="serif" style={{ marginTop: 0 }}>
            Requests for you ({received.length})
          </h3>
          {received.map((f) => (
            <div
              key={f.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.5rem 0',
                borderTop: '1px solid var(--border, rgba(255,255,255,0.06))',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{nameOf(f)}</div>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  Level {levelOf(f)}
                </div>
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => doAccept(f)}
                disabled={busyId === f.id}
              >
                {busyId === f.id ? '…' : 'Accept'}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => doReject(f)}
                disabled={busyId === f.id}
              >
                Reject
              </button>
            </div>
          ))}
        </div>
      )}

      {friends.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 className="serif" style={{ marginTop: 0 }}>
            Your friends ({friends.length})
          </h3>
          <div style={{ maxHeight: '270px', overflowY: 'auto', paddingRight: '0.25rem' }}>
          {[...friends]
            .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
            .map((f) => (
            <div
              key={f.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.5rem 0',
                borderTop: '1px solid var(--border, rgba(255,255,255,0.06))',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{nameOf(f)}</div>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  Level {levelOf(f)}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => doChat(f)}>
                <Icon name="mail" /> Chat
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => doReject(f)}
                disabled={busyId === f.id}
                title="Remove friend"
              >
                Remove
              </button>
            </div>
          ))}
          </div>
        </div>
      )}

      {sent.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 className="serif" style={{ marginTop: 0 }}>
            Sent requests ({sent.length})
          </h3>
          {sent.map((f) => (
            <div
              key={f.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.5rem 0',
                borderTop: '1px solid var(--border, rgba(255,255,255,0.06))',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{nameOf(f)}</div>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  Waiting for a reply
                </div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => doReject(f)}
                disabled={busyId === f.id}
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
