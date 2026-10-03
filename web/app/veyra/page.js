'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import Protected from '../components/Protected.js';
import { LoadingBlock, ErrorNotice, EmptyState } from '../components/ui.js';
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

function VeyraInner() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [chats, setChats] = useState(null);
  const [profiles, setProfiles] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState(null);
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

  // Chat list.
  useEffect(() => {
    if (!user) return undefined;
    const fb = getFirebase();
    if (!fb?.db) return undefined;
    const q = query(
      collection(fb.db, 'private_chats'),
      where('participants', 'array-contains', user.uid),
      orderBy('updatedAt', 'desc'),
      limit(30)
    );
    return onSnapshot(
      q,
      (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
        setChats(rows);
      },
      () => setChats([])
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

  // Active thread messages.
  useEffect(() => {
    if (!user || !activeId) {
      setMessages(null);
      return undefined;
    }
    const fb = getFirebase();
    if (!fb?.db) return undefined;
    const q = query(
      collection(fb.db, 'private_chats', activeId, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(100)
    );
    return onSnapshot(
      q,
      (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
        setMessages(rows);
        setError('');
      },
      () => setError('Could not load these messages.')
    );
  }, [user, activeId]);

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
      <h1 className="serif">✉️ Veyra</h1>
      <p style={{ color: 'var(--ink-dim)', marginTop: '-0.5rem' }}>
        Private whispers — only friends can speak here.
      </p>
      {error && <ErrorNotice message={error} />}

      <div
        className="card"
        style={{
          display: 'flex',
          minHeight: 'min(62vh, 560px)',
          padding: 0,
          overflow: 'hidden',
          flexWrap: 'wrap',
        }}
      >
        {/* Chat list */}
        <div
          style={{
            width: '240px',
            minWidth: '200px',
            borderRight: '1px solid var(--border, rgba(255,255,255,0.08))',
            overflowY: 'auto',
            maxHeight: '62vh',
          }}
        >
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
                  {c.lastMessage || 'Say hello 👋'}
                </div>
              </button>
            );
          })}
        </div>

        {/* Thread */}
        <div style={{ flex: 1, minWidth: '260px', display: 'flex', flexDirection: 'column' }}>
          {!activeId && (
            <div style={{ padding: '2rem', textAlign: 'center' }} className="muted">
              <EmptyState
                icon="✉️"
                title="Choose a conversation"
                body="Your private whispers with friends appear here."
              />
            </div>
          )}
          {activeId && (
            <>
              <div
                style={{
                  padding: '0.75rem 1rem',
                  borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))',
                  fontWeight: 600,
                }}
              >
                {partnerName}
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', maxHeight: '46vh' }}>
                {!messages && <LoadingBlock label="Reading whispers" />}
                {messages && messages.length === 0 && (
                  <p className="muted">No messages yet — say hello.</p>
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
