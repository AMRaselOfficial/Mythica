'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import Protected from '../components/Protected.js';
import { RarityTag, LoadingBlock, ErrorNotice, EmptyState } from '../components/ui.js';
import { Icon } from '../components/icons.js';
import { useAuth } from '../../contexts/AuthContext.js';
import content, { itemById, rarityColor } from '../../lib/content.js';
import { getFirebase } from '../../lib/firebase.js';
import { api, newIdempotencyKey, ApiError } from '../../lib/api.js';
import { sfx } from '../../lib/audio.js';

export default function TradesPage() {
  return (
    <Protected>
      <TradesInner />
    </Protected>
  );
}

function TradesInner() {
  const { user } = useAuth();
  const [trades, setTrades] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    const fb = getFirebase();
    if (!fb) return undefined;
    const col = collection(fb.db, 'trades');
    // NOTE: no orderBy here — where+orderBy on different fields needs a
    // Firestore composite index. The merge() below sorts client-side instead
    // (same pattern as the Veyra chat list).
    const qBy = query(col, where('offeredBy', '==', user.uid));
    const qTo = query(col, where('offeredTo', '==', user.uid));
    let a = [],
      b = [];
    const merge = () => {
      const map = new Map();
      [...a, ...b].forEach((t) => map.set(t.id, t));
      setTrades([...map.values()].sort((x, y) => (y.createdAtMs || 0) - (x.createdAtMs || 0)));
    };
    const toMs = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : 0);
    const un1 = onSnapshot(
      qBy,
      (s) => {
        a = s.docs.map((d) => ({ id: d.id, ...d.data(), createdAtMs: toMs(d.data().createdAt) }));
        merge();
      },
      () => setError('Could not load trades.')
    );
    const un2 = onSnapshot(
      qTo,
      (s) => {
        b = s.docs.map((d) => ({ id: d.id, ...d.data(), createdAtMs: toMs(d.data().createdAt) }));
        merge();
      },
      () => setError('Could not load trades.')
    );
    return () => {
      un1();
      un2();
    };
  }, [user]);

  const incoming = useMemo(
    () => (trades || []).filter((t) => t.offeredTo === user?.uid),
    [trades, user]
  );
  const outgoing = useMemo(
    () => (trades || []).filter((t) => t.offeredBy === user?.uid),
    [trades, user]
  );

  const act = async (trade, fn, okMsg) => {
    setBusyId(trade.id);
    setNotice('');
    try {
      await fn();
      sfx.click();
      if (okMsg) setNotice(okMsg);
    } catch (e) {
      sfx.error();
      setNotice(e.message || 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  const accept = (t) =>
    act(t, async () => {
      const fb = getFirebase();
      await updateDoc(doc(fb.db, 'trades', t.id), { status: 'accepted', acceptedAt: serverTimestamp() });
    }, 'Trade accepted! Complete it to swap items.');

  const decline = (t) =>
    act(t, async () => {
      const fb = getFirebase();
      await updateDoc(doc(fb.db, 'trades', t.id), { status: 'canceled' });
    });

  const cancel = decline;

  const complete = (t) =>
    act(t, async () => {
      const res = await api.tradesComplete(t.id, newIdempotencyKey());
      if (res && res.ok === false) throw new ApiError(res.error, res.message);
      sfx.purchase();
      setNotice('Trade completed — items swapped!');
    });

  return (
    <div className="page">
      <h1 className="serif">Trades</h1>
      <p style={{ color: 'var(--ink-dim)' }}>
        Strike a bargain directly with another traveler. Both sides confirm, then the swap is sealed
        by the game server.
      </p>

      {notice && (
        <div className="notice notice-info" role="status">
          {notice}
        </div>
      )}
      {error && <ErrorNotice message={error} />}

      <CreateOffer />

      {trades === null && !error && <LoadingBlock label="Reading the trade winds" />}

      {trades !== null && (
        <>
          <h2 className="serif">Incoming Offers ({incoming.length})</h2>
          {incoming.length === 0 ? (
            <EmptyState icon="inbox" title="No incoming offers" body="When someone offers you a trade, it will appear here." />
          ) : (
            <div className="row-list">
              {incoming.map((t) => (
                <TradeCard
                  key={t.id}
                  trade={t}
                  incoming
                  busy={busyId === t.id}
                  onAccept={() => accept(t)}
                  onDecline={() => decline(t)}
                  onComplete={() => complete(t)}
                />
              ))}
            </div>
          )}

          <h2 className="serif" style={{ marginTop: '2rem' }}>
            Outgoing Offers ({outgoing.length})
          </h2>
          {outgoing.length === 0 ? (
            <EmptyState icon="send" title="No outgoing offers" body="Propose a trade above to get started." />
          ) : (
            <div className="row-list">
              {outgoing.map((t) => (
                <TradeCard
                  key={t.id}
                  trade={t}
                  busy={busyId === t.id}
                  onCancel={() => cancel(t)}
                  onComplete={() => complete(t)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TradeCard({ trade, incoming, busy, onAccept, onDecline, onCancel, onComplete }) {
  const offerDef = itemById(trade.offerItemId);
  const wantDef = itemById(trade.wantItemId);
  const statusLabel = {
    offered: 'Awaiting response',
    accepted: 'Accepted — ready to complete',
    completed: 'Completed',
    canceled: 'Canceled',
  }[trade.status];

  return (
    <div className="row-item">
      <div className="grow">
        <p className="title">
          <ItemName def={offerDef} id={trade.offerItemId} qty={trade.offerQty} />{' '}
          <span aria-hidden="true">⇄</span>{' '}
          <ItemName def={wantDef} id={trade.wantItemId} qty={trade.wantQty} />
        </p>
        <p className="sub">
          {incoming ? `From ${shortUid(trade.offeredBy)}` : `To ${shortUid(trade.offeredTo)}`} ·{' '}
          {statusLabel}
        </p>
      </div>
      {trade.status === 'offered' && incoming && (
        <>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={onAccept}>
            Accept
          </button>
          <button className="btn btn-danger btn-sm" disabled={busy} onClick={onDecline}>
            Decline
          </button>
        </>
      )}
      {trade.status === 'offered' && !incoming && (
        <button className="btn btn-danger btn-sm" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      )}
      {trade.status === 'accepted' && (
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={onComplete}>
          {busy ? 'Completing…' : 'Complete Trade'}
        </button>
      )}
    </div>
  );
}

function ItemName({ def, id, qty }) {
  return (
    <span style={{ '--rarity': rarityColor(def?.rarity) }}>
      {qty > 1 ? `${qty}× ` : ''}
      {def ? def.name : id} {def && <RarityTag rarity={def.rarity} />}
    </span>
  );
}

function shortUid(uid) {
  return uid ? `${String(uid).slice(0, 8)}…` : 'unknown';
}

function CreateOffer() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [inv, setInv] = useState([]);
  const [offerItemId, setOfferItemId] = useState('');
  const [offerQty, setOfferQty] = useState('1');
  const [wantItemId, setWantItemId] = useState('');
  const [wantQty, setWantQty] = useState('1');
  const [offeredTo, setOfferedTo] = useState('');
  const [recipient, setRecipient] = useState(null); // { uid, displayName, playerCode }
  const [lookupBusy, setLookupBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !user) return undefined;
    const fb = getFirebase();
    if (!fb) return undefined;
    const unsub = onSnapshot(collection(fb.db, 'inventories', user.uid, 'items'), (snap) => {
      const rows = [];
      snap.forEach((d) => rows.push({ itemId: d.id, ...d.data() }));
      const tradable = rows.filter((r) => {
        const def = itemById(r.itemId);
        return def && def.tradable && r.quantity > 0;
      });
      setInv(tradable);
      if (tradable.length && !offerItemId) setOfferItemId(tradable[0].itemId);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user]);

  const lookupRecipient = async () => {
    const code = offeredTo.trim().toUpperCase();
    if (!code) {
      setError('Enter the recipient’s traveler code.');
      return;
    }
    setLookupBusy(true);
    setError('');
    setRecipient(null);
    try {
      const res = await api.playerByCode(code);
      if (res.uid === user.uid) {
        throw new Error('You cannot trade with yourself.');
      }
      setRecipient(res);
      sfx.click();
    } catch (err) {
      sfx.error();
      setError(err.code === 'not_found' ? 'No traveler found with that code.' : (err.message || 'Lookup failed.'));
    } finally {
      setLookupBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (!recipient) throw new Error('Look up the recipient’s traveler code first.');
      const to = recipient.uid;
      if (to === user.uid) throw new Error('You cannot trade with yourself.');
      const fb = getFirebase();
      await addDoc(collection(fb.db, 'trades'), {
        offeredBy: user.uid,
        offeredTo: to,
        offerItemId,
        offerQty: parseInt(offerQty, 10),
        wantItemId,
        wantQty: parseInt(wantQty, 10),
        status: 'offered',
        createdAt: serverTimestamp(),
      });
      sfx.click();
      setOpen(false);
      setOfferedTo('');
      setRecipient(null);
    } catch (err) {
      sfx.error();
      setError(err.message || 'Could not create the offer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      {!open ? (
        <button className="btn btn-primary" onClick={() => { sfx.click(); setOpen(true); }}>
          + Propose Trade
        </button>
      ) : (
        <form onSubmit={submit}>
          <h3 className="serif" style={{ marginTop: 0 }}>
            Propose a trade
          </h3>
          {inv.length === 0 ? (
            <p style={{ color: 'var(--ink-dim)' }}>You own nothing tradable right now.</p>
          ) : (
            <>
              <div className="field">
                <label htmlFor="tr-to">Recipient traveler code</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    id="tr-to"
                    className="input"
                    value={offeredTo}
                    onChange={(e) => { setOfferedTo(e.target.value); setRecipient(null); }}
                    placeholder="e.g. X8BL09"
                    maxLength={6}
                    style={{ textTransform: 'uppercase', fontFamily: 'monospace', letterSpacing: '0.1em' }}
                    required
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={lookupRecipient}
                    disabled={lookupBusy}
                  >
                    {lookupBusy ? '…' : 'Find'}
                  </button>
                </div>
                {recipient && (
                  <p style={{ color: 'var(--gold-soft)', marginTop: '0.5rem' }}>
                    <Icon name="check" /> {recipient.displayName} (Level {recipient.level})
                  </p>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="field">
                  <label htmlFor="tr-offer">You offer</label>
                  <select id="tr-offer" className="input" value={offerItemId}
                    onChange={(e) => setOfferItemId(e.target.value)}>
                    {inv.map((r) => (
                      <option key={r.itemId} value={r.itemId}>
                        {itemById(r.itemId)?.name} (×{r.quantity})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="tr-offerqty">Qty</label>
                  <input id="tr-offerqty" className="input" type="number" min="1" value={offerQty}
                    onChange={(e) => setOfferQty(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="tr-want">You want</label>
                  <select id="tr-want" className="input" value={wantItemId}
                    onChange={(e) => setWantItemId(e.target.value)}>
                    <option value="">— choose —</option>
                    <TradeableOptions />
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="tr-wantqty">Qty</label>
                  <input id="tr-wantqty" className="input" type="number" min="1" value={wantQty}
                    onChange={(e) => setWantQty(e.target.value)} />
                </div>
              </div>
              {error && <ErrorNotice message={error} />}
              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <button className="btn btn-primary" type="submit" disabled={busy || !wantItemId}>
                  {busy ? 'Sending…' : 'Send Offer'}
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

function TradeableOptions() {
  // Data-driven: every tradable, active content item is a possible "want".
  return (
    <>
      {content.items
        .filter((i) => i.active !== false && i.tradable)
        .map((i) => (
          <option key={i.id} value={i.id}>
            {i.name} ({i.rarity})
          </option>
        ))}
    </>
  );
}
