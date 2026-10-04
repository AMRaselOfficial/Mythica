'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Protected from '../components/Protected.js';
import { ErrorNotice, EmptyState } from '../components/ui.js';
import { Icon, BigIcon } from '../components/icons.js';
import { useAuth } from '../../contexts/AuthContext.js';
import content, { rarityColor, itemById } from '../../lib/content.js';
import { api, ApiError, newIdempotencyKey } from '../../lib/api.js';
import { getApiUrl } from '../../lib/firebase.js';
import { sfx } from '../../lib/audio.js';
import { link } from '../../lib/paths.js';

const WAKE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
const HEALTH_POLL_MS = 4000;
const RARE_PLUS = ['rare', 'epic', 'legendary', 'mythic'];

function tsToMs(t) {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t.toMillis === 'function') return t.toMillis();
  return 0;
}

function fmtCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return m > 0 ? `${m}m ${String(rest).padStart(2, '0')}s` : `${rest}s`;
}

export default function HuntPage() {
  return (
    <Protected>
      <HuntInner />
    </Protected>
  );
}

function HuntInner() {
  const { player, configured } = useAuth();
  const router = useRouter();
  const [phase, setPhase] = useState('idle'); // idle|waking|hunting|result|cooldown|asleep
  const [wakeStep, setWakeStep] = useState(0); // 0 fireflies, 1 mist, 2 roar
  const [huntStep, setHuntStep] = useState(0); // 0 tracking, 1 rustling, 2 reveal
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [cooldownMs, setCooldownMs] = useState(0);
  const [showFanfare, setShowFanfare] = useState(false);
  const timers = useRef([]);
  const alive = useRef(true);

  const later = useCallback((fn, ms) => {
    const id = setTimeout(() => {
      if (alive.current) fn();
    }, ms);
    timers.current.push(id);
    return id;
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      timers.current.forEach(clearTimeout);
    };
  }, []);

  // Cooldown source of truth: server nextHuntAt (from last hunt result), or
  // player.lastHuntAt + cooldown on page load.
  const cooldownSec = content.hunt?.cooldownSec ?? 60;
  useEffect(() => {
    if (phase === 'hunting' || phase === 'waking') return;
    const last = tsToMs(player?.lastHuntAt);
    if (!last) {
      setCooldownMs(0);
      if (phase === 'cooldown') setPhase('idle');
      return;
    }
    const remaining = last + cooldownSec * 1000 - Date.now();
    if (remaining > 0) {
      setCooldownMs(remaining);
      setPhase((p) => (p === 'idle' || p === 'result' ? 'cooldown' : p));
    } else {
      setCooldownMs(0);
      if (phase === 'cooldown') setPhase('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player?.lastHuntAt]);

  // Tick the cooldown countdown each second.
  useEffect(() => {
    if (phase !== 'cooldown' && phase !== 'result') return;
    if (cooldownMs <= 0) {
      if (phase === 'cooldown') setPhase('idle');
      return;
    }
    const id = setTimeout(() => setCooldownMs((ms) => Math.max(0, ms - 1000)), 1000);
    return () => clearTimeout(id);
  }, [phase, cooldownMs]);

  const doHuntRequest = useCallback(async () => {
    setPhase('hunting');
    setHuntStep(0);
    setError('');
    // Cycle hunting phases: tracking → rustling → reveal
    const huntPhases = [later(() => setHuntStep(1), 5000), later(() => setHuntStep(2), 10000)];
    try {
      const res = await api.hunt();
      huntPhases.forEach(clearTimeout);
      setResult(res);
      setPhase('result');
      sfx.reveal();
      const drop = res.drop;
      if (drop && RARE_PLUS.includes(drop.rarity)) {
        setShowFanfare(true);
        sfx.raredrop();
        later(() => setShowFanfare(false), 7000);
      } else if (res.leveledUp) {
        sfx.levelup();
      }
      // Server nextHuntAt is the source of truth for cooldown.
      const next = typeof res.nextHuntAt === 'number' ? res.nextHuntAt : tsToMs(res.nextHuntAt);
      if (next) setCooldownMs(Math.max(0, next - Date.now()));
    } catch (err) {
      huntPhases.forEach(clearTimeout);
      sfx.error();
      if (err instanceof ApiError && err.code === 'cooldown') {
        const ms = err.retryAfterMs || 0;
        setCooldownMs(ms);
        setPhase(ms > 0 ? 'cooldown' : 'idle');
        setError('');
      } else if (err instanceof ApiError && err.code === 'unauthorized') {
        router.push('/login');
      } else {
        setError(err.message || 'The hunt failed.');
        setPhase('idle');
      }
    }
  }, [later, router]);

  const beginHunt = useCallback(() => {
    if (!getApiUrl()) {
      setError('The game server is not configured (NEXT_PUBLIC_API_URL).');
      sfx.error();
      return;
    }
    setError('');
    setResult(null);
    setPhase('waking');
    setWakeStep(0);
    sfx.click();

    const startedAt = Date.now();
    let wakeTimer = 0;

    const poll = async () => {
      if (!alive.current) return;
      const elapsed = Date.now() - startedAt;
      setWakeStep(elapsed < WAKE_TIMEOUT_MS / 3 ? 0 : elapsed < (WAKE_TIMEOUT_MS * 2) / 3 ? 1 : 2);
      try {
        const h = await api.health();
        if (h && h.ok) {
          clearTimeout(wakeTimer);
          doHuntRequest();
          return;
        }
      } catch {
        /* server still asleep — keep polling */
      }
      if (elapsed >= WAKE_TIMEOUT_MS) {
        setPhase('asleep');
        return;
      }
      wakeTimer = later(poll, HEALTH_POLL_MS);
      timers.current.push(wakeTimer);
    };
    poll();
  }, [doHuntRequest, later]);

  const busy = phase === 'waking' || phase === 'hunting';
  const cooling = phase === 'cooldown' || (cooldownMs > 0 && phase !== 'result' && phase !== 'idle');
  const disabled = busy || cooling || phase === 'asleep';

  return (
    <div className="page">
      <h1 className="serif">The Night Hunt</h1>
      <p style={{ color: 'var(--ink-dim)', maxWidth: '36rem' }}>
        The wilds beyond the treeline stir with sprites and forgotten weapons. Hunts take time —
        the forest reveals its secrets only to the patient.
      </p>

      {error && <ErrorNotice message={error} onRetry={() => setError('')} />}

      {phase === 'idle' || phase === 'cooldown' || phase === 'waking' || phase === 'hunting' ? (
        <HuntStage
          phase={phase}
          wakeStep={wakeStep}
          huntStep={huntStep}
          onBegin={beginHunt}
          disabled={disabled}
          cooldownMs={cooldownMs}
        />
      ) : null}

      {phase === 'asleep' && (
        <div className="card" style={{ textAlign: 'center', marginTop: '1rem' }}>
          <div style={{ color: 'var(--gold-soft, #d8b36a)' }}><BigIcon name="sleep" size="2.5rem" /></div>
          <h2 className="serif">The wilds are still sleeping</h2>
          <p style={{ color: 'var(--ink-dim)' }}>
            The game server did not wake after 3 minutes. It may be starting up (cold start) or
            unreachable.
          </p>
          <button className="btn btn-primary" onClick={beginHunt}>
            Try Again
          </button>
        </div>
      )}

      {phase === 'result' && result && (
        <HuntResult result={result} cooldownMs={cooldownMs} onHuntAgain={beginHunt} />
      )}

      {showFanfare && <div className="fanfare" aria-hidden="true" />}

      <div className="notice notice-info" style={{ marginTop: '1.5rem' }}>
        <strong>Hunt lore:</strong> hunts grant {content.hunt?.xpMin}–{content.hunt?.xpMax} XP, a
        chance at petals, and a {Math.round((content.hunt?.dropChance ?? 0) * 100)}% chance of a
        discovery. Cooldown: {cooldownSec}s between hunts.
      </div>
    </div>
  );
}

function HuntStage({ phase, wakeStep, huntStep, onBegin, disabled, cooldownMs }) {
  const waking = phase === 'waking';
  const hunting = phase === 'hunting';
  const animating = waking || hunting;

  const wakeLabels = [
    { title: 'Fireflies gather', sub: 'Tiny lanterns drift between the trees. Something is waking…' },
    { title: 'Mist rolls in', sub: 'The treeline dissolves into silver fog. The wilds are stirring.' },
    { title: 'A distant roar', sub: 'The ground trembles. The night is fully awake — almost there.' },
  ];
  const huntLabels = [
    { title: 'Tracking…', sub: 'You follow faint prints through the undergrowth.' },
    { title: 'Rustling…', sub: 'The bushes shiver. Something moves just ahead.' },
    { title: 'Reveal!', sub: 'The mist parts — what have you found?' },
  ];

  return (
    <div className="hunt-stage" role="status" aria-live="polite">
      {waking && wakeStep === 0 && <Fireflies />}
      {waking && wakeStep === 1 && <div className="mist" aria-hidden="true" />}
      {waking && wakeStep === 2 && (
        <>
          <div className="mist" aria-hidden="true" />
          <div className="roar-pulse" aria-hidden="true" />
        </>
      )}
      {hunting && huntStep === 0 && <TrackingMarks />}
      {hunting && huntStep === 1 && (
        <>
          <div className="rustle" aria-hidden="true" />
          <TrackingMarks />
        </>
      )}
      {hunting && huntStep === 2 && <div className="reveal-burst" aria-hidden="true" />}

      {!animating && (
        <>
          <div style={{ color: 'var(--gold-soft, #d8b36a)' }} aria-hidden="true">
            <BigIcon name="forest" size="3rem" />
          </div>
          <p className="phase-label">The treeline waits</p>
        </>
      )}
      {animating && (
        <>
          <p className="phase-label">
            {waking ? wakeLabels[wakeStep].title : huntLabels[huntStep].title}
          </p>
          <p className="phase-sub">{waking ? wakeLabels[wakeStep].sub : huntLabels[huntStep].sub}</p>
        </>
      )}

      <button
        className="btn btn-primary"
        onClick={onBegin}
        disabled={disabled}
        style={{ minWidth: '220px', zIndex: 2 }}
      >
        {waking && 'Waking the wilds…'}
        {hunting && 'Hunting…'}
        {!waking && !hunting && cooldownMs > 0 && `Next hunt in ${fmtCountdown(cooldownMs)}`}
        {!waking && !hunting && cooldownMs <= 0 && <><Icon name="moon" /> Begin Hunt</>}
      </button>
      {waking && <p className="phase-sub">Waking the server — this can take a minute on cold start.</p>}
    </div>
  );
}

function Fireflies() {
  const flies = Array.from({ length: 18 }, (_, i) => ({
    left: `${(i * 53) % 100}%`,
    top: `${15 + ((i * 37) % 70)}%`,
    delay: `${(i * 0.7) % 9}s`,
    dur: `${7 + ((i * 13) % 6)}s`,
  }));
  return (
    <div className="fireflies" aria-hidden="true">
      {flies.map((f, i) => (
        <span
          key={i}
          className="firefly"
          style={{ left: f.left, top: f.top, animationDelay: f.delay, animationDuration: f.dur }}
        />
      ))}
    </div>
  );
}

function TrackingMarks() {
  return (
    <div className="tracking-marks" aria-hidden="true">
      <span><Icon name="paw" /></span>
      <span><Icon name="paw" /></span>
      <span><Icon name="paw" /></span>
      <span><Icon name="paw" /></span>
    </div>
  );
}

function HuntResult({ result, cooldownMs, onHuntAgain }) {
  const drop = result.drop;
  const dropItem = drop ? itemById(drop.itemId) : null;
  const rarePlus = drop && RARE_PLUS.includes(drop.rarity);

  return (
    <div className="card" style={{ marginTop: '1rem', textAlign: 'center' }}>
      {rarePlus && (
        <h2 className="serif shimmer" style={{ fontSize: '2rem', margin: '0 0 0.5rem' }}>
          A RARE DISCOVERY!
        </h2>
      )}
      <h2 className="serif" style={{ marginTop: rarePlus ? 0 : undefined }}>
        The Hunt Returns
      </h2>

      <div className="stat-row" style={{ justifyContent: 'center' }}>
        <div className="stat">
          <div className="label">XP gained</div>
          <div className="value" style={{ color: 'var(--teal)' }}>
            +{result.xpGained ?? 0}
          </div>
        </div>
        <div className="stat">
          <div className="label">Petals found</div>
          <div className="value" style={{ color: 'var(--gold-soft)' }}>
            +{result.petalsFound ?? 0} <Icon name="petals" />
          </div>
        </div>
        {result.leveledUp && (
          <div className="stat">
            <div className="label">Level</div>
            <div className="value shimmer">{result.level} <Icon name="levelup" /></div>
          </div>
        )}
      </div>

      {drop ? (
        <div
          style={{
            border: `2px solid ${rarityColor(drop.rarity)}`,
            borderRadius: '12px',
            padding: '1rem',
            margin: '1rem auto',
            maxWidth: '22rem',
            background: '#0d1226',
          }}
        >
          <p className="phase-sub" style={{ marginTop: 0 }}>
            Discovery
          </p>
          <h3 className="serif" style={{ margin: '0.25rem 0' }}>
            {drop.name}
            {drop.quantity > 1 ? ` ×${drop.quantity}` : ''}
          </h3>
          <span className="rarity-tag" style={{ '--rarity': rarityColor(drop.rarity) }}>
            {drop.rarity}
          </span>
          {dropItem && (
            <p style={{ color: 'var(--ink-dim)', fontSize: '0.9rem' }}>{dropItem.description}</p>
          )}
        </div>
      ) : (
        <EmptyState icon="leaf" title="No discovery this time" body="The forest kept its secrets — but the XP is yours." />
      )}

      <button
        className="btn btn-primary"
        onClick={onHuntAgain}
        disabled={cooldownMs > 0}
        style={{ marginTop: '0.5rem' }}
      >
        {cooldownMs > 0 ? `Next hunt in ${fmtCountdown(cooldownMs)}` : <><Icon name="moon" /> Hunt Again</>}
      </button>
    </div>
  );
}
