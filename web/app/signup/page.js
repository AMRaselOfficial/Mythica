'use client';
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext.js';
import { link } from '../../lib/paths.js';
import { sfx } from '../../lib/audio.js';
import { ErrorNotice } from '../components/ui.js';
import { friendlyAuthError } from '../login/page.js';
import { isAllowedEmail, PROVIDER_HINT } from '../../lib/emailProviders.js';

export default function SignupPage() {
  const { signup, configured } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [busy, setBusy] = useState(false);

  // Pre-fill referral code from ?r= URL param (e.g. /signup?r=J9MDNY)
  useEffect(() => {
    const code = searchParams?.get('r');
    if (code) setReferralCode(code.trim().toUpperCase().slice(0, 6));
  }, [searchParams]);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const cleanEmail = email.trim();
    if (!isAllowedEmail(cleanEmail)) {
      sfx.error();
      setError(
        `Please sign up with an address from a verified mail provider (${PROVIDER_HINT}).`
      );
      return;
    }
    setBusy(true);
    try {
      await signup(cleanEmail, password, displayName.trim(), referralCode.trim());
      sfx.levelup();
      router.push('/dashboard');
    } catch (err) {
      sfx.error();
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-narrow">
      <h1 className="serif">Begin Your Tale</h1>
      <p style={{ color: 'var(--ink-dim)' }}>
        New travelers start with <strong style={{ color: 'var(--gold-soft)' }}>20 petals</strong>,
        level 1, and an empty satchel waiting to be filled.
      </p>
      {!configured ? (
        <div className="notice notice-warn">
          Firebase is not configured. See <code>.env.local.example</code>.
        </div>
      ) : (
        <form className="form-card" onSubmit={submit}>
          <div className="field">
            <label htmlFor="displayName">Traveler name</label>
            <input
              id="displayName"
              className="input"
              type="text"
              autoComplete="nickname"
              maxLength={40}
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Ashen Wanderer"
            />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="referralCode">Invitation code (optional)</label>
            <input
              id="referralCode"
              className="input"
              type="text"
              autoComplete="off"
              maxLength={6}
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
              placeholder="e.g. X8BL09"
              style={{ textTransform: 'uppercase' }}
            />
            <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', marginTop: '0.25rem', marginBottom: 0 }}>
              Enter a friend's code to get <strong style={{ color: 'var(--gold-soft)' }}>50 petals free</strong>.
            </p>
          </div>
          {error && <ErrorNotice message={error} />}
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Kindling your lantern…' : 'Create Account'}
          </button>
          <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
            We accept addresses from verified mail providers ({PROVIDER_HINT}).
          </p>
          <p style={{ marginBottom: 0 }}>
            Already wander these woods? <a href={link('/login')}>Sign in</a>
          </p>
        </form>
      )}
    </div>
  );
}
