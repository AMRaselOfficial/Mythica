'use client';
import { useCallback, useEffect, useState } from 'react';
import Protected from '../components/Protected.js';
import { LoadingBlock, ErrorNotice, EmptyState } from '../components/ui.js';
import content from '../../lib/content.js';
import { api } from '../../lib/api.js';
import { asset } from '../../lib/paths.js';

/** Resolve cover art: full URLs pass through, repo paths go through asset(). */
export function coverSrc(banner) {
  const b = String(banner || '').trim();
  if (!b) return '';
  if (/^https?:\/\//i.test(b)) return b;
  return asset(b);
}

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function challengeText(ev) {
  if (ev.type === 'invite_friends') return `Invite ${ev.goal} friend${ev.goal === 1 ? '' : 's'}`;
  if (ev.type === 'minigame') return 'Mini-game challenge';
  return `Hunt ${ev.goal} time${ev.goal === 1 ? '' : 's'}`;
}

function rewardsText(rewards) {
  const parts = [];
  if (rewards.petals) parts.push(`🌸 ${rewards.petals}`);
  if (rewards.xp) parts.push(`✨ ${rewards.xp} XP`);
  for (const it of rewards.items || []) parts.push(`🎁 ${it.name || it.itemId} ×${it.quantity}`);
  return parts.length ? parts.join(' · ') : 'Mystery rewards';
}

function EventCard({ event: ev, onJoin, onClaim, busy }) {
  const [imgOk, setImgOk] = useState(true);
  const src = coverSrc(ev.banner);
  const pct = ev.goal ? Math.min(100, Math.round(((ev.progress || 0) / ev.goal) * 100)) : 0;
  const badge = ev.claimed
    ? 'Claimed'
    : ev.live
      ? 'Live'
      : ev.ended
        ? 'Ended'
        : 'Upcoming';
  const badgeColor = ev.live && !ev.claimed ? 'var(--success)' : 'var(--ink-faint)';

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {imgOk && src ? (
        <img
          src={src}
          alt={ev.title}
          style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }}
          onError={() => setImgOk(false)}
        />
      ) : (
        <div
          style={{
            aspectRatio: '16/9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '3rem',
            background: 'linear-gradient(135deg, #1a2340, #0d1226)',
          }}
          aria-hidden="true"
        >
          🎪
        </div>
      )}
      <div style={{ padding: '1.25rem' }}>
        <h3 className="serif" style={{ margin: '0 0 0.4rem' }}>
          {ev.title}{' '}
          <span className="rarity-tag" style={{ '--rarity': badgeColor }}>
            {badge}
          </span>
        </h3>
        <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
          {fmtDate(ev.startAt)} → {fmtDate(ev.endAt)} · {ev.typeLabel || challengeText(ev)}
        </p>
        {ev.description && (
          <p style={{ color: 'var(--ink-dim)', margin: '0 0 0.75rem' }}>{ev.description}</p>
        )}
        <p style={{ margin: '0 0 0.75rem' }}>
          <strong>Challenge:</strong> {challengeText(ev)}
          <br />
          <strong>Rewards:</strong> {rewardsText(ev.rewards || {})}
        </p>

        {ev.type === 'minigame' ? (
          <p className="muted">🕹️ The mini-game for this event is arriving soon.</p>
        ) : !ev.joined && ev.live ? (
          <button className="btn btn-primary" disabled={busy} onClick={() => onJoin(ev)}>
            {busy ? 'Joining…' : 'Join event'}
          </button>
        ) : ev.joined ? (
          <div>
            <div
              style={{
                height: 10,
                borderRadius: 6,
                background: 'var(--surface-2)',
                overflow: 'hidden',
                marginBottom: '0.4rem',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, var(--accent), var(--accent-2))',
                  transition: 'width 0.4s',
                }}
              />
            </div>
            <p style={{ margin: '0 0 0.6rem', fontSize: '0.9rem' }}>
              Progress: <strong>{ev.progress || 0} / {ev.goal}</strong>
              {ev.completed && !ev.claimed && ' — complete! 🎉'}
            </p>
            {ev.completed && !ev.claimed && (
              <button className="btn btn-primary" disabled={busy} onClick={() => onClaim(ev)}>
                {busy ? 'Claiming…' : 'Claim rewards'}
              </button>
            )}
            {ev.claimed && <p style={{ color: 'var(--success)', margin: 0 }}>✅ Rewards claimed</p>}
          </div>
        ) : (
          <p className="muted">{ev.ended ? 'This event has ended.' : 'This event has not started yet.'}</p>
        )}
      </div>
    </div>
  );
}

