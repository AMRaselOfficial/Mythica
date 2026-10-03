'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext.js';
import { link } from '../../lib/paths.js';

// Wraps protected pages: shows a friendly "not configured" or signed-out
// state, and redirects to /login when signed out.
export default function Protected({ children }) {
  const { configured, user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && configured && !user) router.replace(link('/login'));
  }, [loading, configured, user, router]);

  if (loading) {
    return (
      <div className="page page-narrow">
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="spinner" role="status" aria-label="Loading" />
          <p className="loading-dots">Consulting the stars</p>
        </div>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="page page-narrow">
        <div className="notice notice-warn" role="alert">
          <h2 className="serif">Mythica is not configured</h2>
          <p>
            The Firebase connection details are missing. Add them to your{' '}
            <code>.env.local</code> (see <code>.env.local.example</code>) and rebuild.
          </p>
        </div>
      </div>
    );
  }

  if (!user) return null;
  return children;
}
