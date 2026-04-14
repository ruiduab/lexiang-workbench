/**
 * 健康检查路由
 * GET /health          基础健康检查（无需鉴权）
 * GET /health/detail   详细状态（需要 admin session 鉴权）
 * GET /metrics         Prometheus 格式指标（无需鉴权）
 */
const express = require('express');
const router = express.Router();
const db = require('../db/schema');
const { version, commitHash, startTime, getUptime } = require('../core/version');

// 检查 LLM API 可达性
async function checkLLMApi() {
  const https = require('https');
  const API_KEY = process.env.DASHSCOPE_API_KEY || '';
  const start = Date.now();
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'dashscope.aliyuncs.com',
      path: '/compatible-mode/v1/models',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    }, (res) => {
      res.resume();
      resolve({ reachable: res.statusCode < 500, latency_ms: Date.now() - start });
    });
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ reachable: false, latency_ms: Date.now() - start });
    });
    req.on('error', () => {
      resolve({ reachable: false, latency_ms: Date.now() - start });
    });
    req.end();
  });
}

// 检查 DB 状态
function getDbStatus() {
  try {
    const tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n;
    const sizeRow = db.prepare("PRAGMA page_count").get();
    const pageSizeRow = db.prepare("PRAGMA page_size").get();
    const size_mb = Math.round((sizeRow.page_count * pageSizeRow.page_size) / 1024 / 1024 * 10) / 10;
    return { status: 'ok', tables, size_mb };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
}

// 获取最近一条消息时间
function getLastMsgTime() {
  try {
    const row = db.prepare('SELECT created_at FROM messages ORDER BY created_at DESC LIMIT 1').get();
    return row ? row.created_at : null;
  } catch (_) {
    return null;
  }
}

// 获取知识库统计
function getKnowledgeStats() {
  try {
    const chunks = db.prepare('SELECT COUNT(*) AS n FROM knowledge_chunks').get().n;
    const docs = db.prepare('SELECT COUNT(*) AS n FROM knowledge_docs').get().n;
    return { chunks, docs };
  } catch (_) {
    return { chunks: 0, docs: 0 };
  }
}

// 获取总消息数
function getTotalMessages() {
  try {
    return db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
  } catch (_) {
    return 0;
  }
}

// GET /health — 基础健康检查
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    version,
    uptime: getUptime(),
    timestamp: new Date().toISOString()
  });
});

// admin 鉴权中间件（复用 session）
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  res.status(401).json({ error: '需要管理员权限' });
}

// GET /health/detail — 详细状态（需要 admin 鉴权）
router.get('/detail', requireAdmin, async (req, res) => {
  const mem = process.memoryUsage();
  const [llm_api] = await Promise.all([checkLLMApi()]);

  res.json({
    status: 'ok',
    version,
    commitHash,
    uptime: getUptime(),
    startTime: startTime.toISOString(),
    db: getDbStatus(),
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024)
    },
    llm_api,
    knowledge: getKnowledgeStats(),
    last_msg_at: getLastMsgTime(),
    timestamp: new Date().toISOString()
  });
});

// GET /metrics — Prometheus 格式指标
router.get('/metrics-export', (req, res) => {
  const mem = process.memoryUsage();
  const uptime = getUptime();
  const totalMessages = getTotalMessages();
  const knowledge = getKnowledgeStats();

  const lines = [
    '# HELP lexiang_uptime_seconds Service uptime',
    '# TYPE lexiang_uptime_seconds gauge',
    `lexiang_uptime_seconds ${uptime}`,
    '',
    '# HELP lexiang_messages_total Total messages processed',
    '# TYPE lexiang_messages_total counter',
    `lexiang_messages_total ${totalMessages}`,
    '',
    '# HELP lexiang_knowledge_chunks Total knowledge chunks',
    '# TYPE lexiang_knowledge_chunks gauge',
    `lexiang_knowledge_chunks ${knowledge.chunks}`,
    '',
    '# HELP lexiang_knowledge_docs Total knowledge docs',
    '# TYPE lexiang_knowledge_docs gauge',
    `lexiang_knowledge_docs ${knowledge.docs}`,
    '',
    '# HELP lexiang_memory_rss_bytes Process RSS memory',
    '# TYPE lexiang_memory_rss_bytes gauge',
    `lexiang_memory_rss_bytes ${mem.rss}`,
    '',
    '# HELP lexiang_memory_heap_used_bytes Heap used memory',
    '# TYPE lexiang_memory_heap_used_bytes gauge',
    `lexiang_memory_heap_used_bytes ${mem.heapUsed}`,
    ''
  ];

  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(lines.join('\n'));
});

module.exports = router;
