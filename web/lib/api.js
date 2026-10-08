// Thin fetch wrapper for the Mythica game server (contract §2).
// Every /api/* call sends Authorization: Bearer <Firebase ID token>.
// Server JSON errors are surfaced as ApiError with .code (e.g. 'cooldown').
import { getFirebase, getApiUrl } from './firebase.js';

export class ApiError extends Error {
  constructor(code, message, extra) {
    super(message || code || 'Request failed');
    this.name = 'ApiError';
    this.code = code || 'unknown';
    Object.assign(this, extra);
  }
}

async function freshIdToken() {
  const fb = getFirebase();
  if (!fb?.auth?.currentUser) throw new ApiError('unauthorized', 'You are signed out.');
  return fb.auth.currentUser.getIdToken();
}

// ---- Global banned-account handling ----
// Any game-server response of 403 + error 'account_banned' triggers the
// registered handler (AuthContext shows a full-screen suspension screen and
// signs the user out). This fires mid-session as well as at login.
let bannedHandler = null;
export function onAccountBanned(fn) {
  bannedHandler = fn;
}

function checkBanned(res, data) {
  if (res && res.status === 403 && data && data.error === 'account_banned') {
    if (bannedHandler) {
      try {
        bannedHandler();
      } catch {
        /* ignore */
      }
    }
    throw new ApiError('account_banned', 'Your account has been suspended.', data);
  }
}

export async function getHealth() {
  const base = getApiUrl();
  if (!base) throw new ApiError('offline', 'Game server is not configured.');
  const res = await fetch(`${base}/health`, { cache: 'no-store' });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  checkBanned(res, data);
  if (!res.ok) throw new ApiError('offline', 'Game server is unreachable.');
  return data;
}

async function post(path, body) {
  const base = getApiUrl();
  if (!base) throw new ApiError('offline', 'Game server is not configured.');
  const token = await freshIdToken();
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body || {}),
    });
  } catch {
    throw new ApiError('network', 'Could not reach the game server. Check your connection.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  checkBanned(res, data);
  if (!res.ok || (data && data.ok === false)) {
    const code = (data && data.error) || `http_${res.status}`;
    throw new ApiError(code, friendlyMessage(code, data), data);
  }
  return data;
}

async function get(path) {
  const base = getApiUrl();
  if (!base) throw new ApiError('offline', 'Game server is not configured.');
  const token = await freshIdToken();
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError('network', 'Could not reach the game server. Check your connection.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  checkBanned(res, data);
  if (!res.ok || (data && data.ok === false)) {
    const code = (data && data.error) || `http_${res.status}`;
    throw new ApiError(code, friendlyMessage(code, data), data);
  }
  return data;
}

function friendlyMessage(code, data) {
  switch (code) {
    case 'cooldown':
      return 'The wilds need a moment to settle before your next hunt.';
    case 'email_provider_not_allowed':
      return 'New accounts need an address from a verified mail provider (Gmail, Outlook, Yahoo, Proton Mail, iCloud or another major provider).';
    case 'unauthorized':
      return 'Your session expired. Please sign in again.';
    case 'not_sellable':
      return 'This item cannot be sold.';
    case 'insufficient_quantity':
      return 'You do not own enough of that item.';
    case 'bad_price':
      return 'Enter a valid price of at least 1 petal.';
    case 'listing_unavailable':
      return 'That listing is no longer available.';
    case 'insufficient_petals':
      return 'You do not have enough petals.';
    case 'own_listing':
      return 'You cannot buy your own listing.';
    case 'not_participant':
      return 'You are not part of this trade.';
    case 'bad_state':
      return 'This trade is no longer in a completable state.';
    case 'insufficient_items':
      return 'One side no longer holds the traded items.';
    case 'not_upgradeable':
      return 'This item cannot be upgraded.';
    case 'max_level':
      return 'This item is already at max level.';
    case 'not_owned':
      return 'You do not own that item.';
    case 'not_found':
      return 'That listing could not be found.';
    case 'not_seller':
      return 'Only the seller can cancel this listing.';
    case 'bad_state':
      return 'This listing can no longer be canceled.';
    case 'account_banned':
      return 'Your account has been suspended.';
    case 'network':
      return 'Could not reach the game server. Check your connection.';
    case 'offline':
      return 'Game server is not configured.';
    default:
      return (data && data.message) || 'Something went wrong. Please try again.';
  }
}

export const api = {
  health: getHealth,
  hunt: () => post('/api/hunt', {}),
  marketList: (itemId, quantity, price) => post('/api/market/list', { itemId, quantity, price }),
  marketPurchase: (listingId, idempotencyKey) =>
    post('/api/market/purchase', { listingId, idempotencyKey }),
  marketCancel: (listingId) => post('/api/market/cancel', { listingId }),
  tradesComplete: (tradeId, idempotencyKey) =>
    post('/api/trades/complete', { tradeId, idempotencyKey }),
  upgrade: (itemId, idempotencyKey) => post('/api/upgrade', { itemId, idempotencyKey }),
  playerMe: () => get('/api/player/me'),
  playerByCode: (code) => get(`/api/players/by-code/${encodeURIComponent(code)}`),
  redeem: (code) => post('/api/redeem', { code }),
  events: () => get('/api/events'),
  eventJoin: (id) => post(`/api/events/${encodeURIComponent(id)}/join`, {}),
  eventClaim: (id) => post(`/api/events/${encodeURIComponent(id)}/claim`, {}),
  supportCreate: (title, description) => post('/api/support', { title, description }),
  supportMine: () => get('/api/support/mine'),
  supportReply: (ticketId, text) =>
    post(`/api/support/${encodeURIComponent(ticketId)}/reply`, { text }),
  supportRead: (ticketId) => post(`/api/support/${encodeURIComponent(ticketId)}/read`, {}),
};

export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
