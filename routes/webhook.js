// GitHub webhook 自动部署
// POST /api/webhook/github  →  HMAC 校验 → 后台执行 deploy.sh
const router = require('express').Router();
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

function verifySignature(rawBody, signatureHeader) {
  if (!SECRET || !signatureHeader) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', SECRET)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signatureHeader)
    );
  } catch {
    return false;
  }
}

router.post('/github', (req, res) => {
  if (!SECRET) {
    return res.status(500).json({ error: 'GITHUB_WEBHOOK_SECRET not configured' });
  }

  if (!req.rawBody) {
    return res.status(500).json({ error: 'rawBody not captured' });
  }

  const sig = req.headers['x-hub-signature-256'];
  if (!verifySignature(req.rawBody, sig)) {
    return res.status(401).json({ error: 'invalid signature' });
  }

  const event = req.headers['x-github-event'];
  if (event === 'ping') {
    return res.json({ ok: true, msg: 'pong' });
  }
  if (event !== 'push') {
    return res.json({ ok: true, ignored: `event=${event}` });
  }

  const ref = req.body && req.body.ref;
  if (ref !== 'refs/heads/main') {
    return res.json({ ok: true, ignored: `ref=${ref}` });
  }

  const commit = req.body.head_commit && req.body.head_commit.id ? req.body.head_commit.id.slice(0, 7) : '?';
  const author = req.body.head_commit && req.body.head_commit.author ? req.body.head_commit.author.name : '?';
  console.log(`[webhook] deploy triggered: ${commit} by ${author}`);

  // detached spawn：deploy.sh 会触发 pm2 reload，必须脱离当前进程
  const logFd = fs.openSync('/tmp/lexiang-deploy.log', 'a');
  const child = spawn('bash', ['/root/lexiang/scripts/deploy.sh'], {
    detached: true,
    stdio: ['ignore', logFd, logFd]
  });
  child.unref();

  res.json({ ok: true, deploying: true, commit, author });
});

// 健康检查（便于人工验证 webhook 端点可达）
router.get('/github', (req, res) => {
  res.json({
    ok: true,
    secret_configured: !!SECRET,
    hint: 'POST GitHub webhook payload here'
  });
});

module.exports = router;
