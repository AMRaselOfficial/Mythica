'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext.js';
import { link } from '../../lib/paths.js';
import { sfx } from '../../lib/audio.js';
import { ErrorNotice } from '../components/ui.js';

export default function LoginPage() {
  const { login, configured } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email.trim(), password);
      sfx.click();
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
      <h1 className="serif">Return to the Wilds</h1>
      {!configured ? (
        <div className="notice notice-warn">
          Firebase is not configured. See <code>.env.local.example</code>.
        </div>
      ) : (
        <form className="form-card" onSubmit={submit}>
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
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <ErrorNotice message={error} />}
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
          <p style={{ marginBottom: 0 }}>
            <a href={link('/reset')}>Forgot your password?</a> · New here?{' '}
            <a href={link('/signup')}>Create an account</a>
          </p>
        </form>
      )}
    </div>
  );
}

export function friendlyAuthError(err) {
  const code = err?.code || '';
  if (code.includes('user-not-found') || code.includes('wrong-password') || code.includes('invalid-credential'))
    return 'Email or password did not match our records.';
  if (code.includes('invalid-email')) return 'That email address does not look valid.';
  if (code.includes('too-many-requests')) return 'Too many attempts — rest a moment and try again.';
  if (code.includes('email-already-in-use')) return 'An account with that email already exists.';
  if (code.includes('weak-password')) return 'Choose a password of at least 6 characters.';
  if (code.includes('network-request-failed')) return 'Network error — check your connection.';
  return err?.message || 'Sign-in failed. Please try again.';
}
