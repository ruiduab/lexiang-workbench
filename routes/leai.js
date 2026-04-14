const express = require('express');
const router = express.Router();

const AIGC_BASE = 'https://aigc.lenovo.com.cn/v3';
const HEADERS = {
  'Origin': 'https://leai.lenovo.com.cn',
  'Referer': 'https://leai.lenovo.com.cn/'
};

// GET /api/leai/auth — 获取 guest session token
router.get('/auth', async (req, res) => {
  try {
    const resp = await fetch(`${AIGC_BASE}/api/user/auth?${Date.now()}&device=1`, { headers: HEADERS });
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/leai/faq — FAQ热门问题
router.get('/faq', async (req, res) => {
  try {
    const resp = await fetch(`${AIGC_BASE}/api/chat/faq`, { headers: HEADERS });
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/leai/chat — SSE流式对话代理
router.post('/chat', async (req, res) => {
  const { sessionId, token, input, questionType = '1' } = req.body;
  if (!sessionId || !token || !input) return res.status(400).json({ error: '缺少参数' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const resp = await fetch(`${AIGC_BASE}/api/chat/qa`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept': 'text/event-stream',
        ...HEADERS
      },
      body: JSON.stringify({ sessionId, input, questionType, timestamp: Date.now(), device: 1 })
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let done = false;
    while (!done) {
      const { value, done: d } = await reader.read();
      done = d;
      if (value) res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

module.exports = router;
