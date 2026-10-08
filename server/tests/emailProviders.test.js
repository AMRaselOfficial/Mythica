'use strict';
/**
 * Verified email provider tests.
 * - emailDomain / isAllowedEmail / newPlayerEmailError behavior
 * - server allowlist matches web/lib/emailProviders.js (client pre-check)
 * - server allowlist matches the firestore.rules inline list (real enforcement)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ALLOWED_DOMAINS,
  emailDomain,
  isAllowedEmail,
  newPlayerEmailError,
} = require('../lib/emailProviders');

test('emailDomain extracts lowercase domains, rejects malformed input', () => {
  assert.equal(emailDomain('Ash@GMAIL.com'), 'gmail.com');
  assert.equal(emailDomain('  user@outlook.com  '), 'outlook.com');
  assert.equal(emailDomain('user+tag@yahoo.com'), 'yahoo.com');
  assert.equal(emailDomain('a@b@c.com'), 'c.com');
  assert.equal(emailDomain('no-at-sign'), '');
  assert.equal(emailDomain('@nodomain'), '');
  assert.equal(emailDomain('user@'), '');
  assert.equal(emailDomain('user@nodot'), '');
  assert.equal(emailDomain(''), '');
  assert.equal(emailDomain(null), '');
});

test('isAllowedEmail accepts the named verified providers', () => {
  for (const email of [
    'traveler@gmail.com',
    'traveler@googlemail.com',
    'traveler@outlook.com',
    'traveler@hotmail.com',
    'traveler@live.com',
    'traveler@yahoo.com',
    'traveler@ymail.com',
    'traveler@proton.me',
    'traveler@protonmail.com',
    'traveler@pm.me',
    'traveler@icloud.com',
    'traveler@aol.com',
    'traveler@gmx.de',
    'traveler@zoho.com',
    'traveler@yandex.ru',
    'traveler@mail.ru',
    'traveler@tutanota.com',
    'traveler@fastmail.fm',
  ]) {
    assert.equal(isAllowedEmail(email), true, email);
  }
});

test('isAllowedEmail rejects disposable, custom and lookalike domains', () => {
  for (const email of [
    'traveler@mailinator.com',
    'traveler@tempmail.com',
    'traveler@10minutemail.com',
    'traveler@guerrillamail.com',
    'traveler@mycompany.com',
    'traveler@mythica.test',
    'traveler@gmail.com.evil.com',
    'traveler@notgmail.com',
    'traveler@mail.gmail.com',
    'plainstring',
    '',
  ]) {
    assert.equal(isAllowedEmail(email), false, email);
  }
});

test('newPlayerEmailError gates only known disallowed addresses', () => {
  assert.equal(newPlayerEmailError('a@gmail.com'), null);
  assert.equal(newPlayerEmailError('a@mailinator.com'), 'email_provider_not_allowed');
  assert.equal(newPlayerEmailError(''), null);
  assert.equal(newPlayerEmailError(null), null);
  assert.equal(newPlayerEmailError(undefined), null);
});

function extractQuotedList(source, startMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `marker not found: ${startMarker}`);
  const end = source.indexOf('];', start);
  const body = source.slice(start, end);
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((s) => s.includes('.'));
}

test('server allowlist matches the web client allowlist', () => {
  const webPath = path.join(__dirname, '..', '..', 'web', 'lib', 'emailProviders.js');
  const webSource = fs.readFileSync(webPath, 'utf8');
  const webDomains = extractQuotedList(webSource, 'ALLOWED_DOMAINS = [');
  assert.deepEqual([...ALLOWED_DOMAINS].sort(), [...webDomains].sort());
});

test('server allowlist matches the firestore.rules inline list', () => {
  const rulesPath = path.join(__dirname, '..', '..', 'firestore.rules');
  const rulesSource = fs.readFileSync(rulesPath, 'utf8');
  const rulesDomains = extractQuotedList(rulesSource, 'return domain in [');
  assert.deepEqual([...ALLOWED_DOMAINS].sort(), [...rulesDomains].sort());
});
