'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { asset, link } from '../../lib/paths.js';
import { useAuth } from '../../contexts/AuthContext.js';
import { sfx, unlockAudio } from '../../lib/audio.js';
import { Icon } from './icons.js';
import NotificationBell from './NotificationBell.js';

// Grouped menu: 14 links in 4 labelled groups, so the hamburger panel
// never becomes one long wall of links. Group order follows how players
// actually use the game: play first, then earn/trade, then community,
// then their own account.
const GROUPS = [
  {
    title: 'Play',
    links: [
      { href: '/dashboard', label: 'Dashboard', icon: 'gamepad' },
      { href: '/hunt', label: 'Hunt', icon: 'moon' },
      { href: '/inventory', label: 'Inventory', icon: 'inventory' },
    ],
  },
  {
    title: 'Trade & Earn',
    links: [
      { href: '/marketplace', label: 'Marketplace', icon: 'shop' },
      { href: '/trades', label: 'Trades', icon: 'trades' },
      { href: '/withdraw', label: 'Withdraw', icon: 'marketplace' },
      { href: '/referral', label: 'Referral', icon: 'gift' },
    ],
  },
  {
    title: 'Community',
    links: [
      { href: '/agora', label: 'Agora', icon: 'agora' },
      { href: '/veyra', label: 'Veyra', icon: 'mail' },
      { href: '/events', label: 'Events', icon: 'events' },
      { href: '/leaderboard', label: 'Leaderboard', icon: 'trophy' },
    ],
  },
  {
    title: 'You',
    links: [
      { href: '/profile', label: 'Profile', icon: 'user' },
      { href: '/support', label: 'Support', icon: 'help' },
      { href: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
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
    setMenuOpen(false);
    await logout();
    router.push('/');
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
            style={{ display: 'inline-flex' }}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="main-menu"
            onClick={toggleMenu}
          >
            {menuOpen ? <Icon name="close" /> : <Icon name="menu" />}
          </button>
        )}
        {user && (
          <div
            id="main-menu"
            className={`nav-links${menuOpen ? ' open' : ''}`}
            role="navigation"
            aria-label="Game menu"
          >
            {GROUPS.map((g) => (
              <section className="nav-group" key={g.title} aria-label={g.title}>
                <h2 className="nav-group-title">{g.title}</h2>
                {g.links.map((l) => (
                  <a
                    key={l.href}
                    href={link(l.href)}
                    className={isActive(l.href) ? 'active' : ''}
                    aria-current={isActive(l.href) ? 'page' : undefined}
                    onClick={handleLinkClick}
                  >
                    <Icon name={l.icon} size="1.1em" />
                    <span>{l.label}</span>
                  </a>
                ))}
              </section>
            ))}
            <button type="button" className="nav-signout-mobile" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        )}
        <div className="nav-user">
          {user && <NotificationBell uid={user.uid} />}
          {user && player && <span className="petals"><Icon name="petals" /> {player.petals ?? 0}</span>}
          {user ? (
            <button className="btn btn-ghost btn-sm nav-signout-desktop" onClick={handleLogout}>
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
  if (failed) return <span className="brand-mark"><Icon name="moon" /></span>;
  return (
    <img
      src={asset('assets/logo/mythica-logo.png')}
      alt=""
      aria-hidden="true"
      width={34}
      height={34}
      style={{ borderRadius: '50%', objectFit: 'cover' }}
      onError={() => setFailed(true)}
    />
  );
}
