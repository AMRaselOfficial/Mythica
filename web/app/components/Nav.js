'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { asset, link } from '../../lib/paths.js';
import { useAuth } from '../../contexts/AuthContext.js';
import { sfx, unlockAudio } from '../../lib/audio.js';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/hunt', label: 'Hunt' },
  { href: '/inventory', label: 'Inventory' },
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/trades', label: 'Trades' },
  { href: '/events', label: 'Events' },
  { href: '/profile', label: 'Profile' },
  { href: '/settings', label: 'Settings' },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, player, logout, configured } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  // Start audio on the very first user gesture (autoplay policy).
  useEffect(() => {
    const onGesture = () => {
      unlockAudio();
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('keydown', onGesture);
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, []);

  const handleLogout = async () => {
    sfx.click();
    await logout();
    router.push(link('/'));
  };

  const isActive = (href) => pathname === link(href) || pathname === href;

  // Close the mobile menu on navigation and on Escape.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const toggleMenu = () => {
    sfx.click();
    setMenuOpen((o) => !o);
  };

  const handleLinkClick = () => {
    sfx.click();
    setMenuOpen(false);
  };

  return (
    <nav className="nav" aria-label="Main navigation">
      <div className="nav-inner">
        <a className="brand" href={link('/')} onClick={() => sfx.click()}>
          <LogoMark />
          <span>Mythica</span>
        </a>
        {user && (
          <button
            type="button"
            className="nav-toggle"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={toggleMenu}
          >
            {menuOpen ? '✕' : '☰'}
          </button>
        )}
        {user && (
          <div className={`nav-links${menuOpen ? ' open' : ''}`} role="navigation">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={link(l.href)}
                className={isActive(l.href) ? 'active' : ''}
                onClick={handleLinkClick}
              >
                {l.label}
              </a>
            ))}
          </div>
        )}
        <div className="nav-user">
          {user && player && <span className="petals">🌸 {player.petals ?? 0}</span>}
          {user ? (
            <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
              Sign out
            </button>
          ) : (
            <>
              <a href={link('/login')} className="btn btn-ghost btn-sm">
                Sign in
              </a>
              {!configured ? null : (
                <a href={link('/signup')} className="btn btn-primary btn-sm">
                  Begin
                </a>
              )}
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

function LogoMark() {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="brand-mark">🌙</span>;
  return (
    <img
      src={asset('assets/logo/mythica-logo.webp')}
      alt=""
      aria-hidden="true"
      width={34}
      height={34}
      onError={() => setFailed(true)}
    />
  );
}
