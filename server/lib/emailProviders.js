/**
 * Verified email providers for new Mythica accounts (client-side pre-check).
 *
 * Must stay in sync with:
 *  1. server/lib/emailProviders.js (server-side backup)
 *  2. firestore.rules — `players/{uid}` allow create (the real enforcement)
 *
 * server/tests/emailProviders.test.js asserts the domain lists match.
 */

export const ALLOWED_DOMAINS = [
  // Google
  'gmail.com',
  'googlemail.com',
  // Microsoft
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'outlook.co.uk',
  'hotmail.co.uk',
  'live.co.uk',
  'outlook.de',
  'hotmail.de',
  'outlook.fr',
  'hotmail.fr',
  'outlook.es',
  'hotmail.es',
  'outlook.it',
  'hotmail.it',
  'outlook.com.br',
  'hotmail.com.br',
  // Yahoo
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.co.in',
  'yahoo.in',
  'yahoo.ca',
  'yahoo.com.au',
  'yahoo.fr',
  'yahoo.de',
  'yahoo.es',
  'yahoo.it',
  'yahoo.co.jp',
  'ymail.com',
  'rocketmail.com',
  // Proton
  'proton.me',
  'protonmail.com',
  'protonmail.ch',
  'pm.me',
  // Apple
  'icloud.com',
  'me.com',
  'mac.com',
  // AOL
  'aol.com',
  // GMX
  'gmx.com',
  'gmx.net',
  'gmx.de',
  'gmx.at',
  'gmx.ch',
  // Zoho
  'zoho.com',
  'zohomail.com',
  // Yandex
  'yandex.com',
  'yandex.ru',
  'ya.ru',
  // Mail.ru
  'mail.ru',
  'inbox.ru',
  'list.ru',
  'bk.ru',
  // Tutanota
  'tutanota.com',
  'tutanota.de',
  'tutamail.com',
  'keemail.me',
  // Fastmail
  'fastmail.com',
  'fastmail.fm',
];

const ALLOWED_SET = new Set(ALLOWED_DOMAINS);

/** Extract the lowercase domain from an email address. Empty string when invalid. */
export function emailDomain(email) {
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at <= 0 || at === e.length - 1) return '';
  const domain = e.slice(at + 1);
  if (!domain || domain.includes(' ') || !domain.includes('.')) return '';
  return domain;
}

/** True when the address belongs to a verified mail provider. */
export function isAllowedEmail(email) {
  return ALLOWED_SET.has(emailDomain(email));
}

/** Short, friendly names for the signup hint. */
export const PROVIDER_HINT = 'Gmail, Outlook, Yahoo, Proton Mail, iCloud and other major providers';
