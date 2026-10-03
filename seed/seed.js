/**
 * Mythica content seeder — writes the developer-managed catalog to Firestore.
 *
 * Reads ../content/mythica-content.json and upserts:
 *   items/{itemId}, events/{eventId}, achievements/{achievementId},
 *   gameSettings/live
 *
 * Idempotent: safe to run multiple times (uses set with merge).
 *
 * Usage (from the repo root):
 *   cd seed && npm install
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node seed.js
 *
 * The service-account key is Rasel's private Firebase credential.
 * Never commit it, never paste it into the web app.
 */
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

async function main() {
  const contentPath = path.resolve(__dirname, '..', 'content', 'mythica-content.json');
  const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
  const db = admin.firestore();
  const batch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();

  let counts = { items: 0, events: 0, achievements: 0 };

  for (const item of content.items) {
    batch.set(db.collection('items').doc(item.id), { ...item, seededAt: now }, { merge: true });
    counts.items++;
  }
  for (const ev of content.events || []) {
    const { startAt, endAt, ...rest } = ev;
    batch.set(
      db.collection('events').doc(ev.id),
      { ...rest, startAt: new Date(startAt), endAt: new Date(endAt), seededAt: now },
      { merge: true }
    );
    counts.events++;
  }
  for (const ach of content.achievements || []) {
    batch.set(db.collection('achievements').doc(ach.id), { ...ach, seededAt: now }, { merge: true });
    counts.achievements++;
  }
  batch.set(
    db.collection('gameSettings').doc('live'),
    {
      contentVersion: content.settings?.contentVersion ?? content.version ?? 1,
      huntCooldownSec: content.settings?.huntCooldownSec ?? content.hunt?.cooldownSec ?? 60,
      startingPetals: content.settings?.startingPetals ?? 20,
      maintenance: false,
      seededAt: now,
    },
    { merge: true }
  );

  await batch.commit();
  console.log(`Seeded ${counts.items} items, ${counts.events} events, ${counts.achievements} achievements + gameSettings/live`);
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
