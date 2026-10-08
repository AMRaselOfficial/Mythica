'use client';
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import Protected from '../components/Protected.js';
import { Modal, RarityTag, ItemImage, ArtFallback, LoadingBlock, ErrorNotice, EmptyState } from '../components/ui.js';
import { useAuth } from '../../contexts/AuthContext.js';
import content, { rarityColor, itemById, weaponPower, formatPower, starDisplay, maxUnlockedRarity } from '../../lib/content.js';
import { getFirebase } from '../../lib/firebase.js';
import { asset } from '../../lib/paths.js';
import { doc, updateDoc } from 'firebase/firestore';
import { api, newIdempotencyKey, ApiError } from '../../lib/api.js';
import { sfx } from '../../lib/audio.js';
import { Icon } from '../components/icons.js';

export default function InventoryPage() {
  return (
    <Protected>
      <InventoryInner />
    </Protected>
  );
}

function InventoryInner() {
  const { user, player } = useAuth();
  const [inv, setInv] = useState(null); // null = loading
  const [loadError, setLoadError] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [rarityFilter, setRarityFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null); // itemId

  useEffect(() => {
    if (!user) return undefined;
    const fb = getFirebase();
    if (!fb) return undefined;
    const unsub = onSnapshot(
      collection(fb.db, 'inventories', user.uid, 'items'),
      (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ itemId: d.id, ...d.data() }));
        setInv(rows);
      },
      () => setLoadError('Could not load your inventory.')
    );
    return unsub;
  }, [user]);

  const entries = useMemo(() => {
    if (!inv) return [];
    return inv
      .map((row) => ({ def: itemById(row.itemId), row }))
      .filter((e) => e.def)
      .filter((e) => typeFilter === 'all' || e.def.type === typeFilter)
      .filter((e) => rarityFilter === 'all' || e.def.rarity === rarityFilter)
      .filter(
        (e) =>
          !search ||
          e.def.name.toLowerCase().includes(search.toLowerCase()) ||
          (e.def.tags || []).some((t) => t.toLowerCase().includes(search.toLowerCase()))
      )
      .sort((a, b) => a.def.name.localeCompare(b.def.name));
  }, [inv, typeFilter, rarityFilter, search]);

  return (
    <div className="page">
      <h1 className="serif">Inventory</h1>

      <div className="toolbar" role="toolbar" aria-label="Inventory filters">
        {['all', 'sprite', 'weapon', 'material'].map((t) => (
          <button
            key={t}
            className="chip"
            aria-pressed={typeFilter === t}
            onClick={() => {
              sfx.click();
              setTypeFilter(t);
            }}
          >
            {t === 'all' ? 'All' : t === 'sprite' ? 'Sprites' : t === 'weapon' ? 'Weapons' : 'Materials'}
          </button>
        ))}
        <select
          className="input"
          aria-label="Filter by rarity"
          value={rarityFilter}
          onChange={(e) => setRarityFilter(e.target.value)}
        >
          <option value="all">All rarities</option>
          {content.rarities.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <input
          className="input"
          type="search"
          placeholder="Search name or tag…"
          aria-label="Search inventory"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loadError && <ErrorNotice message={loadError} />}
      {!inv && !loadError && <LoadingBlock label="Opening your satchel" />}

      {inv && entries.length === 0 && (
        <EmptyState
          icon="inventory"
          title="Nothing here yet"
          body={
            inv.length === 0
              ? 'Your satchel is empty — head to the Hunt to find your first discovery.'
              : 'No items match these filters.'
          }
        />
      )}

      <div className="grid">
        {entries.map(({ def, row }) => (
          <button
            key={def.id}
            className="item-card"
            style={{ '--rarity': rarityColor(def.rarity) }}
            onClick={() => {
              sfx.click();
              setSelected(def.id);
            }}
            aria-label={`View ${def.name}`}
          >
            <div className="art">
              <ItemImage item={def} />
              <ArtFallback type={def.type} />
            </div>
            <div className="meta">
              <p className="name">
                {def.name}
                {def.type === 'weapon' && (row.stars || 0) > 0 && (
                  <span style={{ color: 'var(--gold)' }}> {starDisplay(row.stars)}</span>
                )}
              </p>
              <RarityTag rarity={def.rarity} />{' '}
              <span className="qty-badge">
                ×{row.quantity}
                {row.upgradeLevel > 0 ? ` · Lv ${row.upgradeLevel + 1}` : ''}
                {def.type === 'weapon' ? ` · ${formatPower(weaponPower(def, row.upgradeLevel || 0, row.stars || 0))} pw` : ''}
              </span>
              {def.type === 'weapon' && player?.equippedWeaponId === def.id && (
                <span className="rarity-tag" style={{ '--rarity': 'var(--success)', marginTop: '0.25rem' }}>
                  Equipped
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <ItemDetailModal
          itemId={selected}
          invRow={(inv || []).find((r) => r.itemId === selected)}
          inv={inv || []}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function ItemDetailModal({ itemId, invRow, inv, onClose }) {
  const def = itemById(itemId);
  const { player, user } = useAuth();
  const [tab, setTab] = useState('info'); // info|sell|upgrade
  const [price, setPrice] = useState(def ? String(Math.max(1, def.baseValue || 1)) : '1');
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgKind, setMsgKind] = useState('info');

  if (!def) return null;
  const owned = invRow?.quantity ?? 0;
  const level = (invRow?.upgradeLevel ?? 0) + 1;
  const canUpgradeMore = def.upgradeable && level < def.maxLevel;
  const nextCost = canUpgradeMore ? def.upgradeCosts[level - 1] : null;
  const nextMats = canUpgradeMore ? def.upgradeMaterials?.[level - 1] || [] : [];
  const matOwned = (id) => (inv || []).find((r) => r.itemId === id)?.quantity ?? 0;
  const matsReady = nextMats.every((m) => matOwned(m.id) >= (m.qty || 0));
  const canAfford = (player?.petals ?? 0) >= (nextCost ?? 0) && matsReady;

  const say = (kind, text) => {
    setMsgKind(kind);
    setMsg(text);
  };

  const doList = async () => {
    setBusy(true);
    say('info', '');
    try {
      const q = parseInt(qty, 10);
      const p = parseInt(price, 10);
      const res = await api.marketList(itemId, q, p);
      say('info', `Listed for sale! Listing ${res.listingId.slice(0, 8)}…`);
      sfx.purchase();
      onClose();
    } catch (err) {
      sfx.error();
      say('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const doUpgrade = async () => {
    setBusy(true);
    say('info', '');
    try {
      const res = await api.upgrade(itemId, newIdempotencyKey());
      say('info', `Upgraded to level ${res.newLevel + 1}!`);
      sfx.upgrade();
    } catch (err) {
      sfx.error();
      say('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleFavorite = async () => {
    const fb = getFirebase();
    if (!fb || !user) return;
    setBusy(true);
    try {
      const isFav = player?.favoriteItemId === itemId;
      await updateDoc(doc(fb.db, 'players', user.uid), {
        favoriteItemId: isFav ? '' : itemId,
      });
      sfx.click();
      say('info', isFav ? 'Removed from favorites.' : 'Marked as your favorite discovery!');
    } catch (err) {
      sfx.error();
      say('error', 'Could not update favorite.');
    } finally {
      setBusy(false);
    }
  };

  const isWeapon = def.type === 'weapon';
  const stars = invRow?.stars || 0;
  const power = isWeapon ? weaponPower(def, level - 1, stars) : 0;
  const equipped = player?.equippedWeaponId === itemId;
  const maxStars = (content.weaponPower || {}).maxStars || 6;
  const canMerge = isWeapon && owned >= 2 && stars < maxStars;

  const doEquip = async () => {
    setBusy(true);
    say('info', '');
    try {
      await api.equipWeapon(itemId);
      sfx.upgrade();
      say('info', `${def.name} equipped for hunts.`);
      onClose();
    } catch (err) {
      sfx.error();
      say('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const doMerge = async () => {
    setBusy(true);
    say('info', '');
    try {
      const res = await api.mergeWeapon(itemId);
      sfx.upgrade();
      say('info', `Merged! Now ${starDisplay(res.stars)} (${formatPower(res.power)} power).`);
      onClose();
    } catch (err) {
      sfx.error();
      say('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={def.name} onClose={onClose}>
      <img className="art-large" src={asset(def.image)} alt={def.name}
        style={{ '--rarity': rarityColor(def.rarity) }}
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
      <p style={{ margin: '0.75rem 0' }}>
        <RarityTag rarity={def.rarity} />{' '}
        <span className="qty-badge">
          {def.type} · owned ×{owned} · level {level}/{def.maxLevel}
        </span>
      </p>
      <p style={{ color: 'var(--ink-dim)' }}>{def.description}</p>
      {isWeapon && (
        <p className="qty-badge" style={{ fontSize: '1rem' }}>
          Power <strong style={{ color: 'var(--gold-soft)' }}>{formatPower(power)}</strong>
          {stars > 0 && <span style={{ color: 'var(--gold)' }}> · {starDisplay(stars)}</span>}
          {equipped && <span style={{ color: 'var(--success)' }}> · Equipped</span>}
        </p>
      )}
      {isWeapon && !equipped && (
        <button className="btn btn-sm" disabled={busy} onClick={doEquip} style={{ marginBottom: '0.5rem' }}>
          <Icon name="sword" /> Equip for Hunts
        </button>
      )}
      {def.stats && (
        <p className="qty-badge">
          Power {def.stats.power} · Spirit {def.stats.spirit}
        </p>
      )}
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={toggleFavorite}>
        {player?.favoriteItemId === itemId ? <><Icon name="star" style={{ fill: 'currentColor' }} /> Favorited</> : <><Icon name="star" /> Mark as Favorite</>}
      </button>

      <div className="toolbar" role="tablist" aria-label="Item actions">
        {['info', 'sell', 'upgrade', ...(isWeapon ? ['merge'] : [])].map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className="chip"
            aria-pressed={tab === t}
            onClick={() => {
              sfx.click();
              setTab(t);
              say('info', '');
            }}
          >
            {t === 'info' ? 'Details' : t === 'sell' ? 'List for Sale' : t === 'upgrade' ? 'Upgrade' : 'Merge'}
          </button>
        ))}
      </div>

      {msg && (
        <div className={msgKind === 'error' ? 'notice notice-error' : 'notice notice-info'} role={msgKind === 'error' ? 'alert' : 'status'}>
          {msg}
        </div>
      )}

      {tab === 'sell' && (
        <div>
          {!def.sellable ? (
            <p style={{ color: 'var(--ink-dim)' }}>This item cannot be sold on the marketplace.</p>
          ) : (
            <>
              <div className="field">
                <label htmlFor="qty">Quantity (you own {owned})</label>
                <input id="qty" className="input" type="number" min="1" max={owned} value={qty}
                  onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="price">Price (petals)</label>
                <input id="price" className="input" type="number" min="1" value={price}
                  onChange={(e) => setPrice(e.target.value)} />
              </div>
              <button className="btn btn-primary" disabled={busy} onClick={doList}>
                {busy ? 'Listing…' : 'List for Sale'}
              </button>
            </>
          )}
        </div>
      )}

      {tab === 'upgrade' && (
        <div>
          {!def.upgradeable ? (
            <p style={{ color: 'var(--ink-dim)' }}>This item cannot be upgraded.</p>
          ) : !canUpgradeMore ? (
            <p style={{ color: 'var(--gold-soft)' }}>Already at max level ({def.maxLevel}).</p>
          ) : (
            <>
              <p>
                Upgrade to level {level + 1} for{' '}
                <strong style={{ color: 'var(--gold-soft)' }}>{nextCost} <Icon name="petals" /></strong>. You hold{' '}
                {player?.petals ?? 0} petals.
              </p>
              {nextMats.length > 0 && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Materials needed:</div>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {nextMats.map((m) => {
                      const mDef = itemById(m.id);
                      const have = matOwned(m.id);
                      const need = m.qty || 0;
                      const ok = have >= need;
                      return (
                        <li
                          key={m.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            padding: '0.25rem 0',
                            color: ok ? 'inherit' : 'var(--danger, #e35d6a)',
                          }}
                        >
                          <span>{mDef ? mDef.name : m.id}</span>
                          <span>
                            {have}/{need} <Icon name={ok ? 'check' : 'close'} />
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {!matsReady && (
                    <p className="muted" style={{ fontSize: '0.85rem' }}>
                      Hunt for upgrade materials to gather what you lack.
                    </p>
                  )}
                </div>
              )}
              <button
                className="btn btn-primary"
                disabled={busy || !canAfford}
                onClick={doUpgrade}
              >
                {busy ? 'Upgrading…' : `Upgrade to Lv ${level + 1}`}
              </button>
            </>
          )}
        </div>
      )}
      {tab === 'merge' && isWeapon && (
        <div>
          <p>
            Merge a duplicate <strong>{def.name}</strong> into this one to add a star and boost its power.
          </p>
          <p className="qty-badge" style={{ fontSize: '1rem' }}>
            Current: {stars > 0 ? starDisplay(stars) : 'no stars'} · {formatPower(power)} power
          </p>
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.9rem' }}>
            You own ×{owned}. Merging consumes one copy. Max {starDisplay(maxStars)} ({maxStars} stars).
            Each star multiplies power by 1.5×.
          </p>
          {!canMerge ? (
            <p style={{ color: 'var(--gold-soft)' }}>
              {stars >= maxStars ? `Already at max stars (${starDisplay(maxStars)}).` : 'You need at least 2 copies to merge.'}
            </p>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={doMerge}>
              {busy ? 'Merging…' : `Merge → ${starDisplay(stars === 0 ? 2 : stars + 1)}`}
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
