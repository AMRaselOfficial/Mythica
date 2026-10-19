'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.js';
import { api } from '../../lib/api.js';
import { Icon } from '../components/icons.js';
import { LoadingBlock, EmptyState, ErrorNotice } from '../components/ui.js';
import TravelerModal from '../components/TravelerModal.js';

export default function ReferralPage() {
  const { user, player, loading: authLoading } = useAuth();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [selectedTraveler, setSelectedTraveler] = useState(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.referralStats();
        if (!cancelled) setStats(data);
      } catch (e) {
        if (!cancelled) setError('Could not load referral stats.');
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (authLoading) return <LoadingBlock label="Loading referral" />;
  if (!user) return <EmptyState icon="users" title="Sign in required" body="Sign in to see your referral stats." />;
  if (error) return <ErrorNotice message={error} />;

  const referralCode = stats?.referralCode || player?.playerCode || '';
  const totalIncome = stats?.totalIncome || 0;
  const totalInvited = stats?.totalInvited || 0;
  const latest10 = stats?.latest10 || [];
  const top10 = stats?.top10 || [];

  const copyCode = async () => {
    if (!referralCode) return;
    try {
      await navigator.clipboard.writeText(referralCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const openTraveler = async (uid) => {
    try {
      const data = await api.playerByUid(uid);
      if (data?.player) setSelectedTraveler(data.player);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="page">
      <h1 className="serif">Referral</h1>
      <p style={{ color: 'var(--ink-dim)', maxWidth: '36rem' }}>
        Invite friends and family to Mythica. Share your referral code — when they sign up with it,
        they get <strong style={{ color: 'var(--gold-soft)' }}>50 petals free</strong>, and you earn{' '}
        <strong style={{ color: 'var(--gold-soft)' }}>10%</strong> of their earnings from hunts and
        marketplace sales.
      </p>

      {/* Referral code card */}
      <div className="card" style={{ marginTop: '1.5rem', textAlign: 'center' }}>
        <div style={{ color: 'var(--ink-dim)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
          Your Referral Code
        </div>
        <div
          style={{
            fontSize: '2rem',
            fontWeight: 700,
            letterSpacing: '0.2rem',
            color: 'var(--gold-soft)',
            marginBottom: '1rem',
          }}
        >
          {referralCode || '—'}
        </div>
        <button className="btn btn-primary" onClick={copyCode} disabled={!referralCode}>
          {copied ? 'Copied!' : 'Copy Code'}
        </button>
        <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', marginTop: '0.75rem', marginBottom: 0 }}>
          Share this code with friends. They enter it when signing up.
        </p>
      </div>

      {/* Stats */}
      <div className="stat-row" style={{ marginTop: '1.5rem' }}>
        <div className="stat">
          <div className="label">Total Referral Income</div>
          <div className="value" style={{ color: 'var(--gold-soft)' }}>
            {totalIncome} petals
          </div>
        </div>
        <div className="stat">
          <div className="label">Total Invited Players</div>
          <div className="value">{totalInvited}</div>
        </div>
      </div>

      {/* Latest 10 invited */}
      <h2 className="serif" style={{ marginTop: '2rem' }}>
        Latest Invited Players
      </h2>
      {latest10.length === 0 ? (
        <EmptyState
          icon="users"
          title="No invites yet"
          body="Share your referral code to invite friends and start earning."
        />
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {latest10.map((p, i) => (
            <div
              key={p.referredUid}
              className="row-item"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                borderBottom: i < latest10.length - 1 ? '1px solid var(--line)' : 'none',
                cursor: 'pointer',
              }}
              onClick={() => openTraveler(p.referredUid)}
            >
              <span
                style={{
                  minWidth: '2rem',
                  textAlign: 'center',
                  color: 'var(--ink-dim)',
                  fontWeight: 600,
                }}
              >
                #{i + 1}
              </span>
              <span style={{ fontWeight: 600, flex: 1 }}>{p.referredName}</span>
              <span style={{ color: 'var(--gold-soft)', fontSize: '0.9rem' }}>
                +{p.totalEarned} petals
              </span>
              <Icon name="chevron-right" size="1rem" />
            </div>
          ))}
        </div>
      )}

      {/* Top 10 earners */}
      <h2 className="serif" style={{ marginTop: '2rem' }}>
        Top Earners
      </h2>
      <p style={{ color: 'var(--ink-dim)', fontSize: '0.9rem', marginTop: '-0.5rem' }}>
        Players who earned you the most referral petals.
      </p>
      {top10.length === 0 ? (
        <EmptyState
          icon="trophy"
          title="No earnings yet"
          body="When your invited friends earn petals, you get 10% here."
        />
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {top10.map((p, i) => (
            <div
              key={p.referredUid}
              className="row-item"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                borderBottom: i < top10.length - 1 ? '1px solid var(--line)' : 'none',
                cursor: 'pointer',
                background: i < 3 ? 'rgba(232, 179, 75, 0.05)' : 'transparent',
              }}
              onClick={() => openTraveler(p.referredUid)}
            >
              <span
                style={{
                  minWidth: '2rem',
                  textAlign: 'center',
                  fontWeight: 700,
                  color: i === 0 ? '#e8b923' : i === 1 ? '#b8c0cc' : i === 2 ? '#cd7f32' : 'var(--ink-dim)',
                }}
              >
                {i < 3 ? '🏆' : `#${i + 1}`}
              </span>
              <span style={{ fontWeight: 600, flex: 1 }}>{p.referredName}</span>
              <span style={{ color: 'var(--gold-soft)', fontWeight: 600 }}>
                +{p.totalEarned} petals
              </span>
              <Icon name="chevron-right" size="1rem" />
            </div>
          ))}
        </div>
      )}

      {selectedTraveler && (
        <TravelerModal
          traveler={selectedTraveler}
          onClose={() => setSelectedTraveler(null)}
        />
      )}
    </div>
  );
}
