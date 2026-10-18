/**
 * Firebase Cloud Messaging service worker for Mythica web push.
 * Handles background push notifications (e.g., Veyra private messages
 * when the tab is closed). Clicking a notification opens the linked page.
 *
 * The Firebase config is injected at build time via query params on the
 * service worker registration (see lib/push.js). For the compat build we
 * read it from the URL.
 */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

(function init() {
  let config = null;
  try {
    // The registration URL carries ?config=<base64 json>
    const u = new URL(self.location.href);
    const raw = u.searchParams.get('config');
    if (raw) config = JSON.parse(atob(raw));
  } catch (e) {
    // no config — messaging stays uninitialized
  }
  if (!config || !config.apiKey) return;

  firebase.initializeApp(config);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const title = (payload.notification && payload.notification.title) || 'Mythica';
    const body = (payload.notification && payload.notification.body) || 'You have a new message.';
    const link = (payload.data && payload.data.link) || '/veyra';
    self.registration.showNotification(title, {
      body,
      icon: '/assets/logo.png',
      data: { link },
      tag: 'mythica-veyra',
    });
  });

  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const link = (event.notification.data && event.notification.data.link) || '/veyra';
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        for (const c of clients) {
          if (c.url.includes(link) && 'focus' in c) return c.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(link);
        return undefined;
      })
    );
  });
})();
