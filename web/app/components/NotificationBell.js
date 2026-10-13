'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getFirebase } from '../../lib/firebase.js';
import { link } from '../../lib/paths.js';
import { Icon } from './icons.js';
import { sfx } from '../../lib/audio.js';

const TYPE_META = {
  friend_request: { icon: 'users', label: 'Friend request', color: '#60a5fa' },
  friend_accepted: { icon: 'users', label: 'Friend accepted', color: '#60a5fa' },
  admin_message: { icon: 'shield', label: 'Admin message', color: '#f87171' },
  event_update: { icon: 'events', label: 'Event update', color: '#fbbf24' },
  support_reply: { icon: 'mail', label: 'Support reply', color: '#2dd4bf' },
  system_update: { icon: 'bell', label: 'System update', color: '#a78bfa' },
};

function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const now = Date.now();
  const diff = now - ms;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

/**
 * Notification bell for the header. Shows unread count badge, dropdown panel
 * with real-time notifications. Bell types: friend requests, admin messages,
 * event updates, support replies, system updates. Veyra private messages are
 * NOT shown here (device push only, visible in Veyra).
 */
export default function NotificationBell({ uid }) {
  const router = useRouter();
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const panelRef = useRef(null);
  const prevUnreadRef = useRef(0);

  useEffect(() => {
    if (!uid) return undefined;
    let unsub = null;
    try {
      const { db } = getFirebase();
      const q = query(
        collection(db, 'notifications'),
        where('uid', '==', uid),
        limit(30)
      );
      unsub = onSnapshot(
        q,
        (snap) => {
          const items = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          setNotifications(items);
          const unread = items.filter((n) => !n.read).length;
          // Play a subtle sound when a new unread notification arrives.
          if (unread > prevUnreadRef.current && prevUnreadRef.current > 0) {
            try { sfx.notification(); } catch { /* ignore */ }
          }
          prevUnreadRef.current = unread;
        },
        () => { /* ignore snapshot errors */ }
      );
    } catch {
      /* firebase not configured */
    }
    return () => { if (unsub) unsub(); };
  }, [uid]);

  // Close on outside tap / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open ]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markOneRead = async (n) => {
    if (n.read) return;
    try {
      const { db } = getFirebase();
      await updateDoc(doc(db, 'notifications', n.id), { read: true });
    } catch { /* ignore */ }
  };

  const markAllRead = async () => {
    const unread = notifications.filter((n) => !n.read);
    if (!unread.length || markingAll) return;
    setMarkingAll(true);
    try {
      const { db } = getFirebase();
      const batch = writeBatch(db);
      unread.forEach((n) => batch.update(doc(db, 'notifications', n.id), { read: true }));
      await batch.commit();
    } catch { /* ignore */ }
    finally { setMarkingAll(false); }
  };

  const handleClick = async (n) => {
    await markOneRead(n);
    setOpen(false);
    if (n.link) router.push(link(n.link));
  };

  if (!uid) return null;

  return (
    <div className="notif-bell-wrap" ref={panelRef}>
      <button
        type="button"
        className="notif-bell-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
      >
        <Icon name="bell" />
        {unreadCount > 0 && (
          <span className="notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-panel-head">
            <strong>Notifications</strong>
            {unreadCount > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={markAllRead}
                disabled={markingAll}
              >
                {markingAll ? 'Marking…' : 'Mark all read'}
              </button>
            )}
          </div>
          <div className="notif-list">
            {notifications.length === 0 && (
              <p className="muted" style={{ padding: '1rem', textAlign: 'center' }}>
                No notifications yet.
              </p>
            )}
            {notifications.map((n) => {
              const meta = TYPE_META[n.type] || TYPE_META.system_update;
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`notif-item${n.read ? '' : ' notif-unread'}`}
                  onClick={() => handleClick(n)}
                >
                  <span className="notif-icon"><Icon name={meta.icon} /></span>
                  <span className="notif-body">
                    <span className="notif-title-row">
                      <span className="notif-cat" style={{ background: meta.color + '22', color: meta.color, borderColor: meta.color + '44' }}>
                        {meta.label}
                      </span>
                    </span>
                    <span className="notif-title">{n.title}</span>
                    <span className="notif-text">{n.body}</span>
                    <span className="notif-time">{fmtTime(n.createdAt)}</span>
                  </span>
                  {!n.read && <span className="notif-dot" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
