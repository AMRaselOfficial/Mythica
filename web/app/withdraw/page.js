'use client';
import { useCallback, useEffect, useState } from 'react';
import Protected from '../components/Protected.js';
import { LoadingBlock, ErrorNotice, EmptyState } from '../components/ui.js';
import { Icon } from '../components/icons.js';
import { useAuth } from '../../contexts/AuthContext.js';
import { api } from '../../lib/api.js';
import { sfx } from '../../lib/audio.js';

const STATUS_META = {
  pending: { label: 'Pending review', icon: 'clock', color: 'var(--warn, #f59e0b)' },
  approved: { label: 'Approved — payout soon', icon: 'success', color: 'var(--teal, #2dd4bf)' },
  rejected: { label: 'Rejected — refunded', icon: 'warning', color: 'var(--danger, #ef4444)' },
  completed: { label: 'Paid', icon: 'success', color: 'var(--success, #22c55e)' },
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

function fmtUsd(n) {
  return '$' + Number(n || 0).toFixed(2);
}

export default function WithdrawPage() {
  return (
    <Protected>
      <WithdrawInner />
    </Protected>
  );
}

function WithdrawInner() {
  const { player } = useAuth();
  const [rates, setRates] = useState(null);
  const [history, setHistory] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [binanceUid, setBinanceUid] = useState('');
  const [petals, setPetals] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  const balance = player?.petals || 0;
  const minPetals = rates?.minPetals || 10000;
  const petalsNum = Math.floor(Number(petals)) || 0;
  const usdPreview = rates ? (petalsNum / rates.petalsPerUsd).toFixed(2) : '0.00';
  const hasPending = (history || []).some((w) => w.status === 'pending' || w.status === 'approved');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [r, h] = await Promise.all([api.withdrawRates(), api.withdrawMine()]);
      setRates(r);
      setHistory(h.withdrawals || []);
    } catch (e) {
      setLoadError(e.message || 'Could not load withdrawal info.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');
    const cleanUid = binanceUid.trim();
    if (cleanUid.length < 4) {
      setFormError('Enter your Binance UID.');
      return;
    }
    if (!Number.isFinite(petalsNum) || petalsNum < minPetals) {
      setFormError(`Minimum withdrawal is ${minPetals.toLocaleString()} Petals ($${rates?.minUsd?.toFixed(2) || '1.00'}).`);
      return;
    }
    if (petalsNum > balance) {
      setFormError('You do not have enough Petals.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.withdrawCreate(cleanUid, petalsNum);
      sfx.levelup();
      setFormSuccess(`Request submitted — ${fmtUsd(res.usd)} will be sent to your Binance account after review.`);
      setBinanceUid('');
      setPetals('');
      await load();
    } catch (e) {
      sfx.error();
      const code = e?.code || '';
      if (code === 'below_minimum') setFormError(`Minimum withdrawal is ${minPetals.toLocaleString()} Petals.`);
      else if (code === 'insufficient_petals') setFormError('You do not have enough Petals.');
      else if (code === 'pending_exists') setFormError('You already have a withdrawal being processed. Wait for it to finish first.');
      else if (code === 'bad_binance_uid') setFormError('Enter a valid Binance UID.');
      else setFormError(e.message || 'Could not submit the request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page page-narrow">
      <h1 className="serif"><Icon name="petals" /> Withdraw Petals</h1>
      <p style={{ color: 'var(--ink-dim)', marginTop: '-0.5rem' }}>
        Turn your Petals into real money. Payouts are sent to your Binance account after a quick review.
      </p>

      {loadError && <ErrorNotice message={loadError} />}

      {!rates && !loadError && <LoadingBlock label="Loading withdrawal info" />}

      {rates && (
        <>
          <div className="stat-row" style={{ marginBottom: '1rem' }}>
            <div className="card stat-card">
              <div className="stat-label">Your balance</div>
              <div className="stat-value">{balance.toLocaleString()} <Icon name="petals" /></div>
            </div>
            <div className="card stat-card">
              <div className="stat-label">Rate</div>
              <div className="stat-value" style={{ fontSize: '1.1rem' }}>1,000 <Icon name="petals" /> = $0.10</div>
            </div>
            <div className="card stat-card">
              <div className="stat-label">Minimum</div>
              <div className="stat-value" style={{ fontSize: '1.1rem' }}>${rates.minUsd.toFixed(2)}</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <h3 className="serif" style={{ marginTop: 0 }}>Request a withdrawal</h3>
            {hasPending ? (
              <p style={{ color: 'var(--warn, #f59e0b)' }}>
                <Icon name="pending" /> You have a withdrawal being processed. You can request again once it is done.
              </p>
            ) : (
              <form onSubmit={submit}>
                <div className="field">
                  <label htmlFor="binanceUid">Binance UID</label>
                  <input
                    id="binanceUid"
                    className="input"
                    placeholder="Your Binance user ID"
                    value={binanceUid}
                    onChange={(e) => setBinanceUid(e.target.value)}
                    disabled={submitting}
                    autoComplete="off"
                  />
                  <div className="hint">Find it in your Binance app under Profile. We send your payout here.</div>
                </div>
                <div className="field">
                  <label htmlFor="petals">Petals to withdraw</label>
                  <input
                    id="petals"
                    className="input"
                    type="number"
                    min={minPetals}
                    max={balance}
                    step="1"
                    placeholder={String(minPetals)}
                    value={petals}
                    onChange={(e) => setPetals(e.target.value)}
                    disabled={submitting}
                  />
                  <div className="hint">
                    {petalsNum > 0 ? (
                      <>You will receive <strong style={{ color: 'var(--gold-soft)' }}>{fmtUsd(usdPreview)}</strong>.</>
                    ) : (
                      <>Minimum {minPetals.toLocaleString()} Petals (${rates.minUsd.toFixed(2)}).</>
                    )}
                  </div>
                </div>
                {formError && <ErrorNotice message={formError} />}
                {formSuccess && (
                  <div className="notice notice-ok" style={{ marginBottom: '0.75rem' }}>
                    <Icon name="success" /> {formSuccess}
                  </div>
                )}
                <button className="btn btn-primary" type="submit" disabled={submitting || petalsNum < minPetals}>
                  {submitting ? 'Submitting…' : 'Request withdrawal'}
                </button>
              </form>
            )}
            <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', marginBottom: 0 }}>
              Petals are deducted immediately when you request. If the request is rejected, they are refunded automatically.
            </p>
          </div>

          <h3 className="serif">Withdrawal history</h3>
          {!history ? (
            <LoadingBlock label="Loading history" />
          ) : history.length === 0 ? (
            <EmptyState
              icon="petal"
              title="No withdrawals yet"
              body="Your withdrawal requests will appear here."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {history.map((w) => (
                <div key={w.id} className="card" style={{ padding: '0.75rem 1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>
                        {w.petals.toLocaleString()} <Icon name="petals" /> → {fmtUsd(w.usd)}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--ink-dim)' }}>
                        {fmtDate(w.createdAt)} · Binance UID: {w.binanceUid}
                      </div>
                      {w.adminNote && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', marginTop: '0.2rem' }}>
                          Note: {w.adminNote}
                        </div>
                      )}
                    </div>
                    <div style={{ marginLeft: 'auto' }}>
                      <StatusBadge status={w.status} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
