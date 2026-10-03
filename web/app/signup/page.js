'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext.js';
import { link } from '../../lib/paths.js';
import { sfx } from '../../lib/audio.js';
import { ErrorNotice } from '../components/ui.js';
import { friendlyAuthError } from '../login/page.js';

export default function SignupPage() {
  const { signup, configured } = useAuth();
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signup(email.trim(), password, displayName.trim());
      sfx.levelup();
      router.push(link('/dashboard'));
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
          {error && <ErrorNotice message={error} />}
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Kindling your lantern…' : 'Create Account'}
          </button>
          <p style={{ marginBottom: 0 }}>
            Already wander these woods? <a href={link('/login')}>Sign in</a>
          </p>
        </form>
      )}
    </div>
  );
}
