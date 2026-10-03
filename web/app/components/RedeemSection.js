'use client';
import { useState } from 'react';
import { api, ApiError } from '../../lib/api.js';
import { sfx } from '../../lib/audio.js';

const ERROR_TEXT = {
  invalid_code: 'That code does not exist. Check the spelling and try again.',
  inactive: 'This code is no longer active.',
  expired: 'This code has expired.',
  limit_reached: 'This code has reached its redemption limit.',
  already_redeemed: 'You have already redeemed this code.',
};

function formatRewards(r) {
  const parts = [];
  if (r.petals > 0) parts.push(`🌸 ${r.petals} petals`);
  if (r.xp > 0) parts.push(`✨ ${r.xp} XP`);
  for (const it of r.items || []) {
    parts.push(`🎁 ${it.quantity}× ${it.name}`);
  }
  if (r.leveledUp) parts.push(`🎉 Level up! Now level ${r.level}`);
  return parts.length ? parts.join(' · ') : 'Redeemed!';
}

/**
 * RedeemSection — promotional code redemption, shown at the bottom of the
 * player's own profile. Each account can redeem a given code only once
 * (enforced server-side).
 */
export default function RedeemSection() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, text }

  const redeem = async (e) => {
    e.preventDefault();
    const clean = code.trim();
    if (!clean || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const out = await api.redeem(clean);
      sfx.click();
      setResult({ ok: true, text: formatRewards(out.rewards || {}) });
      setCode('');
    } catch (err) {
      sfx.error();
      const key = err instanceof ApiError ? err.code : '';
      setResult({ ok: false, text: ERROR_TEXT[key] || 'Could not redeem this code.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <div className="card">
        <h2 className="serif" style={{ marginTop: 0 }}>
          🎟️ Redeem Code
        </h2>
        <p className="muted" style={{ marginTop: '-0.25rem', fontSize: '0.9rem' }}>
          Have a promotional code? Enter it below to claim your rewards. Each
          code can be redeemed once per account.
        </p>
        <form onSubmit={redeem} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: '180px', textTransform: 'uppercase' }}
            placeholder="ENTER-CODE"
            value={code}
            maxLength={32}
            onChange={(e) => setCode(e.target.value)}
            disabled={busy}
            aria-label="Promotional code"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn btn-primary" type="submit" disabled={busy || !code.trim()}>
            {busy ? 'Redeeming…' : 'Redeem'}
          </button>
        </form>
        {result && (
          <p
            style={{
              marginBottom: 0,
              marginTop: '0.75rem',
              color: result.ok ? 'var(--success, #7dd87d)' : 'var(--danger, #ff7b7b)',
              fontWeight: 600,
            }}
          >
            {result.ok ? '✅ ' : '⚠️ '}{result.text}
          </p>
        )}
      </div>
    </section>
  );
}