export default function EventsPage() {
  return (
    <Protected>
      <EventsInner />
    </Protected>
  );
}

function EventsInner() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.events();
      setEvents(data.events || []);
    } catch {
      // Fall back to bundled content events (read-only legacy display).
      setError('Could not reach the event board — showing tale records instead.');
      setEvents((content.events || []).map((e) => ({ ...e, legacy: true })));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onJoin = async (ev) => {
    setBusyId(ev.id);
    setNotice('');
    try {
      await api.eventJoin(ev.id);
      setNotice(`✅ You joined "${ev.title}"!`);
      await load();
    } catch (e) {
      setNotice(`⚠️ ${e.message || 'Could not join the event.'}`);
    } finally {
      setBusyId('');
    }
  };

  const onClaim = async (ev) => {
    setBusyId(ev.id);
    setNotice('');
    try {
      const out = await api.eventClaim(ev.id);
      const r = out.rewards || {};
      const parts = [];
      if (r.petals) parts.push(`🌸 ${r.petals}`);
      if (r.xp) parts.push(`✨ ${r.xp} XP${r.leveledUp ? ' (level up!)' : ''}`);
      for (const it of r.items || []) parts.push(`🎁 ${it.name} ×${it.quantity}`);
      setNotice(`✅ Rewards claimed: ${parts.join(' · ') || 'nothing'}`);
      await load();
    } catch (e) {
      setNotice(`⚠️ ${e.message || 'Could not claim rewards.'}`);
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="page">
      <h1 className="serif">Events</h1>
      <p style={{ color: 'var(--ink-dim)' }}>
        Seasonal stirrings in the realm — join limited-time challenges and earn rewards.
      </p>

      {error && <ErrorNotice message={error} />}
      {notice && (
        <p
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '0.6rem 0.9rem',
          }}
        >
          {notice}
        </p>
      )}
      {!events && <LoadingBlock label="Reading the event board" />}
      {events && events.length === 0 && (
        <EmptyState icon="📜" title="No events" body="The realm is quiet for now. Check back soon." />
      )}
      {events && events.length > 0 && (
        <div className="grid-cards">
          {events.map((e) =>
            e.legacy ? (
              <LegacyEventCard key={e.id || e.title} event={e} />
            ) : (
              <EventCard
                key={e.id}
                event={e}
                onJoin={onJoin}
                onClaim={onClaim}
                busy={busyId === e.id}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** Read-only card for legacy bundled events when the API is unreachable. */
function LegacyEventCard({ event: e }) {
  const [imgOk, setImgOk] = useState(true);
  const src = coverSrc(e.banner);
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {imgOk && src ? (
        <img
          src={src}
          alt={e.title}
          style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }}
          onError={() => setImgOk(false)}
        />
      ) : (
        <div
          style={{
            aspectRatio: '16/9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '3rem',
            background: 'linear-gradient(135deg, #1a2340, #0d1226)',
          }}
          aria-hidden="true"
        >
          🌊
        </div>
      )}
      <div style={{ padding: '1.25rem' }}>
        <h3 className="serif" style={{ margin: '0 0 0.4rem' }}>{e.title}</h3>
        <p style={{ color: 'var(--ink-dim)' }}>{e.description}</p>
      </div>
    </div>
  );
}
