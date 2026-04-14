const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/schema');
const { ingestFile, ingestUrl, ingestText, deleteDoc } = require('../knowledge/ingest');
const { insertQA, deleteQA } = require('../knowledge/qa_search');
const { crawlSite, getJob, cancelJob } = require('../knowledge/crawler');
const { crawlLenovo, fixShortDocs, getJob: getLenovoJob, cancelJob: cancelLenovoJob } = require('../knowledge/lenovo_crawler');
const { crawlBizLenovo, getJob: getBizJob, cancelJob: cancelBizJob } = require('../knowledge/biz_lenovo_crawler');

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.txt', '.md', '.docx', '.doc', '.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`不支持的文件类型: ${ext}，支持: ${allowed.join(', ')}`));
  }
});

// Auth middleware for knowledge management
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  res.status(401).json({ error: '需要管理员权限' });
}

// GET /api/knowledge?page=1&limit=20&q=keyword
router.get('/', requireAdmin, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const q = req.query.q ? `%${req.query.q}%` : null;
  const offset = (page - 1) * limit;

  const where = q ? 'WHERE title LIKE ? OR source_url LIKE ?' : '';
  const params = q ? [q, q] : [];

  const total = db.prepare(`SELECT COUNT(*) as n FROM knowledge_docs ${where}`).get(...params).n;
  const docs = db.prepare(
    `SELECT id, title, source_type, source_url, chunk_count, created_at FROM knowledge_docs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ total, page, limit, pages: Math.ceil(total / limit), docs });
});

// GET /api/knowledge/:id - get doc detail with content
router.get('/:id', requireAdmin, (req, res) => {
  const doc = db.prepare('SELECT * FROM knowledge_docs WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: '文档不存在' });
  const chunks = db.prepare('SELECT id, content, chunk_index FROM knowledge_chunks WHERE doc_id = ? ORDER BY chunk_index').all(req.params.id);
  res.json({ ...doc, chunks });
});

// POST /api/knowledge/upload - upload file
router.post('/upload', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  const title = req.body.title || req.file.originalname;

  try {
    const result = await ingestFile(req.file.path, req.file.originalname, title);
    fs.unlinkSync(req.file.path); // cleanup temp file
    res.json({ success: true, ...result });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    console.error('[Knowledge Upload]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/knowledge/url - ingest from URL
router.post('/url', requireAdmin, async (req, res) => {
  const { url, title } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  try {
    const result = await ingestUrl(url, title);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Knowledge URL]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/knowledge/text - ingest plain text
router.post('/text', requireAdmin, async (req, res) => {
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'title and content are required' });

  try {
    const result = await ingestText(content, title, { source_type: 'manual' });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Knowledge Text]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/knowledge/crawl - start site crawl job
router.post('/crawl', requireAdmin, async (req, res) => {
  const { url, max_pages } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  // max_pages=0 or not set means unlimited
  const maxPages = max_pages ? Math.max(0, Number(max_pages)) : 0;

  const jobId = uuidv4();
  // Fire and forget — don't await
  crawlSite(url, jobId, { maxPages, concurrency: 3 })
    .catch(err => console.error('[Crawler]', err));

  res.json({ success: true, jobId });
});

// GET /api/knowledge/crawl/:jobId - get crawl job status
router.get('/crawl/:jobId', requireAdmin, (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(job);
});

// POST /api/knowledge/crawl/:jobId/cancel
router.post('/crawl/:jobId/cancel', requireAdmin, (req, res) => {
  cancelJob(req.params.jobId);
  res.json({ success: true });
});

// POST /api/knowledge/lenovo-crawl - crawl Lenovo iknow via API
router.post('/lenovo-crawl', requireAdmin, (req, res) => {
  const { keyword = ' ', max_articles = 0 } = req.body;
  const jobId = uuidv4();
  crawlLenovo(jobId, { keyword, maxArticles: Number(max_articles) })
    .catch(err => console.error('[LenovoCrawler]', err));
  res.json({ success: true, jobId });
});

router.get('/lenovo-crawl/:jobId', requireAdmin, (req, res) => {
  const job = getLenovoJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(job);
});

router.post('/lenovo-crawl/:jobId/cancel', requireAdmin, (req, res) => {
  cancelLenovoJob(req.params.jobId);
  res.json({ success: true });
});

// POST /api/knowledge/fix-short - 补充短内容文档（重新拉详情接口）
router.post('/fix-short', requireAdmin, (req, res) => {
  const { threshold = 200, limit = 0 } = req.body;
  const jobId = `fix-short-${Date.now()}`;
  fixShortDocs(jobId, { threshold, limit });
  res.json({ jobId });
});

// GET /api/knowledge/fix-short/:jobId - 查进度
router.get('/fix-short/:jobId', requireAdmin, (req, res) => {
  const job = getLenovoJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  res.json(job);
});

// GET /api/knowledge/search?q=xxx&topK=5 - test knowledge retrieval
router.get('/search', requireAdmin, (req, res) => {
  const { q, topK = 5 } = req.query;
  if (!q) return res.status(400).json({ error: 'q is required' });
  const { search } = require('../knowledge/search');
  const hits = search(q, Number(topK));
  res.json(hits);
});

// POST /api/knowledge/build-vectors - 触发批量向量化
router.post('/build-vectors', requireAdmin, (req, res) => {
  const { buildVectors, getState } = require('../knowledge/build_vectors');
  const state = getState();
  if (state.status === 'running') return res.json({ success: false, error: '已在运行中', state });
  buildVectors().catch(e => console.error('[BuildVectors]', e));
  res.json({ success: true, message: '向量化任务已启动' });
});

// GET /api/knowledge/build-vectors/status
router.get('/build-vectors/status', requireAdmin, (req, res) => {
  const { getState } = require('../knowledge/build_vectors');
  res.json(getState());
});

// DELETE /api/knowledge/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await deleteDoc(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/knowledge/qa/import — 批量导入 QA 对
router.post('/qa/import', requireAdmin, (req, res) => {
  const { items, doc_id } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items 不能为空' });
  }
  let imported = 0;
  for (const item of items) {
    if (!item.question || !item.answer) continue;
    try {
      insertQA({ question: item.question, answer: item.answer, source: item.source || null, doc_id: doc_id || null });
      imported++;
    } catch (e) {
      console.error('[QA Import]', e.message);
    }
  }
  res.json({ imported });
});

// GET /api/knowledge/qa/list?limit=20&offset=0 — 列出 QA 对
router.get('/qa/list', requireAdmin, (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const db = require('../db/schema');
  const total = db.prepare('SELECT COUNT(*) AS n FROM knowledge_qa').get().n;
  const items = db.prepare('SELECT id, doc_id, question, answer, source, created_at FROM knowledge_qa ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset);
  res.json({ total, limit, offset, items });
});

// DELETE /api/knowledge/qa/:id — 删除单条 QA 对
router.delete('/qa/:id', requireAdmin, (req, res) => {
  try {
    deleteQA(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
