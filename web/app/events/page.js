'use client';
import { useEffect, useRef, useState } from 'react';
import { collection, getDocs, limit, onSnapshot, orderBy, query, startAfter } from 'firebase/firestore';
import Protected from '../components/Protected.js';
import { LoadingBlock, ErrorNotice, EmptyState } from '../components/ui.js';
import { Icon } from '../components/icons.js';
import TravelerModal from '../components/TravelerModal.js';
import { useAuth } from '../../contexts/AuthContext.js';
import { getFirebase } from '../../lib/firebase.js';
import { sfx } from '../../lib/audio.js';
import {
  AGORA_SEND_MIN_LEVEL,
  AGORA_MESSAGE_MAX,
  sendAgoraMessage,
} from '../../lib/social.js';

const PAGE_SIZE = 50;

export default function AgoraPage() {
  return (
    <Protected>
      <AgoraInner />
    </Protected>
  );
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function AgoraInner() {
  const { user, player } = useAuth();
  const [messages, setMessages] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [selectedUid, setSelectedUid] = useState(null);
  const bottomRef = useRef(null);

  const level = player?.level || 1;
  const canSpeak = level >= AGORA_SEND_MIN_LEVEL;

  useEffect(() => {
    if (!user) return undefined;
    const fb = getFirebase();
    if (!fb?.db) return undefined;
    const q = query(
      collection(fb.db, 'agora_messages'),
      orderBy('createdAt', 'desc'),
      limit(PAGE_SIZE)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
        const latest = rows.reverse();
        // Merge instead of replace so messages loaded via "load older"
        // are kept when the live listener fires.
        setMessages((prev) => {
          const map = new Map();
          (prev || []).forEach((m) => map.set(m.id, m));
          latest.forEach((m) => map.set(m.id, m));
          return [...map.values()].sort(
            (a, b) => (a.createdAt || 0) - (b.createdAt || 0)
          );
        });
        setLoadError('');
      },
      () => setLoadError('Could not load the Agora.')
    );
    return unsub;
  }, [user]);

  const loadOlder = async () => {
    if (loadingMore || !hasMore) return;
    const fb = getFirebase();
    if (!fb?.db || !messages || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const oldestTs = Math.min(...messages.map((m) => m.createdAt || 0));
      const q = query(
        collection(fb.db, 'agora_messages'),
        orderBy('createdAt', 'desc'),
        startAfter(oldestTs),
        limit(PAGE_SIZE)
      );
      const snap = await getDocs(q);
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
      if (rows.length < PAGE_SIZE) setHasMore(false);
      if (rows.length > 0) {
        const older = rows.reverse();
        setMessages((prev) => {
          const map = new Map();
          (prev || []).forEach((m) => map.set(m.id, m));
          older.forEach((m) => {
            if (!map.has(m.id)) map.set(m.id, m);
          });
          return [...map.values()].sort(
            (a, b) => (a.createdAt || 0) - (b.createdAt || 0)
          );
        });
      }
    } catch {
      setLoadError('Could not load older messages.');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages?.length]);

  const send = async (e) => {
    e.preventDefault();
    if (!canSpeak || sending) return;
    setSending(true);
    setSendError('');
    try {
      await sendAgoraMessage({
        senderUid: user.uid,
        senderName: player?.displayName || 'Traveler',
        senderLevel: level,
        text,
      });
      sfx.click();
      setText('');
    } catch (err) {
      sfx.error();
      setSendError(err.message || 'Could not send your message.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page">
      <h1 className="serif"><Icon name="agora" /> Agora</h1>
      <p style={{ color: 'var(--ink-dim)', marginTop: '-0.5rem' }}>
        The public square — every traveler gathers here.
        {!canSpeak && (
          <> Reach <strong>level {AGORA_SEND_MIN_LEVEL}</strong> to speak; until then you can read along.</>
        )}
      </p>

      <div
        className="card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: 'min(62vh, 560px)',
          padding: 0,
          overflow: 'hidden',
        }}
      >
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
          {!messages && !loadError && <LoadingBlock label="Listening to the square" />}
          {loadError && <ErrorNotice message={loadError} />}
          {messages && messages.length === 0 && (
            <EmptyState
              icon="agora"
              title="Quiet… for now"
              body="Be the first voice in the Agora."
            />
          )}
          {messages && messages.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {hasMore && (
                <li style={{ textAlign: 'center', marginBottom: '0.75rem' }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      sfx.click();
                      loadOlder();
                    }}
                    disabled={loadingMore}
                  >
                    {loadingMore ? 'Loading…' : <><Icon name="up" /> Load older messages</>}
                  </button>
                </li>
              )}
              {messages.map((m) => {
                const mine = m.senderUid === user?.uid;
                return (
                  <li key={m.id} style={{ marginBottom: '0.7rem' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
                      <button
                        type="button"
                        onClick={() => {
                          sfx.click();
                          setSelectedUid(m.senderUid);
                        }}
                        title="View traveler"
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          color: mine ? 'var(--gold-soft)' : 'var(--link, #9db8ff)',
                          fontWeight: 600,
                          fontSize: '0.85rem',
                        }}
                      >
                        {m.senderName || 'Traveler'}
                      </button>
                      {' '}· Lv {m.senderLevel ?? '—'}
                      {' '}· {fmtTime(m.createdAt)}
                    </div>
                    <div style={{ marginTop: '0.15rem', overflowWrap: 'anywhere' }}>
                      {m.text}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={send}
          style={{
            display: 'flex',
            gap: '0.5rem',
            padding: '0.75rem 1rem',
            borderTop: '1px solid var(--border, rgba(255,255,255,0.08))',
          }}
        >
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder={
              canSpeak
                ? 'Speak to the square…'
                : `Reach level ${AGORA_SEND_MIN_LEVEL} to speak in the Agora`
            }
            value={text}
            maxLength={AGORA_MESSAGE_MAX}
            onChange={(e) => setText(e.target.value)}
            disabled={!canSpeak || sending}
            aria-label="Agora message"
          />
          <button
            className="btn btn-primary"
            type="submit"
            disabled={!canSpeak || sending || !text.trim()}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </form>
      </div>
      {sendError && <ErrorNotice message={sendError} />}
      {!canSpeak && (
        <p style={{ color: 'var(--ink-dim)', fontSize: '0.9rem' }}>
          <Icon name="tip" /> Tip: complete hunts to earn XP and level up. You can still add friends from
          travelers' profiles and chat privately in Veyra at any level.
        </p>
      )}

      {selectedUid && (
        <TravelerModal uid={selectedUid} onClose={() => setSelectedUid(null)} />
      )}
    </div>
  );
}
