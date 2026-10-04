'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore';
import Protected from '../components/Protected.js';
import { LoadingBlock, ErrorNotice, EmptyState } from '../components/ui.js';
import { Icon } from '../components/icons.js';
import { useAuth } from '../../contexts/AuthContext.js';
import { getFirebase } from '../../lib/firebase.js';
import { sfx } from '../../lib/audio.js';
import {
  VEYRA_MESSAGE_MAX,
  getPublicProfile,
  openPrivateChat,
  otherUid,
  pairId,
  sendPrivateMessage,
} from '../../lib/social.js';

export default function VeyraPage() {
  return (
    <Protected>
      <VeyraInner />
    </Protected>
  );
}

function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const VEYRA_PAGE_SIZE = 100;

function VeyraInner() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [chats, setChats] = useState(null);
  const [profiles, setProfiles] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  const openChatWith = useCallback(
    async (theirUid) => {
      if (!user || !theirUid || theirUid === user.uid) return;
      setError('');
      try {
        const chatId = await openPrivateChat(user.uid, theirUid);
        setActiveId(chatId);
      } catch (e) {
        // Most likely: not friends yet (rules enforce friends-only chats).
        setError(e.message || 'Could not open this chat.');
      }
    },
    [user]
  );

  // Deep link: /veyra?chat=<otherUid> opens (or creates) that private chat.
  useEffect(() => {
    const target = searchParams?.get('chat');
    if (target && user) {
      // `chat` may be a uid (from Message buttons) or a chat doc id.
      if (target.includes('_')) setActiveId(target);
      else openChatWith(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, user]);

  // Chat list. NOTE: no orderBy here — array-contains + orderBy needs a
  // Firestore composite index; we sort the (small) result client-side instead.
  useEffect(() => {
    if (!user) return undefined;
    const fb = getFirebase();
    if (!fb?.db) return undefined;
    const q = query(
      collection(fb.db, 'private_chats'),
      where('participants', 'array-contains', user.uid),
      limit(30)
    );
    return onSnapshot(
      q,
      (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
        rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        setChats(rows);
      },
      (err) => {
        console.error('Veyra chat list error:', err);
        setChats([]);
      }
    );
  }, [user]);

  // Resolve display names for chat partners.
  useEffect(() => {
    if (!user || !chats) return;
    const missing = chats
      .map((c) => otherUid(c.id, user.uid))
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
  }, [chats, user]);

  // Active thread messages. Latest PAGE first via desc+limit, reversed for
  // display; "load older" paginates further back with startAfter.
  useEffect(() => {
    if (!user || !activeId) {
      setMessages(null);
      return undefined;
    }
    setHasMore(true);
    const fb = getFirebase();
    if (!fb?.db) return undefined;
    const q = query(
      collection(fb.db, 'private_chats', activeId, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(VEYRA_PAGE_SIZE)
    );
    return onSnapshot(
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
        setError('');
      },
      () => setError('Could not load these messages.')
    );
  }, [user, activeId]);

  const loadOlder = async () => {
    if (loadingMore || !hasMore || !activeId) return;
    const fb = getFirebase();
    if (!fb?.db || !messages || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const oldestTs = Math.min(...messages.map((m) => m.createdAt || 0));
      const q = query(
        collection(fb.db, 'private_chats', activeId, 'messages'),
        orderBy('createdAt', 'desc'),
        startAfter(oldestTs),
        limit(VEYRA_PAGE_SIZE)
      );
      const snap = await getDocs(q);
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
      if (rows.length < VEYRA_PAGE_SIZE) setHasMore(false);
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
      setError('Could not load older messages.');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages?.length, activeId]);

  const send = async (e) => {
    e.preventDefault();
    if (sending || !activeId) return;
    setSending(true);
    setError('');
    try {
      await sendPrivateMessage(activeId, user.uid, text);
      sfx.click();
      setText('');
    } catch (err) {
      sfx.error();
      setError(err.message || 'Could not send your message.');
    } finally {
      setSending(false);
    }
  };

  const activeChat = (chats || []).find((c) => c.id === activeId);
  const partnerUid = activeChat ? otherUid(activeChat.id, user?.uid) : null;
  const partnerName = (partnerUid && profiles[partnerUid]?.displayName) || 'Traveler';

  return (
    <div className="page">
      <h1 className="serif"><Icon name="mail" /> Veyra</h1>
      <p style={{ color: 'var(--ink-dim)', marginTop: '-0.5rem' }}>
        Private whispers — only friends can speak here.
      </p>
      {error && <ErrorNotice message={error} />}

      <div className={`card veyra-shell${activeId ? ' veyra-thread-open' : ''}`}>
        {/* Chat list */}
        <div className="veyra-list">
          {!chats && <LoadingBlock label="Finding conversations" />}
          {chats && chats.length === 0 && (
            <p className="muted" style={{ padding: '1rem', fontSize: '0.9rem' }}>
              No conversations yet. Add friends from the Agora or their traveler
              codes, then say hello.
            </p>
          )}
          {(chats || []).map((c) => {
            const other = otherUid(c.id, user.uid);
            const name = profiles[other]?.displayName || 'Traveler';
            const selected = c.id === activeId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  sfx.click();
                  setActiveId(c.id);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: selected ? 'rgba(255,255,255,0.06)' : 'none',
                  border: 'none',
                  borderBottom: '1px solid var(--border, rgba(255,255,255,0.06))',
                  padding: '0.75rem 1rem',
                  cursor: 'pointer',
                  color: 'inherit',
                }}
              >
                <div style={{ fontWeight: 600 }}>{name}</div>
                <div
                  className="muted"
                  style={{
                    fontSize: '0.8rem',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {c.lastMessage || <><Icon name="wave" /> Say hello</>}
                </div>
              </button>
            );
          })}
        </div>

        {/* Thread */}
        <div className="veyra-thread">
          {!activeId && (
            <div style={{ padding: '2rem', textAlign: 'center' }} className="muted">
              <EmptyState
                icon="mail"
                title="Choose a conversation"
                body="Your private whispers with friends appear here."
              />
            </div>
          )}
          {activeId && (
            <>
              <div className="veyra-thread-head">
                <button
                  type="button"
                  className="veyra-back"
                  onClick={() => {
                    sfx.click();
                    setActiveId(null);
                  }}
                  aria-label="Back to conversations"
                >
                  ←
                </button>
                <div className="veyra-avatar" aria-hidden="true">
                  {(partnerName || 'T').charAt(0).toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="veyra-partner-name">{partnerName}</div>
                  <div className="veyra-partner-sub">Private whisper</div>
                </div>
              </div>
              <div className="veyra-messages">
                {!messages && <LoadingBlock label="Reading whispers" />}
                {messages && messages.length === 0 && (
                  <p className="muted">No messages yet — say hello.</p>
                )}
                {messages && messages.length > 0 && hasMore && (
                  <div style={{ textAlign: 'center', marginBottom: '0.75rem' }}>
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
                  </div>
                )}
                {(messages || []).map((m) => {
                  const mine = m.senderUid === user.uid;
                  return (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        justifyContent: mine ? 'flex-end' : 'flex-start',
                        marginBottom: '0.5rem',
                      }}
                    >
                      <div
                        style={{
                          maxWidth: '75%',
                          padding: '0.5rem 0.75rem',
                          borderRadius: '12px',
                          background: mine
                            ? 'var(--accent, #6d5bd0)'
                            : 'rgba(255,255,255,0.07)',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        <div>{m.text}</div>
                        <div
                          style={{
                            fontSize: '0.7rem',
                            opacity: 0.65,
                            marginTop: '0.2rem',
                            textAlign: 'right',
                          }}
                        >
                          {fmtTime(m.createdAt)}
                        </div>
                      </div>
                    </div>
                  );
                })}
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
                  placeholder={`Whisper to ${partnerName}…`}
                  value={text}
                  maxLength={VEYRA_MESSAGE_MAX}
                  onChange={(e) => setText(e.target.value)}
                  disabled={sending}
                  aria-label="Private message"
                />
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={sending || !text.trim()}
                >
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
