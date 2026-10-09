'use client';
import { useEffect, useState } from 'react';
import Protected from '../components/Protected.js';
import { LoadingBlock, ErrorNotice, EmptyState } from '../components/ui.js';
import { Icon } from '../components/icons.js';
import { useAuth } from '../../contexts/AuthContext.js';
import { api } from '../../lib/api.js';
import { formatPower } from '../../lib/content.js';
import { sfx } from '../../lib/audio.js';

function rankMedal(rank) {
  if (rank === 1) return <span style={{ color: '#e8b923' }}><Icon name="trophy" /></span>;
  if (rank === 2) return <span style={{ color: '#b8c0cc' }}><Icon name="trophy" /></span>;
  if (rank === 3) return <span style={{ color: '#cd7f32' }}><Icon name="trophy" /></span>;
  return <span className="muted" style={{ minWidth: '1.5rem', textAlign: 'center' }}>{rank}</span>;
}

function BoardRow({ entry, highlight }) {
  return (
    <div
      className="row-item"
      style={
        highlight
          ? {
              border: '2px solid var(--gold-soft, #d8b36a)',
              background: 'linear-gradient(135deg, rgba(216,179,106,0.12), rgba(216,179,106,0.03))',
            }
          : undefined
      }
    >
      <span style={{ minWidth: '2rem', display: 'flex', justifyContent: 'center' }} aria-hidden="true">
        {rankMedal(entry.rank)}
      </span>
      <div className="grow">
        <p className="title">
          {entry.displayName}
          {highlight && (
            <span className="rarity-tag" style={{ '--rarity': 'var(--gold-soft, #d8b36a)', marginLeft: '0.5rem' }}>
              You
            </span>
          )}
        </p>
        <p className="sub">Level {entry.level}</p>
      </div>
      <span className="qty-badge" title="Best weapon power">
        <Icon name="sword" size="0.9rem" /> {formatPower(entry.bestWeaponPower)}
      </span>
    </div>
  );
}

function LeaderboardInner() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.leaderboard();
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Could not load the leaderboard.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page">
      <h1 className="serif">Leaderboard</h1>
      <p style={{ color: 'var(--ink-dim)' }}>
        Ranked by each traveler's strongest weapon power. Sharpen your blades to climb.
      </p>
      {error && <ErrorNotice message={error} />}
      {!data && !error && <LoadingBlock label="Ranking travelers" />}

      {data && (
        <>
          {data.you && (
            <div className="card" style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span style={{ color: 'var(--gold-soft, #d8b36a)' }} aria-hidden="true">
                <Icon name="trophy" size="1.8rem" />
              </span>
              <div>
                <p style={{ margin: 0, fontWeight: 600 }}>
                  {data.you.rank ? `Rank #${data.you.rank}` : 'Unranked'}
                </p>
                <p className="sub" style={{ margin: 0 }}>
                  Your best weapon power: {formatPower(data.you.bestWeaponPower)}
                  {!data.you.rank && ' — hunt to earn your first weapon'}
                </p>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginLeft: 'auto' }}
                onClick={() => {
                  sfx.click();
                  setData(null);
                  setError('');
                  api.leaderboard().then(setData).catch((e) => setError(e.message));
                }}
              >
                Refresh
              </button>
            </div>
          )}

          <h2 className="serif">Your League</h2>
          {data.league.length === 0 ? (
            <EmptyState
              icon="trophy"
              title="No league yet"
              body="Be the first to forge a weapon and claim your rank."
            />
          ) : (
            <div
              className="row-list"
              style={{ maxHeight: '440px', overflowY: 'auto', paddingRight: '0.25rem', marginBottom: '1.5rem' }}
            >
              {data.league.map((e) => (
                <BoardRow key={e.uid} entry={e} highlight={user && e.uid === user.uid} />
              ))}
            </div>
          )}

          <h2 className="serif">Global Top 20</h2>
          {data.global.length === 0 ? (
            <EmptyState
              icon="trophy"
              title="No rankings yet"
              body="No traveler has forged a weapon yet."
            />
          ) : (
            <div
              className="row-list"
              style={{ maxHeight: '600px', overflowY: 'auto', paddingRight: '0.25rem' }}
            >
              {data.global.map((e) => (
                <BoardRow key={e.uid} entry={e} highlight={user && e.uid === user.uid} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function LeaderboardPage() {
  return (
    <Protected>
      <LeaderboardInner />
    </Protected>
  );
}
