const express = require('express');
const router = express.Router();
const { runAgent, runAgentStream } = require('../core/agent');
const db = require('../db/schema');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// ── 图片上传配置 ──
const UPLOAD_DIR = path.join(__dirname, '../public/uploads/images');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const name = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('只支持 jpg/png/gif/webp 格式'));
  }
});

// ── 音频上传配置 ──
const AUDIO_UPLOAD_DIR = path.join(__dirname, '../public/uploads/audio');
if (!fs.existsSync(AUDIO_UPLOAD_DIR)) fs.mkdirSync(AUDIO_UPLOAD_DIR, { recursive: true });

const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AUDIO_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp3';
    const name = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext;
    cb(null, name);
  }
});
const uploadAudio = multer({
  storage: audioStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/m4a', 'audio/ogg', 'audio/webm', 'audio/x-m4a'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('只支持 mp3/wav/m4a/ogg/webm 格式'));
  }
});

// UID 由 server.js 中间件统一处理，直接读 req.lexiangUid
function getUid(req) {
  return req.lexiangUid || req.headers['x-session-id'] || req.cookies?.['lexiang-uid'] || 'anon';
}

// POST /api/chat/upload-image — 支持 multipart 和 base64 两种方式
router.post('/upload-image', (req, res, next) => {
  // 检测 Content-Type：multipart 走 multer，否则走 base64
  if (req.headers['content-type']?.includes('multipart/form-data')) {
    upload.single('image')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: '未收到图片文件' });
      const url = '/uploads/images/' + req.file.filename;
      res.json({ imageId: req.file.filename, url });
    });
  } else {
    // base64 方式
    const { image_base64, mime_type } = req.body;
    if (!image_base64) return res.status(400).json({ error: 'image_base64 is required' });
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const mime = mime_type || 'image/jpeg';
    if (!allowed.includes(mime)) return res.status(400).json({ error: '只支持 jpg/png/gif/webp 格式' });
    const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
    const ext = extMap[mime] || '.jpg';
    const filename = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext;
    const filepath = path.join(UPLOAD_DIR, filename);
    try {
      const buf = Buffer.from(image_base64, 'base64');
      if (buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: '图片不能超过 5MB' });
      fs.writeFileSync(filepath, buf);
      const url = '/uploads/images/' + filename;
      res.json({ imageId: filename, url });
    } catch (e) {
      res.status(500).json({ error: '图片保存失败: ' + e.message });
    }
  }
});

// POST /api/chat/upload-audio — 支持 multipart 和 base64 两种方式
router.post('/upload-audio', (req, res, next) => {
  if (req.headers['content-type']?.includes('multipart/form-data')) {
    uploadAudio.single('audio')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: '未收到音频文件' });
      const url = '/uploads/audio/' + req.file.filename;
      res.json({ audioId: req.file.filename, url });
    });
  } else {
    // base64 方式
    const { audio_base64, mime_type } = req.body;
    if (!audio_base64) return res.status(400).json({ error: 'audio_base64 is required' });
    const allowed = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/m4a', 'audio/ogg', 'audio/webm', 'audio/x-m4a'];
    const mime = mime_type || 'audio/mpeg';
    if (!allowed.includes(mime)) return res.status(400).json({ error: '只支持 mp3/wav/m4a/ogg/webm 格式' });
    const extMap = {
      'audio/mpeg': '.mp3', 'audio/mp3': '.mp3',
      'audio/wav': '.wav', 'audio/x-wav': '.wav',
      'audio/mp4': '.m4a', 'audio/m4a': '.m4a', 'audio/x-m4a': '.m4a',
      'audio/ogg': '.ogg',
      'audio/webm': '.webm'
    };
    const ext = extMap[mime] || '.mp3';
    const filename = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext;
    const filepath = path.join(AUDIO_UPLOAD_DIR, filename);
    try {
      const buf = Buffer.from(audio_base64, 'base64');
      if (buf.length > 20 * 1024 * 1024) return res.status(400).json({ error: '音频不能超过 20MB' });
      fs.writeFileSync(filepath, buf);
      const url = '/uploads/audio/' + filename;
      res.json({ audioId: filename, url });
    } catch (e) {
      res.status(500).json({ error: '音频保存失败: ' + e.message });
    }
  }
});

