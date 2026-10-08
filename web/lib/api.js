import { auth } from './firebase.js';

const BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

async function idToken() {
  if (!auth || !auth.currentUser) throw new Error('not_signed_in');
  return auth.currentUser.getIdToken(true);
}

export function apiBase() {
  return BASE_URL;
}

/** Throw a friendly Error from a failed API response. */
export async function apiFetch(path, { method = 'GET', body } = {}) {
  if (!BASE_URL) throw new Error('VITE_API_URL is not configured.');
  const token = await idToken();
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the API server. Check VITE_API_URL and your network.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const code = data && data.error;
    if (res.status === 401) throw new Error('Session expired. Please sign in again.');
    if (res.status === 403 && code === 'forbidden')
      throw Object.assign(new Error('forbidden'), { forbidden: true });
    throw new Error((data && (data.error || data.message)) || `Request failed (${res.status}).`);
  }
  return data;
}

export const admin = {
  me: () => apiFetch('/api/admin/me'),
  stats: () => apiFetch('/api/admin/stats'),
  users: ({ search = '', limit = 25, pageToken } = {}) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (search) q.set('search', search);
    if (pageToken) q.set('pageToken', pageToken);
    return apiFetch(`/api/admin/users?${q.toString()}`);
  },
  user: (uid) => apiFetch(`/api/admin/users/${encodeURIComponent(uid)}`),
  ban: (uid) => apiFetch(`/api/admin/users/${encodeURIComponent(uid)}/ban`, { method: 'POST' }),
  unban: (uid) => apiFetch(`/api/admin/users/${encodeURIComponent(uid)}/unban`, { method: 'POST' }),
  addItem: (uid, itemId, quantity) =>
    apiFetch(`/api/admin/users/${encodeURIComponent(uid)}/inventory/add`, {
      method: 'POST',
      body: { itemId, quantity },
    }),
  removeItem: (uid, itemId, quantity) =>
    apiFetch(`/api/admin/users/${encodeURIComponent(uid)}/inventory/remove`, {
      method: 'POST',
      body: { itemId, quantity },
    }),
  redeemCodes: () => apiFetch('/api/admin/redeem-codes'),
  redeemCreate: (payload) =>
    apiFetch('/api/admin/redeem-codes', { method: 'POST', body: payload }),
  redeemUpdate: (code, payload) =>
    apiFetch(`/api/admin/redeem-codes/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      body: payload,
    }),
  redeemDelete: (code) =>
    apiFetch(`/api/admin/redeem-codes/${encodeURIComponent(code)}`, {
      method: 'DELETE',
    }),
  events: () => apiFetch('/api/admin/events'),
  eventCreate: (payload) =>
    apiFetch('/api/admin/events', { method: 'POST', body: payload }),
  eventUpdate: (id, payload) =>
    apiFetch(`/api/admin/events/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: payload,
    }),
  eventDelete: (id) =>
    apiFetch(`/api/admin/events/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  eventJoins: (id) =>
    apiFetch(`/api/admin/events/${encodeURIComponent(id)}/joins`),
  supportTickets: (status = '') =>
    apiFetch(`/api/admin/support${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  supportUnreadCount: () => apiFetch('/api/admin/support/unread-count'),
  supportTicket: (id) => apiFetch(`/api/admin/support/${encodeURIComponent(id)}`),
  supportReply: (id, text) =>
    apiFetch(`/api/admin/support/${encodeURIComponent(id)}/reply`, {
      method: 'POST',
      body: { text },
    }),
  supportStatus: (id, status) =>
    apiFetch(`/api/admin/support/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      body: { status },
    }),
  supportRead: (id) =>
    apiFetch(`/api/admin/support/${encodeURIComponent(id)}/read`, { method: 'POST' }),
};
