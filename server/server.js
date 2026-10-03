'use strict';
/**
 * Mythica game server — Express app.
 *
 * Auth: every /api/* request needs `Authorization: Bearer <Firebase ID token>`
 * (or `Bearer test-<uid>` when FAKE_AUTH=1).
 */
const express = require('express');
const cors = require('cors');

/** CORS origins: comma-separated list of allowed origins (scheme+host).
 * Falls back to CLIENT_URL for backwards compatibility. */
function corsOrigins() {
  const raw = (process.env.CORS_ORIGINS || process.env.CLIENT_URL || '').trim();
  if (!raw || raw === '*') return '*';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return new URL(s).origin;
      } catch {
        return s;
      }
    });
}
const { requireAuth } = require('./lib/auth');
const { rateLimit } = require('./lib/rateLimit');

const app = express();

app.set('trust proxy', true);
app.use(cors({ origin: corsOrigins() }));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'mythica-server', time: Date.now() });
});

app.use(
  '/api',
  requireAuth,
  rateLimit,
  require('./routes/hunt'),
  require('./routes/market'),
  require('./routes/trades'),
  require('./routes/upgrade'),
  require('./routes/players'),
  require('./routes/redeem'),
  require('./routes/admin')
);

app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'not_found' });
});

// Malformed JSON bodies -> 400 instead of an HTML stack trace.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: 'bad_request' });
  }
  return next(err);
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3001);
  app.listen(port, () => {
    console.log(`mythica-server listening on :${port}`);
  });
}

module.exports = app;
