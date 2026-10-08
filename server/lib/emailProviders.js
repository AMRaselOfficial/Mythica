'use strict';
/**
 * Verified email providers for new Mythica accounts.
 *
 * New players may only sign up with an address from a reputable mail
 * provider (Gmail, Outlook, Yahoo, Proton Mail, …). This cuts down on
 * throwaway / disposable-email spam accounts.
 *
 * Enforcement points (keep in sync):
 *  1. firestore.rules — `players/{uid}` allow create checks the domain.
 *  2. web/lib/emailProviders.js — client-side pre-check on the signup form.
 *  3. This module — server-side backup in lazy player creation (hunt/market).
 *
 * When adding a provider, update all three. tests/emailProviders.test.js
 * asserts this list matches web/lib/emailProviders.js.
 */

const ALLOWED_DOMAINS = [
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
function emailDomain(email) {
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at <= 0 || at === e.length - 1) return '';
  const domain = e.slice(at + 1);
  if (!domain || domain.includes(' ') || !domain.includes('.')) return '';
  return domain;
}

/** True when the address belongs to a verified mail provider. */
function isAllowedEmail(email) {
  return ALLOWED_SET.has(emailDomain(email));
}

/**
 * Gate for lazy server-side player creation: returns the error code when a
 * known email address is not from a verified provider, null otherwise.
 * Empty/unknown emails pass (the Firestore create rule is the primary gate).
 */
function newPlayerEmailError(email) {
  if (email && !isAllowedEmail(email)) return 'email_provider_not_allowed';
  return null;
}

module.exports = { ALLOWED_DOMAINS, emailDomain, isAllowedEmail, newPlayerEmailError };
