'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  limit,
  orderBy,
  query,
  startAfter,
} from 'firebase/firestore';
import Protected from '../components/Protected.js';
import { RarityTag, LoadingBlock, ErrorNotice, EmptyState } from '../components/ui.js';
import { useAuth } from '../../contexts/AuthContext.js';
import content, { rarityColor, itemById } from '../../lib/content.js';
import { getFirebase } from '../../lib/firebase.js';
import { asset } from '../../lib/paths.js';
import { api, newIdempotencyKey, ApiError } from '../../lib/api.js';
import { sfx } from '../../lib/audio.js';

const PAGE_SIZE = 12;

export default function MarketplacePage() {
  return (
    <Protected>
      <MarketInner />
    </Protected>
  );
}

function MarketInner() {
  const { user, player } = useAuth();
  const [listings, setListings] = useState(null);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingBuy, setPendingBuy] = useState(null); // listingId
  const [notice, setNotice] = useState('');

  const loadPage = useCallback(
    async (reset) => {
      const fb = getFirebase();
      if (!fb) return;
      setLoading(true);
      setError('');
      try {
        // Ordered by creation; status filtered client-side to avoid a composite index.
        const parts = [collection(fb.db, 'marketplace'), orderBy('createdAt', 'desc')];
        if (!reset && lastDoc) parts.push(startAfter(lastDoc));
        parts.push(limit(PAGE_SIZE + 1));
        const qq = query(...parts);
        const { getDocs } = await import('firebase/firestore');
        const snap = await getDocs(qq);
        const docs = snap.docs;
        setHasMore(docs.length > PAGE_SIZE);
        const page = docs.slice(0, PAGE_SIZE);
        setLastDoc(page.length ? page[page.length - 1] : null);
        const rows = page.map((d) => ({ id: d.id, ...d.data() }));
        setListings((prev) => (reset ? rows : [...(prev || []), ...rows]));
      } catch (e) {
        setError('Could not load the marketplace.');
      } finally {
        setLoading(false);
      }
    },
    [lastDoc]
  );

  useEffect(() => {
    loadPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = useMemo(
    () => (listings || []).filter((l) => l.status === 'active'),
    [listings]
  );
  const mine = useMemo(
    () => active.filter((l) => l.sellerUid === user?.uid),
    [active, user]
  );
  const others = useMemo(
    () => active.filter((l) => l.sellerUid !== user?.uid),
    [active, user]
  );

  const buy = async (listing) => {
    setPendingBuy(listing.id);
    setNotice('');
    try {
      const res = await api.marketPurchase(listing.id, newIdempotencyKey());
      sfx.purchase();
      setNotice(`You bought ${res.quantity > 1 ? res.quantity + '× ' : ''}${itemById(res.itemId)?.name || 'item'} for ${res.price} 🌸!`);
      setListings((prev) => (prev || []).filter((l) => l.id !== listing.id));
    } catch (err) {
      sfx.error();
      setNotice(err.message || 'Purchase failed.');
      if (err instanceof ApiError && err.code === 'listing_unavailable') {
        setListings((prev) => (prev || []).filter((l) => l.id !== listing.id));
      }
    } finally {
      setPendingBuy(null);
    }
  };

  const cancel = async (listing) => {
    if (!confirm(`Cancel your listing for "${itemById(listing.itemId)?.name || listing.itemId}"? Your items will be returned to your satchel.`)) return;
    try {
      await api.marketCancel(listing.id);
      sfx.click();
      setNotice('Listing canceled — items returned to your satchel.');
      setListings((prev) => (prev || []).filter((l) => l.id !== listing.id));
    } catch (e) {
      sfx.error();
      setNotice(e.message || 'Could not cancel the listing.');
    }
  };

  return (
    <div className="page">
      <h1 className="serif">Marketplace</h1>
      <p style={{ color: 'var(--ink-dim)' }}>
        Fellow travelers list their finds here. You hold{' '}
        <strong style={{ color: 'var(--gold-soft)' }}>{player?.petals ?? 0} 🌸</strong>.
      </p>

      {notice && (
        <div className="notice notice-info" role="status">
          {notice}
        </div>
      )}
      {error && <ErrorNotice message={error} onRetry={() => loadPage(true)} />}

      <CreateListing onListed={() => loadPage(true)} />

      <h2 className="serif">My Listings ({mine.length})</h2>
      {mine.length === 0 ? (
        <EmptyState icon="🏷️" title="No active listings" body="List something from your inventory to earn petals." />
      ) : (
        <div className="row-list">
          {mine.map((l) => (
            <ListingRow key={l.id} listing={l} mine onCancel={() => cancel(l)} />
          ))}
        </div>
      )}

      <h2 className="serif" style={{ marginTop: '2rem' }}>
        Browse Listings
      </h2>
      {listings === null && loading && <LoadingBlock label="Browsing the stalls" />}
      {others.length === 0 && listings !== null && !loading && (
        <EmptyState icon="🪙" title="The stalls are empty" body="No one is selling right now. Check back after the next hunt." />
      )}
      <div className="row-list">
        {others.map((l) => (
          <ListingRow
            key={l.id}
            listing={l}
            buying={pendingBuy === l.id}
            canAfford={(player?.petals ?? 0) >= l.price}
            onBuy={() => buy(l)}
          />
        ))}
      </div>

      {hasMore && listings !== null && (
        <div className="pagination">
          <button className="btn" onClick={() => loadPage(false)} disabled={loading}>
            {loading ? 'Loading…' : 'Show more'}
          </button>
        </div>
      )}
    </div>
  );
}

function ListingRow({ listing, mine, buying, canAfford, onBuy, onCancel }) {
  const def = itemById(listing.itemId);
  return (
    <div className="row-item" style={{ '--rarity': rarityColor(def?.rarity) }}>
      {def ? (
        <img
          className="thumb"
          src={asset(def.image)}
          alt={def.name}
          loading="lazy"
          onError={(e) => (e.currentTarget.style.display = 'none')}
        />
      ) : (
        <span className="thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>❓</span>
      )}
      <div className="grow">
        <p className="title">
          {def?.name || listing.itemId} {listing.quantity > 1 ? `×${listing.quantity}` : ''}
        </p>
        <p className="sub">
          {def && <RarityTag rarity={def.rarity} />} {listing.price} 🌸
          {!mine && <span> · seller {String(listing.sellerUid || '').slice(0, 8)}…</span>}
        </p>
      </div>
      {mine ? (
        <button className="btn btn-danger btn-sm" onClick={onCancel}>
          Cancel
        </button>
      ) : (
        <button
          className="btn btn-primary btn-sm"
          onClick={onBuy}
          disabled={buying || !canAfford}
          title={!canAfford ? 'Not enough petals' : 'Buy this listing'}
        >
          {buying ? 'Buying…' : `Buy · ${listing.price} 🌸`}
        </button>
      )}
    </div>
  );
}

function CreateListing({ onListed }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [inv, setInv] = useState([]);
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('10');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !user?.uid) return undefined;
    let unsub;
    try {
      const fb = getFirebase();
      if (!fb?.db) return undefined;
      unsub = onSnapshot(
        collection(fb.db, 'inventories', user.uid, 'items'),
        (snap) => {
          try {
            const rows = [];
            snap.forEach((d) => rows.push({ itemId: d.id, ...d.data() }));
            const sellable = rows.filter((r) => {
              const def = itemById(r.itemId);
              return def && def.sellable && r.quantity > 0;
            });
            setInv(sellable);
            if (sellable.length && !itemId) setItemId(sellable[0].itemId);
          } catch (e) {
            console.error('Inventory snapshot error:', e);
          }
        },
        (err) => {
          console.error('Inventory listener error:', err);
          setError('Could not load your inventory.');
        }
      );
    } catch (e) {
      console.error('Failed to setup inventory listener:', e);
      setError('Could not load your inventory.');
    }
    return () => {
      if (unsub) unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.marketList(itemId, parseInt(qty, 10), parseInt(price, 10));
      sfx.purchase();
      setOpen(false);
      setQty('1');
      setPrice('10');
      onListed();
    } catch (err) {
      sfx.error();
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      {!open ? (
        <button className="btn btn-primary" onClick={() => { sfx.click(); setOpen(true); }}>
          + Create Listing
        </button>
      ) : (
        <form onSubmit={submit}>
          <h3 className="serif" style={{ marginTop: 0 }}>
            List an item for sale
          </h3>
          {inv.length === 0 ? (
            <div style={{ color: 'var(--ink-dim)' }}>
              <p style={{ margin: '0 0 0.5rem' }}>You own nothing sellable right now.</p>
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
                Every item you find on hunts can be listed for sale — Moss Wisp, Ember Fox,
                Thornblade, and Starfall Hammer. Head out on a hunt to stock your pack, then
                come back here to list your finds.
              </p>
              <a className="btn btn-primary btn-sm" href={asset('/hunt')}>
                Go Hunting
              </a>
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="mk-item">Item</label>
                <select id="mk-item" className="input" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  {inv.map((r) => {
                    const def = itemById(r.itemId);
                    return (
                      <option key={r.itemId} value={r.itemId}>
                        {def?.name} (×{r.quantity})
                      </option>
                    );
                  })}
                </select>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div className="field" style={{ flex: 1, minWidth: '120px' }}>
                  <label htmlFor="mk-qty">Quantity</label>
                  <input id="mk-qty" className="input" type="number" min="1" value={qty}
                    onChange={(e) => setQty(e.target.value)} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: '120px' }}>
                  <label htmlFor="mk-price">Price (petals)</label>
                  <input id="mk-price" className="input" type="number" min="1" value={price}
                    onChange={(e) => setPrice(e.target.value)} />
                </div>
              </div>
              {error && <ErrorNotice message={error} />}
              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <button className="btn btn-primary" type="submit" disabled={busy}>
                  {busy ? 'Listing…' : 'List for Sale'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </form>
      )}
    </div>
  );
}
