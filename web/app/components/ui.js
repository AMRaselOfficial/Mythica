'use client';
import { useEffect } from 'react';
import { rarityColor } from '../../lib/content.js';
import { asset } from '../../lib/paths.js';

export function RarityTag({ rarity }) {
  return (
    <span className="rarity-tag" style={{ '--rarity': rarityColor(rarity) }}>
      {rarity}
    </span>
  );
}

// Item art with a graceful glyph fallback when the art file is absent.
export function ItemImage({ item, className, large }) {
  if (!item) return null;
  return (
    <img
      src={asset(item.image)}
      alt={item.name}
      className={className}
      style={large ? { '--rarity': rarityColor(item.rarity) } : undefined}
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.display = 'none';
        const f = e.currentTarget.nextElementSibling;
        if (f) f.style.display = 'block';
      }}
    />
  );
}

export function ArtFallback({ type, style }) {
  return (
    <span className="art-fallback" style={{ display: 'none', ...style }} aria-hidden="true">
      {type === 'weapon' ? '⚔️' : '✨'}
    </span>
  );
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="serif" style={{ margin: 0 }}>
            {title}
          </h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        <div style={{ marginTop: '1rem' }}>{children}</div>
      </div>
    </div>
  );
}

export function LoadingBlock({ label }) {
  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <div className="spinner" role="status" aria-label={label || 'Loading'} />
      <p className="loading-dots">{label || 'Loading'}</p>
    </div>
  );
}

export function ErrorNotice({ message, onRetry }) {
  return (
    <div className="notice notice-error" role="alert">
      <p style={{ margin: '0 0 0.75rem' }}>{message || 'Something went wrong.'}</p>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, body }) {
  return (
    <div className="empty">
      <div style={{ fontSize: '2.2rem', marginBottom: '0.5rem' }}>{icon || '🌑'}</div>
      <h3 className="serif" style={{ margin: '0 0 0.4rem' }}>
        {title}
      </h3>
      {body && <p style={{ margin: 0 }}>{body}</p>}
    </div>
  );
}
