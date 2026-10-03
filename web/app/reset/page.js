'use client';
import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.js';
import { link } from '../../lib/paths.js';
import { sfx } from '../../lib/audio.js';
import { ErrorNotice } from '../components/ui.js';
import { friendlyAuthError } from '../login/page.js';

export default function ResetPage() {
  const { resetPassword, configured } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await resetPassword(email.trim());
      setSent(true);
      sfx.click();
    } catch (err) {
      sfx.error();
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-narrow">
      <h1 className="serif">Recover Your Path</h1>
      {!configured ? (
        <div className="notice notice-warn">
          Firebase is not configured. See <code>.env.local.example</code>.
        </div>
      ) : sent ? (
        <div className="notice notice-info" role="status">
          <p>
            If an account exists for <strong>{email}</strong>, a password-reset letter is on its
            way. Check your inbox (and the spam thicket).
          </p>
          <a href={link('/login')}>Back to sign in</a>
        </div>
      ) : (
        <form className="form-card" onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Account email</label>
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
          {error && <ErrorNotice message={error} />}
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Sending…' : 'Send Reset Link'}
          </button>
          <p style={{ marginBottom: 0 }}>
            <a href={link('/login')}>Back to sign in</a>
          </p>
        </form>
      )}
    </div>
  );
}
