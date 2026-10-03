'use client';
import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import Protected from '../components/Protected.js';
import { LoadingBlock, ErrorNotice, EmptyState } from '../components/ui.js';
import content from '../../lib/content.js';
import { getFirebase } from '../../lib/firebase.js';
import { EventBanner } from '../dashboard/page.js';

export default function EventsPage() {
  return (
    <Protected>
      <EventsInner />
    </Protected>
  );
}

function EventsInner() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const fb = getFirebase();
    if (!fb) {
      // No Firestore — fall back to bundled content events.
      setEvents(content.events || []);
      return;
    }
    (async () => {
      try {
        const snap = await getDocs(query(collection(fb.db, 'events'), orderBy('startAt', 'desc')));
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setEvents(rows.length ? rows : content.events || []);
      } catch {
        setError('Could not reach the event board — showing tale records instead.');
        setEvents(content.events || []);
      }
    })();
  }, []);

  return (
    <div className="page">
      <h1 className="serif">Events</h1>
      <p style={{ color: 'var(--ink-dim)' }}>
        Seasonal stirrings in the realm — limited-time hunts and rewards.
      </p>

      {error && <ErrorNotice message={error} />}
      {!events && <LoadingBlock label="Reading the event board" />}
      {events && events.length === 0 && (
        <EmptyState icon="📜" title="No events" body="The realm is quiet for now. Check back soon." />
      )}
      {events && events.length > 0 && (
        <div className="grid-cards">
          {events.map((e) => (
            <EventBanner key={e.id || e.title} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}
