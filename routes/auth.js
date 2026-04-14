/**
 * 账号体系路由
 * POST /api/auth/send-code   发送验证码
 * POST /api/auth/login       验证码登录（自动注册）
 * POST /api/auth/logout      退出登录
 * GET  /api/auth/me          获取当前用户信息
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db/schema');
const { sendSmsCode } = require('../core/sms');

const CODE_TTL = 10 * 60; // 验证码有效期 10 分钟（秒）
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 登录态 30 天（毫秒）
const SEND_INTERVAL = 60;    // 同一手机号发送间隔 60 秒
const IP_HOUR_LIMIT = 10;    // 同一 IP 每小时最多发 10 条
const PHONE_DAY_LIMIT = 10;  // 同一手机号每天最多发 10 条

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function sessionId() {
  return crypto.randomBytes(32).toString('hex');
}

// POST /api/auth/send-code
router.post('/send-code', async (req, res) => {
  const { phone } = req.body;
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    return res.json({ success: false, error: '手机号格式不正确' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;

  // 1. 同一手机号 60 秒内只能发一次
  const recent = db.prepare(
    `SELECT created_at FROM sms_codes WHERE phone = ? ORDER BY created_at DESC LIMIT 1`
  ).get(phone);
  if (recent) {
    const elapsed = (Date.now() - new Date(recent.created_at).getTime()) / 1000;
    if (elapsed < SEND_INTERVAL) {
      return res.json({ success: false, error: `请 ${Math.ceil(SEND_INTERVAL - elapsed)} 秒后再试` });
    }
  }

  // 2. 同一手机号每天不超过 10 次
  const todayPhone = db.prepare(
    `SELECT COUNT(*) as cnt FROM sms_codes WHERE phone = ? AND created_at >= datetime('now', '-1 day')`
  ).get(phone);
  if (todayPhone.cnt >= PHONE_DAY_LIMIT) {
    return res.json({ success: false, error: '该手机号今日发送次数已达上限，请明日再试' });
  }

  // 3. 同一 IP 每小时不超过 10 次
  const hourIp = db.prepare(
    `SELECT COUNT(*) as cnt FROM sms_codes WHERE ip = ? AND created_at >= datetime('now', '-1 hour')`
  ).get(ip);
  if (hourIp.cnt >= IP_HOUR_LIMIT) {
    return res.json({ success: false, error: '操作过于频繁，请稍后再试' });
  }

  const code = randomCode();
  const expiresAt = new Date(Date.now() + CODE_TTL * 1000).toISOString();

  // 存入数据库（旧的未用验证码自动作废）
  db.prepare(`UPDATE sms_codes SET used = 1 WHERE phone = ? AND used = 0`).run(phone);
  db.prepare(`INSERT INTO sms_codes (phone, code, ip, expires_at) VALUES (?, ?, ?, ?)`).run(phone, code, ip, expiresAt);

  const result = await sendSmsCode(phone, code);
  if (!result.success) {
    return res.json({ success: false, error: result.error });
  }

  res.json({ success: true });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { phone, code } = req.body;
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    return res.json({ success: false, error: '手机号格式不正确' });
  }
  if (!code || !/^\d{6}$/.test(code)) {
    return res.json({ success: false, error: '验证码格式不正确' });
  }

  // 查验证码
  const record = db.prepare(
    `SELECT * FROM sms_codes WHERE phone = ? AND used = 0
     ORDER BY created_at DESC LIMIT 1`
  ).get(phone);

  if (!record) {
    return res.json({ success: false, error: '验证码不存在，请重新发送' });
  }
  if (new Date(record.expires_at) < new Date()) {
    return res.json({ success: false, error: '验证码已过期，请重新发送' });
  }
  if (record.code !== code) {
    return res.json({ success: false, error: '验证码错误' });
  }

  // 标记已使用
  db.prepare(`UPDATE sms_codes SET used = 1 WHERE id = ?`).run(record.id);

  // 查或创建用户
  let user = db.prepare(`SELECT * FROM users WHERE phone = ?`).get(phone);
  if (!user) {
    const result = db.prepare(
      `INSERT INTO users (phone, nickname) VALUES (?, ?)`
    ).run(phone, `用户${phone.slice(-4)}`);
    user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(result.lastInsertRowid);
  }

  // 创建 session
  const sid = sessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL).toISOString();
  db.prepare(
    `INSERT INTO user_sessions (id, user_id, expires_at) VALUES (?, ?, ?)`
  ).run(sid, user.id, expiresAt);

  // 匿名 uid → 用户绑定（合并历史对话）
  // 优先用前端传来的 anon_uid，fallback 到中间件的 lexiangUid
  const anonUid = (req.body.anon_uid && req.body.anon_uid.startsWith('u-'))
    ? req.body.anon_uid
    : (req.lexiangUid && req.lexiangUid.startsWith('u-') ? req.lexiangUid : null);
  if (anonUid) {
    try {
      db.prepare(
        `INSERT OR IGNORE INTO anon_uid_mapping (anon_uid, user_id) VALUES (?, ?)`
      ).run(anonUid, user.id);
      // 把匿名对话归属到该用户
      const merged = db.prepare(
        `UPDATE conversations SET user_id = ? WHERE session_id = ? AND user_id IS NULL`
      ).run(user.id, anonUid);
      console.log(`[Auth] 合并匿名对话 uid=${anonUid} user=${user.id} count=${merged.changes}`);
    } catch (e) {
      console.error('[Auth] 合并失败:', e.message);
    }
  }

  // 写登录 cookie
  res.cookie('lx-token', sid, {
    maxAge: SESSION_TTL,
    httpOnly: true,
    path: '/',
    sameSite: 'lax'
  });

  res.json({
    success: true,
    user: { id: user.id, phone: user.phone, nickname: user.nickname, avatar: user.avatar }
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const token = req.cookies?.['lx-token'];
  if (token) {
    db.prepare(`DELETE FROM user_sessions WHERE id = ?`).run(token);
    res.clearCookie('lx-token');
  }
  res.json({ success: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  const token = req.cookies?.['lx-token'];
  if (!token) return res.json({ user: null });

  const session = db.prepare(
    `SELECT * FROM user_sessions WHERE id = ? AND expires_at > datetime('now')`
  ).get(token);
  if (!session) {
    res.clearCookie('lx-token');
    return res.json({ user: null });
  }

  // 刷新活跃时间
  db.prepare(`UPDATE user_sessions SET last_active = datetime('now') WHERE id = ?`).run(token);

  const user = db.prepare(`SELECT id, phone, nickname, avatar FROM users WHERE id = ?`).get(session.user_id);
  res.json({ user: user || null });
});

module.exports = router;
