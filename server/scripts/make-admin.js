'use strict';
/**
 * Grant the admin custom claim to a Firebase user:
 *
 *   node scripts/make-admin.js <uid-or-email>
 *
 * Uses application-default credentials (GOOGLE_APPLICATION_CREDENTIALS or
 * FIREBASE_SERVICE_ACCOUNT via gcloud). If the argument contains '@' it is
 * resolved to a uid with getUserByEmail first.
 */
async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: node scripts/make-admin.js <uid-or-email>');
    process.exit(1);
  }

  // Required lazily (after the usage check) so the script prints usage
  // without the dependency installed.
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }

  let uid = arg;
  if (arg.includes('@')) {
    const user = await admin.auth().getUserByEmail(arg);
    uid = user.uid;
  }
  await admin.auth().setCustomUserClaims(uid, { admin: true });
  console.log(`admin claim granted: uid=${uid}`);
}

main().catch((e) => {
  console.error('make-admin failed:', e && e.message);
  process.exit(1);
});