// POST /api/chat
router.post('/', async (req, res) => {
  const { message, conv_id } = req.body;
  const sessionId = getUid(req);

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const result = await runAgent(message.trim(), conv_id || null, sessionId, { userId: req.userId || null });
    if (req.userId && result.convId) {
      db.prepare('UPDATE conversations SET user_id = ? WHERE id = ? AND user_id IS NULL').run(req.userId, result.convId);
    }
    res.json(result);
  } catch (err) {
    console.error('[Chat]', err);
    res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// POST /api/chat/stream — SSE 流式响应
router.post('/stream', async (req, res) => {
  const { message, conv_id, web_search, lang, thinking_mode, image_url, audio_url } = req.body;
  const sessionId = getUid(req);

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // 禁用 nginx 缓冲
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let doneTimer = null;
  try {
    await runAgentStream(
      message.trim(),
      conv_id || null,
      sessionId,
      (chunk) => send('chunk', { text: chunk }),
      ({ convId, msgId, products }) => {
        if (req.userId && convId) {
          db.prepare('UPDATE conversations SET user_id = ? WHERE id = ? AND user_id IS NULL').run(req.userId, convId);
        }
        if (products?.length) send('products', { products });
        send('done', { convId, msgId });
        // 不立即 end，等 suggestions 发完再关闭（最多等5秒）
        doneTimer = setTimeout(() => res.end(), 5000);
      },
      {
        webSearch: web_search === true,
        lang: lang === 'en' ? 'en' : 'zh',
        thinkingMode: thinking_mode === true,
        imageUrl: image_url || null,
        audioUrl: audio_url || null,
        userId: req.userId || null,
        onStatus: (status) => send('status', status),
        onThinking: (text) => send('thinking', { text }),
        onThinkEnd: () => send('think_end', {}),
        onSuggestions: (suggestions) => {
          clearTimeout(doneTimer);
          if (suggestions?.length) send('suggestions', { suggestions });
          res.end();
        }
      }
    );
  } catch (err) {
    clearTimeout(doneTimer);
    console.error('[ChatStream]', err);
    send('error', { message: err.message || 'Internal error' });
    res.end();
  }
});

// PATCH /api/chat/messages/:msgId/leai — 保存官方AI对比回复
router.patch('/messages/:msgId/leai', (req, res) => {
  const { leai_text, leai_products } = req.body;
  if (!leai_text) return res.status(400).json({ error: '缺少leai_text' });
  const data = JSON.stringify({ text: leai_text, products: leai_products || [] });
  const r = db.prepare('UPDATE messages SET leai_response = ? WHERE id = ?').run(data, req.params.msgId);
  if (r.changes === 0) return res.status(404).json({ error: '消息不存在' });
  res.json({ ok: true });
});

// GET /api/chat/history/:convId
router.get('/history/:convId', (req, res) => {
  // IDOR修复：验证对话属于当前用户
  const convId = req.params.convId;
  const conv = req.userId
    ? db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(convId, req.userId)
    : db.prepare('SELECT id FROM conversations WHERE id = ? AND session_id = ?').get(convId, req.sessionID);
  if (!conv) return res.status(403).json({ error: '无权访问此对话' });
  const msgs = db.prepare(
    'SELECT id, role, content, leai_response, created_at FROM messages WHERE conv_id = ? ORDER BY created_at ASC'
  ).all(convId);
  res.json(msgs);
});

// GET /api/chat/conversations — 登录用户按 user_id，匿名按 session_id
router.get('/conversations', (req, res) => {
  let convs;
  if (req.userId) {
    convs = db.prepare(`
      SELECT c.id, c.title, c.created_at, c.updated_at,
             (SELECT content FROM messages WHERE conv_id = c.id AND role = 'user' ORDER BY created_at ASC LIMIT 1) AS first_msg
      FROM conversations c
      WHERE c.user_id = ?
      ORDER BY c.updated_at DESC
      LIMIT 30
    `).all(req.userId);
  } else {
    const uid = getUid(req);
    convs = db.prepare(`
      SELECT c.id, c.title, c.created_at, c.updated_at,
             (SELECT content FROM messages WHERE conv_id = c.id AND role = 'user' ORDER BY created_at ASC LIMIT 1) AS first_msg
      FROM conversations c
      WHERE c.session_id = ?
      ORDER BY c.updated_at DESC
      LIMIT 30
    `).all(uid);
  }
  res.json(convs);
});

// POST /api/chat/feedback — 用户对回答的赞/踩
router.post('/feedback', (req, res) => {
  const { conv_id, rating, comment } = req.body;
  const sessionId = getUid(req);
  if (!conv_id || ![1, -1].includes(Number(rating))) {
    return res.status(400).json({ error: 'conv_id 和 rating(1/-1) 必填' });
  }
  // 同一对话只保留最新一条反馈
  db.prepare('DELETE FROM message_feedback WHERE conv_id = ? AND session_id = ?').run(conv_id, sessionId);
  db.prepare('INSERT INTO message_feedback (conv_id, rating, comment, session_id) VALUES (?, ?, ?, ?)')
    .run(conv_id, Number(rating), comment || null, sessionId);
  res.json({ ok: true });
});

// POST /api/chat/share — 生成分享链接
router.post('/share', (req, res) => {
  const { conv_id } = req.body;
  const sessionId = getUid(req);
  if (!conv_id) return res.status(400).json({ error: 'conv_id required' });

  // 验证对话属于当前 session
  const conv = db.prepare('SELECT id FROM conversations WHERE id = ? AND session_id = ?').get(conv_id, sessionId);
  if (!conv) return res.status(403).json({ error: '无权限分享此对话' });

  // 复用已有 token
  const existing = db.prepare('SELECT token FROM share_tokens WHERE conv_id = ?').get(conv_id);
  if (existing) return res.json({ token: existing.token });

  const token = require('crypto').randomBytes(12).toString('base64url');
  db.prepare('INSERT INTO share_tokens (token, conv_id) VALUES (?, ?)').run(token, conv_id);
  res.json({ token });
});

// GET /api/chat/share/:token — 获取分享对话内容（公开）
router.get('/share/:token', (req, res) => {
  const row = db.prepare('SELECT conv_id FROM share_tokens WHERE token = ?').get(req.params.token);
  if (!row) return res.status(404).json({ error: '分享链接不存在或已过期' });

  const conv = db.prepare('SELECT id, title, created_at FROM conversations WHERE id = ?').get(row.conv_id);
  const messages = db.prepare("SELECT role, content FROM messages WHERE conv_id = ? AND role IN ('user','assistant') ORDER BY created_at ASC").all(row.conv_id);
  res.json({ conv, messages });
});

module.exports = router;
