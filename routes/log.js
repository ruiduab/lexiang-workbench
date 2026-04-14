const express = require('express');
const router = express.Router();
const db = require('../db/schema');

// POST /api/log  — frontend error/event reporting
router.post('/', (req, res) => {
  const { type = 'error', message, stack, url, extra } = req.body;
  const sessionId = req.sessionID || req.headers['x-session-id'] || 'anon';
  try {
    db.prepare(
      'INSERT INTO fe_logs (type, message, stack, url, extra, session_id) VALUES (?,?,?,?,?,?)'
    ).run(
      String(type).slice(0, 32),
      message ? String(message).slice(0, 1000) : null,
      stack   ? String(stack).slice(0, 2000)   : null,
      url     ? String(url).slice(0, 500)       : null,
      extra   ? JSON.stringify(extra).slice(0, 2000) : null,
      sessionId
    );
  } catch (e) {
    // never let logging break the response
  }
  res.json({ ok: true });
});

module.exports = router;
