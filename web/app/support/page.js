'use client';
import { useCallback, useEffect, useState } from 'react';
import Protected from '../components/Protected.js';
import { LoadingBlock, ErrorNotice, EmptyState } from '../components/ui.js';
import { Icon } from '../components/icons.js';
import { useAuth } from '../../contexts/AuthContext.js';
import { api, ApiError } from '../../lib/api.js';
import { sfx } from '../../lib/audio.js';

const STATUS_META = {
  pending: { label: 'Pending', icon: 'pending', color: 'var(--warn, #f59e0b)' },
  checking: { label: 'Being checked', icon: 'search', color: 'var(--teal, #2dd4bf)' },
  solved: { label: 'Solved', icon: 'success', color: 'var(--success, #22c55e)' },
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.pending;
  return (
    <span
      className="rarity-tag"
      style={{ '--rarity': meta.color, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
    >
      <Icon name={meta.icon} />
      {meta.label}
    </span>
  );
}

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

export default function SupportPage() {
  return (
    <Protected>
      <SupportInner />
    </Protected>
  );
}

function SupportInner() {
  const { player } = useAuth();
  const [tickets, setTickets] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [justCreated, setJustCreated] = useState(null);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const out = await api.supportMine();
      setTickets(out.tickets || []);
    } catch (e) {
      setLoadError(e.message || 'Could not load your support tickets.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setFormError('');
    const t = title.trim();
    const d = description.trim();
    if (!t) {
      setFormError('Please give your problem a title.');
      return;
    }
    if (!d) {
      setFormError('Please describe your problem.');
      return;
    }
    setSubmitting(true);
    try {
      const out = await api.supportCreate(t, d);
      sfx.levelup();
      setJustCreated(out.ticket);
      setTitle('');
      setDescription('');
      setFormOpen(false);
      setOpenId(out.ticket.ticketId);
      await load();
    } catch (err) {
      sfx.error();
      const key = err instanceof ApiError ? err.code : '';
      setFormError(
        key === 'bad_title'
          ? 'The title must be between 1 and 120 characters.'
          : key === 'bad_description'
            ? 'The description must be between 1 and 2000 characters.'
            : err.message || 'Could not submit your request.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const toggleOpen = async (ticket) => {
    const id = ticket.ticketId;
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (ticket.unreadByUser) {
      try {
        await api.supportRead(id);
        setTickets((prev) => (prev || []).map((x) => (x.ticketId === id ? { ...x, unreadByUser: false } : x)));
      } catch {
        /* non-fatal */
      }
    }
  };

  return (
    <div className="page">
      <h1 className="serif">
        <Icon name="help" /> Support
      </h1>
      <p style={{ color: 'var(--ink-dim)', marginTop: '-0.5rem' }}>
        Stuck on something? Tell the support team — they usually reply within a day.
      </p>

      {justCreated && (
        <div className="notice notice-info" role="status" style={{ marginBottom: '1rem' }}>
          <Icon name="success" /> Your request was received. Your support ID is{' '}
          <strong style={{ letterSpacing: '0.05em' }}>{justCreated.ticketId}</strong>. Keep it
          handy — the team will pick it up soon.
        </div>
      )}
      {loadError && <ErrorNotice message={loadError} onRetry={load} />}

      {!formOpen ? (
        <button className="btn btn-primary" onClick={() => { setFormOpen(true); setJustCreated(null); sfx.click(); }}>
          <Icon name="plus" /> Contact Support
        </button>
      ) : (
        <section className="card" aria-label="New support request">
          <h2 className="serif" style={{ marginTop: 0 }}>
            New support request
          </h2>
          <form onSubmit={submit}>
            <div className="stat-row" style={{ marginBottom: '0.75rem' }}>
              <div className="stat">
                <div className="label">Your name</div>
                <div className="value" style={{ fontSize: '1rem' }}>
                  {player?.displayName || '—'}
                </div>
              </div>
              <div className="stat">
                <div className="label">Your email</div>
                <div className="value" style={{ fontSize: '1rem' }}>
                  {player?.email || '—'}
                </div>
              </div>
            </div>
            <p className="muted" style={{ fontSize: '0.85rem', marginTop: '-0.25rem' }}>
              Taken from your account — no need to type them again.
            </p>
            <label>
              Problem title
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. My hunt reward never arrived"
                maxLength={120}
              />
            </label>
            <label>
              Describe your problem
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What happened? What did you expect? Any steps to reproduce it help a lot."
                rows={5}
                maxLength={2000}
                style={{
                  width: '100%',
                  background: 'var(--bg-3, #171c2a)',
                  border: '1px solid var(--border, #232a3d)',
                  color: 'var(--text, #e6eaf2)',
                  borderRadius: '8px',
                  padding: '0.65rem 0.9rem',
                  fontSize: '1rem',
                  fontFamily: 'inherit',
                }}
              />
            </label>
            {formError && <p className="error">{formError}</p>}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Sending…' : 'Submit request'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={submitting}
                onClick={() => { setFormOpen(false); setFormError(''); sfx.click(); }}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <h2 className="serif" style={{ marginTop: '2rem' }}>
        My requests
      </h2>
      {tickets === null && !loadError && <LoadingBlock label="Fetching your requests" />}
      {tickets && tickets.length === 0 && (
        <EmptyState
          icon="help"
          title="No requests yet"
          body="When you contact support, your tickets and their replies will appear here."
        />
      )}
      {tickets && tickets.length > 0 && (
        <div className="row-list">
          {tickets.map((t) => (
            <TicketCard
              key={t.ticketId}
              ticket={t}
              open={openId === t.ticketId}
              onToggle={() => toggleOpen(t)}
              onReplied={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TicketCard({ ticket, open, onToggle, onReplied }) {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState('');

  const sendReply = async (e) => {
    e.preventDefault();
    const text = reply.trim();
    if (!text || sending) return;
    setReplyError('');
    setSending(true);
    try {
      await api.supportReply(ticket.ticketId, text);
      sfx.click();
      setReply('');
      await onReplied();
    } catch (err) {
      sfx.error();
      setReplyError(err.message || 'Could not send your reply.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: '0.75rem' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          all: 'unset',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          width: '100%',
          cursor: 'pointer',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>
            {ticket.unreadByUser && (
              <span
                className="rarity-tag"
                style={{ '--rarity': 'var(--accent, #7c6cf5)', marginRight: '0.5rem' }}
              >
                New reply
              </span>
            )}
            {ticket.title}
          </p>
          <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
            <span style={{ letterSpacing: '0.05em' }}>{ticket.ticketId}</span> ·{' '}
            {fmtDate(ticket.createdAt)}
          </p>
        </div>
        <StatusBadge status={ticket.status} />
        <Icon name="chevronDown" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
      </button>

      {open && (
        <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border, rgba(255,255,255,0.08))', paddingTop: '1rem' }}>
          <p style={{ color: 'var(--ink-dim)', whiteSpace: 'pre-wrap' }}>{ticket.description}</p>

          {ticket.messages.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', margin: '1rem 0' }}>
              {ticket.messages.map((m, i) => (
                <div
                  key={i}
                  style={{
                    alignSelf: m.sender === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                    background: m.sender === 'user' ? 'var(--bg-3, #171c2a)' : 'rgba(124, 108, 245, 0.12)',
                    border: '1px solid var(--border, #232a3d)',
                    borderRadius: '10px',
                    padding: '0.6rem 0.9rem',
                  }}
                >
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--ink-dim)', marginBottom: '0.25rem' }}>
                    {m.sender === 'user' ? 'You' : 'Support team'} · {fmtDate(m.createdAt)}
                  </p>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{m.text}</p>
                </div>
              ))}
            </div>
          )}

          {ticket.status === 'solved' ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              <Icon name="success" /> This ticket is solved. If the problem comes back, open a new
              request.
            </p>
          ) : (
            <form onSubmit={sendReply}>
              <label>
                Reply to the support team
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Add more details…"
                  rows={3}
                  maxLength={2000}
                  style={{
                    width: '100%',
                    background: 'var(--bg-3, #171c2a)',
                    border: '1px solid var(--border, #232a3d)',
                    color: 'var(--text, #e6eaf2)',
                    borderRadius: '8px',
                    padding: '0.65rem 0.9rem',
                    fontSize: '1rem',
                    fontFamily: 'inherit',
                  }}
                />
              </label>
              {replyError && <p className="error">{replyError}</p>}
              <button type="submit" className="btn btn-primary btn-sm" disabled={sending || !reply.trim()}>
                {sending ? 'Sending…' : 'Send reply'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
