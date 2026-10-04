'use client';
import { useEffect, useState } from 'react';
import content, { rarityColor } from '../lib/content.js';
import { asset, link } from '../lib/paths.js';
import { useAuth } from '../contexts/AuthContext.js';
import { sfx } from '../lib/audio.js';
import { Icon, BigIcon } from './components/icons.js';

const FEATURES = [
  {
    icon: 'forest',
    title: 'Hunt the Night Wilds',
    body: 'Venture into the mist and track sprites and weapons. Every hunt is a gamble against the dark — rare finds await the patient.',
  },
  {
    icon: 'sword',
    title: 'Collect & Upgrade',
    body: 'Build a collection of sprites and weapons. Temper blades at the forge and raise their power through the ranks.',
  },
  {
    icon: 'trades',
    title: 'Trade & Barter',
    body: 'List finds on the marketplace or strike direct trades with fellow travelers. Petals are the coin of the realm.',
  },
];

export default function LandingPage() {
  const { user, configured } = useAuth();
  const [logoOk, setLogoOk] = useState(true);
  const [bgOk, setBgOk] = useState(true);

  return (
    <div className="page">
      <section className="hero">
        {logoOk ? (
          <img
            className="hero-logo"
            src={asset('assets/logo/mythica-logo.webp')}
            alt="Mythica emblem"
            onError={() => setLogoOk(false)}
          />
        ) : (
          <div style={{ color: 'var(--gold-soft, #d8b36a)' }} aria-hidden="true">
            <BigIcon name="moon" size="3.5rem" />
          </div>
        )}
        <h1>Mythica</h1>
        <p className="tagline">
          The night wilds are waking. Hunt for sprites and weapons, grow your collection, trade with
          fellow travelers, and carve your legend into the dark.
        </p>
        <div className="hero-cta">
          {user ? (
            <a href={link('/dashboard')} className="btn btn-primary" onClick={() => sfx.click()}>
              Enter the Wilds
            </a>
          ) : (
            <>
              <a href={link('/signup')} className="btn btn-primary" onClick={() => sfx.click()}>
                Begin Your Tale
              </a>
              <a href={link('/login')} className="btn" onClick={() => sfx.click()}>
                Sign In
              </a>
            </>
          )}
        </div>
        {!configured && (
          <div className="notice notice-warn" style={{ maxWidth: '34rem', margin: '1.5rem auto 0' }}>
            <strong>Setup needed:</strong> Firebase is not configured yet. Copy{' '}
            <code>.env.local.example</code> to <code>.env.local</code> and fill in your project
            values.
          </div>
        )}
      </section>

      <section className="feature-row" aria-label="Game features">
        {FEATURES.map((f) => (
          <div className="card" key={f.title}>
            <div style={{ color: 'var(--gold-soft, #d8b36a)' }} aria-hidden="true">
              <BigIcon name={f.icon} size="2rem" />
            </div>
            <h3 className="serif">{f.title}</h3>
            <p style={{ color: 'var(--ink-dim)', marginBottom: 0 }}>{f.body}</p>
          </div>
        ))}
      </section>

      <section style={{ marginTop: '2.5rem' }}>
        <h2 className="serif" style={{ textAlign: 'center' }}>
          Denizens of the Dark
        </h2>
        <p style={{ textAlign: 'center', color: 'var(--ink-dim)' }}>
          A glimpse of what stirs beyond the treeline.
        </p>
        <div className="grid">
          {content.items
            .filter((i) => i.active !== false)
            .slice(0, 6)
            .map((item) => (
              <ItemTeaser key={item.id} item={item} />
            ))}
        </div>
      </section>
    </div>
  );
}

function ItemTeaser({ item }) {
  const [ok, setOk] = useState(true);
  return (
    <div className="item-card" style={{ '--rarity': rarityColor(item.rarity), cursor: 'default' }}>
      <div className="art">
        {ok ? (
          <img src={asset(item.image)} alt={item.name} loading="lazy" onError={() => setOk(false)} />
        ) : (
          <span className="art-fallback" aria-hidden="true">
            <Icon name={item.type === 'weapon' ? 'swords' : 'sparkles'} />
          </span>
        )}
      </div>
      <div className="meta">
        <p className="name">{item.name}</p>
        <span className="rarity-tag" style={{ '--rarity': rarityColor(item.rarity) }}>
          {item.rarity}
        </span>
      </div>
    </div>
  );
}
