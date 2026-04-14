// 团队动态 API：每个 AI agent / 同事汇报产出
// POST /api/workbench/contribution - 上报一条
// GET  /api/workbench/contributions - 列出最近
// GET  /api/workbench/contributors - 贡献者列表
const router = require('express').Router();
const db = require('../db/schema');

const TYPES = ['feat', 'fix', 'docs', 'experiment', 'data', 'note'];

// 上报：开放接口（不鉴权，方便各机器 Claude Code 直接 curl）
// 防滥用：限制 user/title 长度，type 必须在白名单
router.post('/contribution', (req, res) => {
  const { user, type, title, content, links, project, source } = req.body || {};

  if (!user || typeof user !== 'string' || user.length > 64) {
    return res.status(400).json({ error: 'user is required (string, max 64 chars)' });
  }
  if (!title || typeof title !== 'string' || title.length > 200) {
    return res.status(400).json({ error: 'title is required (string, max 200 chars)' });
  }
  const finalType = TYPES.includes(type) ? type : 'note';
  const finalContent = (typeof content === 'string' ? content : '').slice(0, 5000);
  const finalLinks = links ? JSON.stringify(links).slice(0, 2000) : null;
  const finalProject = (typeof project === 'string' ? project : '').slice(0, 64) || null;
  const finalSource = (typeof source === 'string' ? source : 'api').slice(0, 32);

  try {
    const result = db.prepare(`
      INSERT INTO workbench_contributions (user, type, title, content, links, project, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(user.slice(0, 64), finalType, title.slice(0, 200), finalContent, finalLinks, finalProject, finalSource);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    console.error('[workbench] insert failed:', e.message);
    res.status(500).json({ error: 'insert failed' });
  }
});

// 列表
router.get('/contributions', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const user = req.query.user;
  let rows;
  if (user) {
    rows = db.prepare(`
      SELECT * FROM workbench_contributions WHERE user = ? ORDER BY created_at DESC LIMIT ?
    `).all(user, limit);
  } else {
    rows = db.prepare(`
      SELECT * FROM workbench_contributions ORDER BY created_at DESC LIMIT ?
    `).all(limit);
  }
  // 解析 links JSON
  rows.forEach(r => {
    try { r.links = r.links ? JSON.parse(r.links) : []; } catch { r.links = []; }
  });
  res.json({ ok: true, count: rows.length, items: rows });
});

// 贡献者列表（带统计）
router.get('/contributors', (req, res) => {
  const rows = db.prepare(`
    SELECT user,
           COUNT(*) as count,
           MAX(created_at) as last_active,
           MIN(created_at) as first_active
    FROM workbench_contributions
    GROUP BY user
    ORDER BY count DESC
  `).all();
  res.json({ ok: true, count: rows.length, items: rows });
});

// 类型聚合（用于趋势图）
router.get('/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as c FROM workbench_contributions').get().c;
  const byType = db.prepare(`
    SELECT type, COUNT(*) as count FROM workbench_contributions GROUP BY type
  `).all();
  const today = db.prepare(`
    SELECT COUNT(*) as c FROM workbench_contributions WHERE date(created_at) = date('now', 'localtime')
  `).get().c;
  const week = db.prepare(`
    SELECT COUNT(*) as c FROM workbench_contributions WHERE created_at > datetime('now', '-7 days')
  `).get().c;
  res.json({ ok: true, total, today, week, byType });
});

// 删除单条（管理用，需要登录态 — 这里偷懒先不做，POC 阶段开放）
router.delete('/contribution/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const result = db.prepare('DELETE FROM workbench_contributions WHERE id = ?').run(id);
  res.json({ ok: true, deleted: result.changes });
});

module.exports = router;
