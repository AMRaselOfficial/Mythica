'use client';
import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import Protected from '../components/Protected.js';
import { RarityTag, LoadingBlock, EmptyState } from '../components/ui.js';
import { useAuth } from '../../contexts/AuthContext.js';
import content, { rarityColor, itemById } from '../../lib/content.js';
import { getFirebase } from '../../lib/firebase.js';
import { asset, link } from '../../lib/paths.js';
import { xpProgress } from '../../lib/xp.js';
import { sfx } from '../../lib/audio.js';
import FriendsSection from '../components/FriendsSection.js';

export default function ProfilePage() {
  return (
    <Protected>
      <ProfileInner />
    </Protected>
  );
}

function ProfileInner() {
  const { user, player } = useAuth();
  const [inv, setInv] = useState(null);
  const [achievements, setAchievements] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    const fb = getFirebase();
    if (!fb) return undefined;
    const un1 = onSnapshot(collection(fb.db, 'inventories', user.uid, 'items'), (snap) => {
      const rows = [];
      snap.forEach((d) => rows.push({ itemId: d.id, ...d.data() }));
      setInv(rows);
    });
    const un2 = onSnapshot(collection(fb.db, 'players', user.uid, 'achievements'), (snap) => {
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
      setAchievements(rows);
    });
    return () => {
      un1();
      un2();
    };
  }, [user]);

  const pct = player ? xpProgress(player.level || 1, player.xp || 0) : null;
  const uniqueOwned = (inv || []).length;
  const totalQty = (inv || []).reduce((s, r) => s + (r.quantity || 0), 0);
  const sprites = (inv || []).filter((r) => itemById(r.itemId)?.type === 'sprite').length;
  const weapons = (inv || []).filter((r) => itemById(r.itemId)?.type === 'weapon').length;
  const favorite = player?.favoriteItemId ? itemById(player.favoriteItemId) : null;
  const joined = player?.createdAt && typeof player.createdAt.toMillis === 'function'
    ? new Date(player.createdAt.toMillis()).toLocaleDateString()
    : '—';

  return (
    <div className="page">
      <h1 className="serif">{player?.displayName || 'Traveler'}</h1>
      <p style={{ color: 'var(--ink-dim)' }}>
        {user?.email} · wandering since {joined}
        {player?.accountStatus && player.accountStatus !== 'active' && (
          <> · <span style={{ color: 'var(--danger)' }}>status: {player.accountStatus}</span></>
        )}
      </p>
      {player?.playerCode && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', padding: '0.75rem 1rem' }}>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>Your traveler code — share it to trade</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '0.15em', color: 'var(--gold-soft)' }}>
              {player.playerCode}
            </div>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              navigator.clipboard?.writeText(player.playerCode);
              sfx.click();
            }}
          >
            Copy
          </button>
        </div>
      )}

      <div className="stat-row">
        <div className="stat">
          <div className="label">Level</div>
          <div className="value">{player?.level ?? 1}</div>
        </div>
        <div className="stat">
          <div className="label">Petals</div>
          <div className="value" style={{ color: 'var(--gold-soft)' }}>
            🌸 {player?.petals ?? 0}
          </div>
        </div>
        <div className="stat">
          <div className="label">Unique items</div>
          <div className="value">{uniqueOwned}</div>
        </div>
        <div className="stat">
          <div className="label">Total held</div>
          <div className="value">{totalQty}</div>
        </div>
        <div className="stat">
          <div className="label">Sprites / Weapons</div>
          <div className="value" style={{ fontSize: '1.1rem' }}>
            {sprites} / {weapons}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 className="serif" style={{ marginTop: 0 }}>
          Experience — Level {player?.level ?? 1}
        </h3>
        <p className="qty-badge">
          {player?.xp ?? 0} / {pct?.need ?? '—'} XP to next level
        </p>
        <div
          className="xp-bar"
          role="progressbar"
          aria-valuenow={Math.round(pct?.pct || 0)}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-label="Experience progress"
        >
          <div style={{ width: `${pct?.pct || 0}%` }} />
        </div>
      </div>

      {favorite && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h3 className="serif" style={{ marginTop: 0 }}>
            ⭐ Favorite Discovery
          </h3>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <img
              src={asset(favorite.image)}
              alt={favorite.name}
              style={{
                width: '72px',
                height: '72px',
                borderRadius: '12px',
                objectFit: 'cover',
                border: `2px solid ${rarityColor(favorite.rarity)}`,
              }}
              onError={(e) => (e.currentTarget.style.display = 'none')}
            />
            <div>
              <p style={{ margin: 0, fontWeight: 600 }}>{favorite.name}</p>
              <RarityTag rarity={favorite.rarity} />
            </div>
          </div>
        </div>
      )}

      <h2 className="serif">Achievements</h2>
      {!achievements && <LoadingBlock label="Polishing medals" />}
      {achievements && achievements.length === 0 && (
        <EmptyState
          icon="🏅"
          title="No achievements yet"
          body="Complete hunts and grow your collection to earn your first medal."
        />
      )}
      {achievements && achievements.length > 0 && (
        <div className="row-list">
          {achievements.map((a) => {
            const def = (content.achievements || []).find((x) => x.id === a.id);
            return (
              <div className="row-item" key={a.id}>
                <span style={{ fontSize: '1.8rem' }} aria-hidden="true">
                  {a.completed ? '🏅' : '🔒'}
                </span>
                <div className="grow">
                  <p className="title">{def?.name || a.id}</p>
                  <p className="sub">{def?.description || ''}</p>
                </div>
                {a.completed ? (
                  <span className="rarity-tag" style={{ '--rarity': 'var(--success)' }}>
                    Earned
                  </span>
                ) : (
                  <span className="qty-badge">
                    {a.progress ?? 0}/{def?.criteria?.target ?? '?'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="toolbar" style={{ marginTop: '1.5rem' }}>
        <a className="btn" href={link('/settings')} onClick={() => sfx.click()}>
          ⚙️ Settings
        </a>
        <a className="btn" href={link('/inventory')} onClick={() => sfx.click()}>
          🎒 View Inventory
        </a>
      </div>

      <FriendsSection />
    </div>
  );
}
