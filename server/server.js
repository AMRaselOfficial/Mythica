'use strict';
/**
 * Mythica game server — Express app.
 *
 * Auth: every /api/* request needs `Authorization: Bearer <Firebase ID token>`
 * (or `Bearer test-<uid>` when FAKE_AUTH=1).
 */
const express = require('express');
const cors = require('cors');

/** CORS origin must be scheme+host only; strip any path from CLIENT_URL. */
function corsOrigin() {
  const raw = (process.env.CLIENT_URL || '').trim();
  if (!raw || raw === '*') return '*';
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
}
const { requireAuth } = require('./lib/auth');
const { rateLimit } = require('./lib/rateLimit');

const app = express();

app.set('trust proxy', true);
app.use(cors({ origin: corsOrigin() }));
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
