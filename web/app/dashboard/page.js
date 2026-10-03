'use client';
import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import Protected from '../components/Protected.js';
import { RarityTag, LoadingBlock, EmptyState } from '../components/ui.js';
import { useAuth } from '../../contexts/AuthContext.js';
import content, { rarityColor, itemById } from '../../lib/content.js';
import { getFirebase } from '../../lib/firebase.js';
import { asset, link } from '../../lib/paths.js';
import { xpProgress } from '../../lib/xp.js';
import { sfx } from '../../lib/audio.js';

export default function DashboardPage() {
  return (
    <Protected>
      <DashboardInner />
    </Protected>
  );
}

function DashboardInner() {
  const { player } = useAuth();
  const [recent, setRecent] = useState(null);
  const [totalItems, setTotalItems] = useState(0);

  const uid = useAuthUid();
  useEffect(() => {
    if (!uid) return undefined;
    const fb = getFirebase();
    if (!fb) return undefined;
    const q = query(
      collection(fb.db, 'inventories', uid, 'items'),
      orderBy('obtainedAt', 'desc'),
      limit(6)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = [];
        let total = 0;
        snap.forEach((d) => {
          rows.push({ itemId: d.id, ...d.data() });
          total += d.data().quantity || 0;
        });
        setRecent(rows);
        setTotalItems(total);
      },
      () => setRecent([])
    );
    return unsub;
  }, [uid]);

  const featured = (content.events || []).find((e) => e.featured && e.active) ||
    (content.events || []).find((e) => e.active);
  const pct = player ? xpProgress(player.level || 1, player.xp || 0) : null;

  return (
    <div className="page">
      <h1 className="serif">
        Welcome back, {player?.displayName || 'traveler'}
      </h1>

      <div className="stat-row">
        <div className="stat">
          <div className="label">Petals</div>
          <div className="value" style={{ color: 'var(--gold-soft)' }}>
            🌸 {player?.petals ?? 0}
          </div>
        </div>
        <div className="stat">
          <div className="label">Level</div>
          <div className="value">{player?.level ?? 1}</div>
        </div>
        <div className="stat" style={{ flex: 1, minWidth: '200px' }}>
          <div className="label">
            XP — {player?.xp ?? 0} / {pct?.need ?? '—'}
          </div>
          <div className="xp-bar" role="progressbar" aria-valuenow={Math.round(pct?.pct || 0)}
            aria-valuemin="0" aria-valuemax="100" aria-label="Experience progress">
            <div style={{ width: `${pct?.pct || 0}%` }} />
          </div>
        </div>
        <div className="stat">
          <div className="label">Collection</div>
          <div className="value">{totalItems}</div>
        </div>
      </div>

      <h2 className="serif">Quick Actions</h2>
      <div className="toolbar">
        <a className="btn btn-primary" href={link('/hunt')} onClick={() => sfx.click()}>
          🌙 Hunt
        </a>
        <a className="btn" href={link('/inventory')} onClick={() => sfx.click()}>
          🎒 Inventory
        </a>
        <a className="btn" href={link('/marketplace')} onClick={() => sfx.click()}>
          🪙 Marketplace
        </a>
        <a className="btn" href={link('/trades')} onClick={() => sfx.click()}>
          🤝 Trades
        </a>
        <a className="btn" href={link('/agora')} onClick={() => sfx.click()}>
          🏛️ Agora
        </a>
        <a className="btn" href={link('/veyra')} onClick={() => sfx.click()}>
          ✉️ Veyra
        </a>
      </div>

      {featured && (
        <section aria-label="Featured event" style={{ marginTop: '1.5rem' }}>
          <h2 className="serif">Featured Event</h2>
          <EventBanner event={featured} />
        </section>
      )}

      <section style={{ marginTop: '1.5rem' }}>
        <h2 className="serif">Recent Discoveries</h2>
        {!recent && <LoadingBlock label="Checking your satchel" />}
        {recent && recent.length === 0 && (
          <EmptyState
            icon="🔍"
            title="No discoveries yet"
            body="Your first hunt awaits. The wilds are generous to the bold."
          />
        )}
        {recent && recent.length > 0 && (
          <div className="grid">
            {recent.map((r) => {
              const def = itemById(r.itemId);
              if (!def) return null;
              return (
                <div
                  key={r.itemId}
                  className="item-card"
                  style={{ '--rarity': rarityColor(def.rarity), cursor: 'default' }}
                >
                  <div className="art">
                    <img
                      src={asset(def.image)}
                      alt={def.name}
                      loading="lazy"
                      onError={(e) => (e.currentTarget.style.display = 'none')}
                    />
                  </div>
                  <div className="meta">
                    <p className="name">{def.name}</p>
                    <RarityTag rarity={def.rarity} /> <span className="qty-badge">×{r.quantity}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function useAuthUid() {
  const { user } = useAuth();
  return user?.uid || null;
}

export function EventBanner({ event }) {
  const [ok, setOk] = useState(true);
  const now = Date.now();
  const start = event.startAt ? new Date(event.startAt).getTime() : 0;
  const end = event.endAt ? new Date(event.endAt).getTime() : 0;
  const live = (!start || now >= start) && (!end || now <= end);
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {ok && event.banner ? (
        <img
          src={asset(event.banner)}
          alt={event.title}
          style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }}
          onError={() => setOk(false)}
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
        <h3 className="serif" style={{ margin: '0 0 0.4rem' }}>
          {event.title}{' '}
          <span
            className="rarity-tag"
            style={{ '--rarity': live ? 'var(--success)' : 'var(--ink-faint)' }}
          >
            {live ? 'Live' : 'Ended'}
          </span>
        </h3>
        <p style={{ color: 'var(--ink-dim)', margin: '0 0 0.5rem' }}>{event.description}</p>
        {(event.rewards || []).length > 0 && (
          <p className="qty-badge" style={{ margin: 0 }}>
            Rewards:{' '}
            {event.rewards
              .map((r) => `${r.quantity > 1 ? r.quantity + '× ' : ''}${itemById(r.itemId)?.name || r.itemId}`)
              .join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}
