/**
 * 数据协作者（uploader）专用路由
 * 权限：只能上传Excel、查看导入结果、管理自己的上传记录
 * 不能访问admin的其他功能
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const db = require('../db/schema');
const { ingestText } = require('../knowledge/ingest');

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB（Excel可能较大）
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) cb(null, true);
    else cb(new Error(`只支持 .xlsx/.xls/.csv 文件，不支持: ${ext}`));
  }
});

// 鉴权中间件：admin 或 uploader 都可以
function requireUploader(req, res, next) {
  if (req.session && req.session.admin) return next();
  if (req.session && req.session.uploader) return next();
  res.status(401).json({ error: '请先登录' });
}

// POST /api/uploader/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });

  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: '用户名或密码错误' });

  // admin 和 uploader 都可以登录
  if (user.role === 'admin') {
    req.session.admin = { id: user.id, username: user.username };
    req.session.uploader = { id: user.id, username: user.username, role: 'admin' };
  } else {
    req.session.uploader = { id: user.id, username: user.username, role: user.role };
  }

  res.json({ success: true, username: user.username, role: user.role });
});

// GET /api/uploader/me
router.get('/me', (req, res) => {
  if (req.session?.uploader) return res.json({ user: req.session.uploader });
  if (req.session?.admin) return res.json({ user: { ...req.session.admin, role: 'admin' } });
  res.status(401).json({ error: '未登录' });
});

// POST /api/uploader/logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ===== 产品Excel上传并导入 =====

function parseJsonField(val) {
  if (!val) return [];
  try { const arr = JSON.parse(val); return Array.isArray(arr) ? arr : []; } catch { return []; }
}

function buildProductText(row) {
  const isDeleted = row.is_del === 1;
  const lines = [];
  lines.push(`状态：${isDeleted ? '已下架' : '在售'}`);
  lines.push(`商品名称：${row.name || ''}`);
  if (row.gbrief) lines.push(`简介：${row.gbrief}`);
  if (row.category_name) lines.push(`品类：${row.category_name}`);
  if (row.sub_category_name) lines.push(`子品类：${row.sub_category_name}`);
  if (row.brand) lines.push(`品牌：${row.brand}`);
  if (row.series) lines.push(`系列：${row.series}`);
  if (row.model) lines.push(`型号：${row.model}`);
  if (row.baseprice) lines.push(`价格：${row.baseprice} 元`);
  const poi = parseJsonField(row.poi);
  if (poi.length) { lines.push('\n核心卖点：'); poi.forEach(p => lines.push(`- ${p}`)); }
  if (row.summary) { lines.push('\n详细介绍：'); lines.push(row.summary); }
  const targetUser = parseJsonField(row.target_user);
  if (targetUser.length) { lines.push('\n适合人群：'); targetUser.forEach(u => lines.push(`- ${u}`)); }
  const specs = [];
  if (row.cpu) specs.push(`CPU：${row.cpu}`);
  if (row.memory_capacity_description) specs.push(`内存：${row.memory_capacity_description}`);
  if (row.disk_capacity_description) specs.push(`存储：${row.disk_capacity_description}`);
  if (row.gpu_description) specs.push(`显卡：${row.gpu_description}`);
  if (row.screen_size) specs.push(`屏幕尺寸：${row.screen_size}`);
  if (row.screen_resolution) specs.push(`分辨率：${row.screen_resolution}`);
  if (row.os) specs.push(`操作系统：${row.os}`);
  if (row.warranty_policy) specs.push(`保修：${row.warranty_policy}`);
  if (row.weight) specs.push(`重量：${row.weight}`);
  if (specs.length) { lines.push('\n规格参数：'); specs.forEach(s => lines.push(`- ${s}`)); }
  if (row.pcdetailurl) lines.push(`\n商品链接：${row.pcdetailurl}`);
  return lines.join('\n');
}

// POST /api/uploader/upload — 上传Excel并导入产品数据
router.post('/upload', requireUploader, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });

  const filePath = req.file.path;
  const originalName = req.file.originalname;

  try {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);

    const valid = rows.filter(r => r.name && (r.summary || r.gbrief));
    if (valid.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: '未找到有效产品数据（需要 name + summary/gbrief 字段）' });
    }

    let inserted = 0, skipped = 0, updated = 0, failed = 0;

    for (const row of valid) {
      const title = row.name || `商品${row.id}`;
      const text = buildProductText(row);
      const url = row.is_del !== 1 && row.pcdetailurl ? row.pcdetailurl : null;

      try {
        const result = await ingestText(text, title, {
          source_type: 'url',
          source_url: url,
        });
        if (result.skipped) skipped++;
        else if (result.updated) updated++;
        else inserted++;
      } catch (e) {
        failed++;
      }
    }

    fs.unlinkSync(filePath);

    // 记录上传日志
    try {
      db.prepare(`
        INSERT INTO upload_logs (username, filename, total_rows, inserted, updated, skipped, failed)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.session.uploader?.username || req.session.admin?.username || 'unknown',
        originalName, valid.length, inserted, updated, skipped, failed
      );
    } catch {}

    res.json({
      success: true,
      filename: originalName,
      totalRows: valid.length,
      inserted, updated, skipped, failed,
    });
  } catch (e) {
    try { fs.unlinkSync(filePath); } catch {}
    res.status(500).json({ error: `导入失败: ${e.message}` });
  }
});

// GET /api/uploader/logs — 查看上传记录
router.get('/logs', requireUploader, (req, res) => {
  const logs = db.prepare(
    'SELECT * FROM upload_logs ORDER BY created_at DESC LIMIT 50'
  ).all();
  res.json({ logs });
});

// GET /api/uploader/stats — 知识库统计
router.get('/stats', requireUploader, (req, res) => {
  const docs = db.prepare('SELECT COUNT(*) as n FROM knowledge_docs').get().n;
  const chunks = db.prepare('SELECT COUNT(*) as n FROM knowledge_chunks').get().n;
  const latest = db.prepare('SELECT MAX(updated_at) as t FROM knowledge_docs').get().t;
  res.json({ totalDocs: docs, totalChunks: chunks, lastUpdate: latest });
});

module.exports = router;
