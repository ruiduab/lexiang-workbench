const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db/schema');
const registry = require('../core/skill-registry');
const { getReflectionStats } = require('../core/reflector');
const { runEvolution, getEvolutionHistory } = require('../core/evolver');
const { buildKnowledgeGraph, getKGStats } = require('../knowledge/graph_rag');
const { collectMetrics, checkAlerts, getMetricsTrend, getLatestMetrics } = require('../core/monitor');
const { runLearningCycle, getLearningStatus } = require('../core/learner');

// POST /api/admin/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: '用户名或密码错误' });

  req.session.admin = { id: user.id, username: user.username };
  res.json({ success: true, username: user.username });
});

// POST /api/admin/logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// GET /api/admin/me
router.get('/me', (req, res) => {
  if (req.session && req.session.admin) {
    res.json({ admin: req.session.admin });
  } else {
    res.status(401).json({ error: 'not logged in' });
  }
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  res.status(401).json({ error: '需要管理员权限' });
}

// ===== 协作者账号管理 =====

// POST /api/admin/users — 创建协作者账号
router.post('/users', requireAdmin, async (req, res) => {
  const { username, password, role = 'uploader' } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少6位' });
  if (!['admin', 'uploader'].includes(role)) return res.status(400).json({ error: '角色只能是 admin 或 uploader' });

  const exists = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(username);
  if (exists) return res.status(400).json({ error: '用户名已存在' });

  const hash = await bcrypt.hash(password, 10);
  db.prepare('INSERT INTO admin_users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, role);
  res.json({ success: true, username, role });
});

// GET /api/admin/users — 列出所有账号
router.get('/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, role, created_at FROM admin_users ORDER BY id').all();
  res.json({ users });
});

// DELETE /api/admin/users/:id — 删除账号
router.delete('/users/:id', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.username === 'admin') return res.status(400).json({ error: '不能删除admin' });
  db.prepare('DELETE FROM admin_users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET /api/admin/skills - list skills
router.get('/skills', requireAdmin, (req, res) => {
  res.json(registry.list());
});

// PATCH /api/admin/skills/:name - enable/disable skill
router.patch('/skills/:name', requireAdmin, (req, res) => {
  const { enabled } = req.body;
  registry.setEnabled(req.params.name, enabled);
  res.json({ success: true });
});

// POST /api/admin/change-password
router.post('/change-password', requireAdmin, async (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password) return res.status(400).json({ error: '参数不完整' });
  if (new_password.length < 8) return res.status(400).json({ error: '新密码至少8位' });

  const user = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.session.admin.id);
  const ok = await bcrypt.compare(old_password, user.password_hash);
  if (!ok) return res.status(401).json({ error: '原密码错误' });

  const hash = await bcrypt.hash(new_password, 10);
  db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  res.json({ success: true });
});

// GET /api/admin/stats — 运营+知识库+反馈全量数据
router.get('/stats', requireAdmin, (req, res) => {
  // 兼容旧字段
  const docCount    = db.prepare('SELECT COUNT(*) AS n FROM knowledge_docs').get().n;
  const chunkCount  = db.prepare('SELECT COUNT(*) AS n FROM knowledge_chunks').get().n;
  const convCount   = db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n;
  const msgCount    = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
  const errCount    = db.prepare("SELECT COUNT(*) AS n FROM fe_logs WHERE type='error' OR type='api_error'").get().n;

  const todayConvs  = db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE date(created_at)='"+new Date().toISOString().slice(0,10)+"'").get().n;
  const likes       = db.prepare("SELECT COUNT(*) AS n FROM message_feedback WHERE rating=1").get().n;
  const dislikes    = db.prepare("SELECT COUNT(*) AS n FROM message_feedback WHERE rating=-1").get().n;
  const vectors     = db.prepare('SELECT COUNT(*) AS n FROM knowledge_vectors').get().n;
  const userMsgs    = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE role='user'").get().n;

  const badFeedback = db.prepare(`
    SELECT f.conv_id, f.created_at,
           (SELECT content FROM messages WHERE conv_id=f.conv_id AND role='user' ORDER BY created_at ASC LIMIT 1) AS question,
           (SELECT title FROM conversations WHERE id=f.conv_id) AS title
    FROM message_feedback f WHERE f.rating=-1
    ORDER BY f.created_at DESC LIMIT 20
  `).all();

  const trend = db.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS n
    FROM conversations WHERE created_at >= datetime('now','-7 days')
    GROUP BY day ORDER BY day
  `).all();

  res.json({
    // 旧字段保持兼容
    docCount, chunkCount, convCount, msgCount, errCount,
    // 新字段
    overview: { totalConvs: convCount, todayConvs, totalUserMsgs: userMsgs, likes, dislikes,
                satisfaction: (likes + dislikes) > 0 ? Math.round(likes / (likes + dislikes) * 100) : null },
    knowledge: { docs: docCount, chunks: chunkCount, vectors,
      qaPairs: (() => { try { return db.prepare('SELECT COUNT(*) AS n FROM knowledge_qa').get().n; } catch { return 0; } })(),
      kgEntities: (() => { try { return db.prepare('SELECT COUNT(*) AS n FROM kg_entities').get().n; } catch { return 0; } })()
    },
    badFeedback,
    trend
  });
});

// GET /api/admin/conversations?limit=50
router.get('/conversations', requireAdmin, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = db.prepare(`
    SELECT c.id, c.session_id, c.created_at, c.updated_at,
           (SELECT content FROM messages WHERE conv_id = c.id AND role = 'user' ORDER BY created_at ASC LIMIT 1) AS first_msg,
           (SELECT COUNT(*) FROM messages WHERE conv_id = c.id) AS msg_count
    FROM conversations c
    ORDER BY c.updated_at DESC
    LIMIT ?
  `).all(limit);
  res.json(rows);
});

// GET /api/admin/conversations/:id — 管理员查看对话详情
router.get('/conversations/:id', requireAdmin, (req, res) => {
  const convId = req.params.id;
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  if (!conv) return res.status(404).json({ error: '对话不存在' });
  const msgs = db.prepare(
    'SELECT role, content, created_at FROM messages WHERE conv_id = ? ORDER BY created_at ASC'
  ).all(convId);
  res.json({ conversation: conv, messages: msgs });
});

// GET /api/admin/bot-config — 读取所有机器人配置
router.get('/bot-config', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT key, value, updated_at FROM bot_config ORDER BY key').all();
  const config = {};
  rows.forEach(r => { config[r.key] = { value: r.value, updated_at: r.updated_at }; });
  res.json(config);
});

// PUT /api/admin/bot-config — 更新机器人配置
router.put('/bot-config', requireAdmin, (req, res) => {
  const updates = req.body; // { key: value, ... }
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'body must be {key: value}' });
  }
  const stmt = db.prepare(`
    INSERT INTO bot_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  Object.entries(updates).forEach(([key, value]) => {
    if (typeof value === 'string') stmt.run(key, value);
  });
  res.json({ ok: true });
});

// GET /api/admin/logs?type=error&limit=100
router.get('/logs', requireAdmin, (req, res) => {
  const { type, limit = 100 } = req.query;
  const rows = type
    ? db.prepare('SELECT * FROM fe_logs WHERE type=? ORDER BY created_at DESC LIMIT ?').all(type, Number(limit))
    : db.prepare('SELECT * FROM fe_logs ORDER BY created_at DESC LIMIT ?').all(Number(limit));
  res.json(rows);
});

// GET /api/admin/reflections?limit=50 — L2.5 自主反思日志
router.get('/reflections', requireAdmin, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = db.prepare(
    'SELECT * FROM reflection_logs ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
  const stats = getReflectionStats();
  res.json({ stats, rows });
});

// POST /api/admin/run-evolution — 手动触发一次进化分析
router.post('/run-evolution', requireAdmin, async (req, res) => {
  try {
    const result = await runEvolution();
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, reason: e.message });
  }
});

// GET /api/admin/evolution-notes — 查看当前优化指令和历史
router.get('/evolution-notes', requireAdmin, (req, res) => {
  try {
    const history = getEvolutionHistory();
    res.json(history);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/build-kg — 触发后台建图（L3.1）
router.post('/build-kg', requireAdmin, async (req, res) => {
  const limit = Number(req.body && req.body.limit) || 100;
  const result = await buildKnowledgeGraph(limit);
  res.json(result);
});

// GET /api/admin/kg-stats — 知识图谱统计+实体列表（L3.1）
router.get('/kg-stats', requireAdmin, (req, res) => {
  const stats = getKGStats();
  const limit = Math.min(100, parseInt(req.query.limit) || 30);
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  try {
    const entities = db.prepare('SELECT * FROM kg_entities ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
    const relationCount = db.prepare('SELECT COUNT(*) AS n FROM kg_relations').get().n;
    res.json({ entityCount: stats.entities, relationCount, entities });
  } catch {
    res.json({ entityCount: 0, relationCount: 0, entities: [] });
  }
});

// GET /api/admin/metrics — 当前指标快照（最新一条）
router.get('/metrics', requireAdmin, (req, res) => {
  const metrics = getLatestMetrics();
  const values = {};
  for (const [k, v] of Object.entries(metrics)) {
    values[k] = v.metric_value;
  }
  const alerts = checkAlerts(values);
  res.json({ metrics, alerts });
});

// GET /api/admin/metrics/trend?key=msg_count_1h&hours=24
router.get('/metrics/trend', requireAdmin, (req, res) => {
  const key = req.query.key || 'msg_count_1h';
  const hours = Math.min(Number(req.query.hours) || 24, 720);
  const trend = getMetricsTrend(key, hours);
  res.json({ key, hours, trend });
});

// POST /api/admin/metrics/collect — 手动触发采集
router.post('/metrics/collect', requireAdmin, async (req, res) => {
  try {
    const result = await collectMetrics();
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── L1.5 Persona 管理 ──

// GET /api/admin/personas — 列出所有 Persona
router.get('/personas', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM personas ORDER BY id ASC').all();
  res.json(rows);
});

// POST /api/admin/personas — 创建新 Persona
router.post('/personas', requireAdmin, (req, res) => {
  const { name, description, prompt_prefix } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name 不能为空' });
  }
  if (typeof prompt_prefix !== 'string') {
    return res.status(400).json({ error: 'prompt_prefix 必须是字符串' });
  }
  const result = db.prepare(
    'INSERT INTO personas (name, description, prompt_prefix) VALUES (?, ?, ?)'
  ).run(name.trim(), description || '', prompt_prefix);
  const created = db.prepare('SELECT * FROM personas WHERE id = ?').get(result.lastInsertRowid);
  res.json(created);
});

// PUT /api/admin/personas/:id/activate — 激活指定 Persona
router.put('/personas/:id/activate', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const persona = db.prepare('SELECT * FROM personas WHERE id = ?').get(id);
  if (!persona) return res.status(404).json({ error: 'Persona 不存在' });
  // 先全部取消激活，再激活目标
  db.prepare('UPDATE personas SET is_active = 0').run();
  db.prepare('UPDATE personas SET is_active = 1 WHERE id = ?').run(id);
  res.json({ ok: true, activated: id });
});

// DELETE /api/admin/personas/:id — 删除（不能删除默认）
router.delete('/personas/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const persona = db.prepare('SELECT * FROM personas WHERE id = ?').get(id);
  if (!persona) return res.status(404).json({ error: 'Persona 不存在' });
  if (persona.is_default) return res.status(400).json({ error: '不能删除默认 Persona' });
  db.prepare('DELETE FROM personas WHERE id = ?').run(id);
  // 如果删除的是激活状态，则激活默认 Persona
  if (persona.is_active) {
    db.prepare('UPDATE personas SET is_active = 1 WHERE is_default = 1').run();
  }
  res.json({ ok: true });
});

// ── L3.3 回归测试 ──

const { runRegressionTests, getExperimentStats, assignVariant } = require('../core/evaluator');

// GET /api/admin/regression-cases — 列出回归测试用例
router.get('/regression-cases', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM regression_cases ORDER BY id ASC').all();
  res.json(rows);
});

// POST /api/admin/regression-cases — 新增测试用例
router.post('/regression-cases', requireAdmin, (req, res) => {
  const { question, expected_keywords, category } = req.body;
  if (!question || !Array.isArray(expected_keywords) || expected_keywords.length === 0) {
    return res.status(400).json({ error: 'question 和 expected_keywords(数组) 不能为空' });
  }
  const result = db.prepare(
    'INSERT INTO regression_cases (question, expected_keywords, category) VALUES (?, ?, ?)'
  ).run(question.trim(), JSON.stringify(expected_keywords), category || null);
  const created = db.prepare('SELECT * FROM regression_cases WHERE id = ?').get(result.lastInsertRowid);
  res.json(created);
});

// POST /api/admin/regression-cases/run — 执行回归测试
router.post('/regression-cases/run', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.body && req.body.limit) || 20, 50);
    const report = await runRegressionTests(limit);
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/regression-cases/:id — 删除
router.delete('/regression-cases/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT id FROM regression_cases WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '用例不存在' });
  db.prepare('DELETE FROM regression_cases WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ── L3.3 AB 实验 ──

// GET /api/admin/experiments — 列出 AB 实验
router.get('/experiments', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM ab_experiments ORDER BY id DESC').all();
  res.json(rows);
});

// POST /api/admin/experiments — 创建 AB 实验
router.post('/experiments', requireAdmin, (req, res) => {
  const { name, description, variant_a, variant_b, traffic_split } = req.body;
  if (!name || !variant_a || !variant_b) {
    return res.status(400).json({ error: 'name, variant_a, variant_b 不能为空' });
  }
  const split = (traffic_split !== undefined) ? Number(traffic_split) : 0.5;
  if (isNaN(split) || split < 0 || split > 1) {
    return res.status(400).json({ error: 'traffic_split 需在 0-1 之间' });
  }
  let vaStr, vbStr;
  try {
    vaStr = typeof variant_a === 'string' ? variant_a : JSON.stringify(variant_a);
    vbStr = typeof variant_b === 'string' ? variant_b : JSON.stringify(variant_b);
  } catch (_) {
    return res.status(400).json({ error: 'variant_a/variant_b JSON 格式错误' });
  }
  const result = db.prepare(
    'INSERT INTO ab_experiments (name, description, variant_a, variant_b, traffic_split) VALUES (?, ?, ?, ?, ?)'
  ).run(name.trim(), description || null, vaStr, vbStr, split);
  const created = db.prepare('SELECT * FROM ab_experiments WHERE id = ?').get(result.lastInsertRowid);
  res.json(created);
});

// PUT /api/admin/experiments/:id/status — 更新实验状态
router.put('/experiments/:id/status', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status } = req.body;
  const allowed = ['running', 'paused', 'completed', 'draft'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status 须为 ${allowed.join('|')}` });
  }
  const exp = db.prepare('SELECT id FROM ab_experiments WHERE id = ?').get(id);
  if (!exp) return res.status(404).json({ error: '实验不存在' });
  const endedAt = status === 'completed' ? "datetime('now')" : 'ended_at';
  if (status === 'completed') {
    db.prepare(`UPDATE ab_experiments SET status = ?, ended_at = datetime('now') WHERE id = ?`).run(status, id);
  } else {
    db.prepare(`UPDATE ab_experiments SET status = ? WHERE id = ?`).run(status, id);
  }
  const updated = db.prepare('SELECT * FROM ab_experiments WHERE id = ?').get(id);
  res.json(updated);
});

// GET /api/admin/experiments/:id/stats — 获取实验统计
router.get('/experiments/:id/stats', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const stats = getExperimentStats(id);
  if (!stats) return res.status(404).json({ error: '实验不存在' });
  res.json(stats);
});

// POST /api/admin/manual-qa — 手动添加QA对（source标记workbench_manual，不污染wiki知识库）
router.post('/manual-qa', requireAdmin, (req, res) => {
  const { question, answer, source = 'workbench_manual' } = req.body;
  if (!question || !answer) return res.status(400).json({ error: '问题和答案不能为空' });
  try {
    const result = db.prepare(
      'INSERT INTO knowledge_qa (question, answer, source, doc_id) VALUES (?, ?, ?, 0)'
    ).run(question, answer, source);
    // 同步写入FTS索引
    try {
      db.prepare('INSERT INTO knowledge_qa_fts (qa_id, question, answer) VALUES (?, ?, ?)').run(result.lastInsertRowid, question, answer);
    } catch {}
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/generate-qa?limit=20 — 从知识库文档自动生成 QA 对（L4.2）
router.post('/generate-qa', requireAdmin, (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  // 立即返回，后台异步执行
  res.json({ ok: true, message: '后台生成中' });

  setImmediate(async () => {
    const https = require('https');
    const { insertQA } = require('../knowledge/qa_search');
    const API_KEY = process.env.DASHSCOPE_API_KEY;
    const MODEL = 'qwen-plus';

    function callLLM(prompt) {
      return new Promise((resolve, reject) => {
        const body = JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1200,
          temperature: 0.3
        });
        const req = https.request({
          hostname: 'dashscope.aliyuncs.com',
          path: '/compatible-mode/v1/chat/completions',
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          }
        }, (res2) => {
          let data = '';
          res2.on('data', c => data += c);
          res2.on('end', () => {
            try {
              const j = JSON.parse(data);
              resolve(j.choices?.[0]?.message?.content?.trim() || '');
            } catch (e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('LLM timeout')); });
        req.write(body);
        req.end();
      });
    }

    // 取最近 limit 条文档，跳过已有 QA 的
    const docs = db.prepare(`
      SELECT kd.id, kd.title, kd.content
      FROM knowledge_docs kd
      WHERE kd.id NOT IN (SELECT DISTINCT doc_id FROM knowledge_qa WHERE doc_id IS NOT NULL)
      ORDER BY kd.id DESC
      LIMIT ?
    `).all(limit);

    console.log(`[GenerateQA] 共 ${docs.length} 篇文档待生成 QA`);

    for (const doc of docs) {
      try {
        const contentSnippet = doc.content.slice(0, 2000);
        const prompt = `你是联想AI助手，请从以下文档内容中提取3-5个高质量的问答对。\n` +
          `要求：\n` +
          `1. 问题要具体、自然，像真实用户会问的问题\n` +
          `2. 答案要简洁准确，基于文档内容\n` +
          `3. 输出格式严格按JSON数组：[{"q":"问题","a":"答案"},...]\n` +
          `4. 只输出JSON，不要其他任何内容\n\n` +
          `文档标题：${doc.title}\n` +
          `文档内容：\n${contentSnippet}`;

        const raw = await callLLM(prompt);
        // 提取 JSON 数组
        const match = raw.match(/\[[\s\S]*\]/);
        if (!match) continue;
        const pairs = JSON.parse(match[0]);
        if (!Array.isArray(pairs)) continue;

        for (const pair of pairs) {
          if (!pair.q || !pair.a) continue;
          insertQA({ question: pair.q, answer: pair.a, source: `auto:doc_${doc.id}`, doc_id: doc.id });
        }
        console.log(`[GenerateQA] 文档 ${doc.id} (${doc.title}) 生成 ${pairs.length} 条 QA`);
      } catch (e) {
        console.error(`[GenerateQA] 文档 ${doc.id} 生成失败:`, e.message);
      }
    }
    console.log('[GenerateQA] 全部完成');
  });
});

// ── MCP Tools 管理 ──

const mcpClient = require('../core/mcp_client');

// GET /api/admin/mcp-tools — 列出所有 MCP 工具
router.get('/mcp-tools', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM mcp_tools ORDER BY id ASC').all();
  res.json(rows.map(r => ({
    ...r,
    input_schema: (() => { try { return JSON.parse(r.input_schema || '{}'); } catch { return {}; } })(),
    enabled: Boolean(r.enabled)
  })));
});

// POST /api/admin/mcp-tools — 注册新 MCP 工具
router.post('/mcp-tools', requireAdmin, (req, res) => {
  const { name, description, endpoint_url, input_schema } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name 不能为空' });
  }
  if (!endpoint_url || typeof endpoint_url !== 'string') {
    return res.status(400).json({ error: '远程工具必须提供 endpoint_url' });
  }
  try { new URL(endpoint_url); } catch {
    return res.status(400).json({ error: '无效的 endpoint_url' });
  }
  let schemaStr;
  try {
    schemaStr = typeof input_schema === 'string'
      ? input_schema
      : JSON.stringify(input_schema || { type: 'object', properties: {} });
  } catch {
    return res.status(400).json({ error: 'input_schema JSON 格式错误' });
  }

  try {
    const result = db.prepare(
      'INSERT INTO mcp_tools (name, description, endpoint_url, input_schema) VALUES (?, ?, ?, ?)'
    ).run(name.trim(), description || '', endpoint_url, schemaStr);
    const created = db.prepare('SELECT * FROM mcp_tools WHERE id = ?').get(result.lastInsertRowid);
    mcpClient.reload();
    res.json({ ...created, enabled: Boolean(created.enabled) });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: `工具名 ${name} 已存在` });
    }
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/mcp-tools/:id — 更新（enabled/描述等）
router.put('/mcp-tools/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM mcp_tools WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'MCP 工具不存在' });

  const { description, endpoint_url, enabled, input_schema } = req.body;
  const updates = {};
  if (description !== undefined) updates.description = description;
  if (endpoint_url !== undefined) {
    try { new URL(endpoint_url); } catch { return res.status(400).json({ error: '无效的 endpoint_url' }); }
    updates.endpoint_url = endpoint_url;
  }
  if (enabled !== undefined) updates.enabled = enabled ? 1 : 0;
  if (input_schema !== undefined) {
    try {
      updates.input_schema = typeof input_schema === 'string' ? input_schema : JSON.stringify(input_schema);
    } catch { return res.status(400).json({ error: 'input_schema JSON 格式错误' }); }
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: '没有可更新的字段' });

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE mcp_tools SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), id);
  mcpClient.reload();
  const updated = db.prepare('SELECT * FROM mcp_tools WHERE id = ?').get(id);
  res.json({ ...updated, enabled: Boolean(updated.enabled) });
});

// DELETE /api/admin/mcp-tools/:id — 删除
router.delete('/mcp-tools/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM mcp_tools WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'MCP 工具不存在' });
  // 不允许删除内置本地工具
  if (!row.endpoint_url && ['mcp_knowledge_search', 'mcp_product_recommend', 'mcp_web_search'].includes(row.name)) {
    return res.status(400).json({ error: '内置本地 MCP 工具不可删除，只能禁用' });
  }
  db.prepare('DELETE FROM mcp_tools WHERE id = ?').run(id);
  mcpClient.reload();
  res.json({ ok: true });
});

// ── L2.8 Agent 持续学习 ──

// POST /api/admin/run-learning — 手动触发一次学习周期
router.post('/run-learning', requireAdmin, async (req, res) => {
  try {
    const result = await runLearningCycle();
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, reason: e.message });
  }
});

// GET /api/admin/learning-status — 查看学习状态
router.get('/learning-status', requireAdmin, (req, res) => {
  try {
    const status = getLearningStatus();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 服务管理 ──

const { execFile } = require('child_process');
const path = require('path');

// POST /api/admin/backup — 触发数据库备份
router.post('/backup', requireAdmin, (req, res) => {
  const backupScript = path.join(__dirname, '../scripts/backup.sh');
  execFile('bash', [backupScript], { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('[Backup] 备份失败:', err.message);
      return res.status(500).json({ success: false, error: err.message, output: stderr || stdout });
    }
    console.log('[Backup] 备份完成:', stdout.trim());
    res.json({ success: true, output: stdout.trim() });
  });
});

// POST /api/admin/restart — 优雅重启（发送 SIGTERM，pm2 会自动重拉）
router.post('/restart', requireAdmin, (req, res) => {
  res.json({ success: true, message: '正在优雅重启，服务将在几秒后恢复...' });
  // 延迟 500ms 确保响应发出后再退出
  setTimeout(() => {
    console.log('[Restart] 收到管理员重启指令，发送 SIGTERM...');
    process.kill(process.pid, 'SIGTERM');
  }, 500);
});

// ── 沙箱执行环境 ──

const { runSandbox } = require('../core/sandbox');

// POST /api/admin/sandbox/run — 执行代码，返回 {output, error}
router.post('/sandbox/run', requireAdmin, (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ output: '', error: 'code 不能为空' });
  }
  const result = runSandbox(code, 2000);
  res.json(result);
});

// ===== Query 分析 =====
router.get('/query-analysis', requireAdmin, (req, res) => {
  const totalQueries = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE role='user'").get().n;
  const todayQueries = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE role='user' AND date(created_at)=date('now')").get().n;
  const totalConvs = db.prepare("SELECT COUNT(*) AS n FROM conversations").get().n;
  const likes = db.prepare("SELECT COUNT(*) AS n FROM message_feedback WHERE rating=1").get().n;
  const dislikes = db.prepare("SELECT COUNT(*) AS n FROM message_feedback WHERE rating=-1").get().n;

  // 7天query趋势
  const trend = db.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS n
    FROM messages WHERE role='user' AND created_at >= datetime('now','-7 days')
    GROUP BY day ORDER BY day
  `).all();

  // 热门query TOP10（按内容去重统计）
  const topQueries = db.prepare(`
    SELECT content, COUNT(*) AS freq FROM messages
    WHERE role='user' AND length(content) > 2 AND content NOT LIKE '%[工作台指令]%'
    GROUP BY content ORDER BY freq DESC LIMIT 10
  `).all();

  // 最近无答案query（差评对应的用户问题）
  const badQueries = db.prepare(`
    SELECT m.content, f.created_at FROM message_feedback f
    JOIN messages m ON m.conv_id = f.conv_id AND m.role='user'
    WHERE f.rating = -1
    ORDER BY f.created_at DESC LIMIT 10
  `).all();

  res.json({
    totalQueries, todayQueries, totalConvs, likes, dislikes,
    trend, topQueries, badQueries
  });
});

// ===== 客户画像 =====
router.get('/user-profiles', requireAdmin, (req, res) => {
  const profiles = db.prepare('SELECT * FROM user_profiles ORDER BY updated_at DESC LIMIT 50').all();
  const totalUsers = db.prepare('SELECT COUNT(DISTINCT session_id) AS n FROM conversations').get().n;
  profiles.forEach(p => {
    try { p.product_prefs = JSON.parse(p.product_prefs); } catch { p.product_prefs = []; }
    try { p.use_cases = JSON.parse(p.use_cases); } catch { p.use_cases = []; }
    try { p.extra = JSON.parse(p.extra); } catch { p.extra = {}; }
  });
  res.json({ profiles, totalUsers, profileCount: profiles.length });
});

// ===== 联想员工账号 =====
router.get('/staff', requireAdmin, (req, res) => {
  const { status, q, limit: lim, page: pg } = req.query;
  const limit = Math.min(Number(lim) || 50, 200);
  const page = Math.max(Number(pg) || 1, 1);
  const offset = (page - 1) * limit;
  let where = '1=1';
  const params = [];
  if (status) { where += ' AND account_status = ?'; params.push(status); }
  if (q) { where += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const total = db.prepare(`SELECT COUNT(*) AS n FROM lenovo_staff WHERE ${where}`).get(...params).n;
  const rows = db.prepare(`SELECT * FROM lenovo_staff WHERE ${where} ORDER BY id LIMIT ? OFFSET ?`).all(...params, limit, offset);
  res.json({ total, page, limit, pages: Math.ceil(total / limit), staff: rows });
});

router.get('/staff/stats', requireAdmin, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS n FROM lenovo_staff').get().n;
  const effective = db.prepare("SELECT COUNT(*) AS n FROM lenovo_staff WHERE account_status='EFFECTIVE'").get().n;
  const invalid = db.prepare("SELECT COUNT(*) AS n FROM lenovo_staff WHERE account_status='INVALID'").get().n;
  res.json({ total, effective, invalid });
});

// ===== 电商：商品 CRUD =====

// GET /api/admin/products/stats — 快速统计（不拉全量数据）
router.get('/products/stats', requireAdmin, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  const active = db.prepare("SELECT COUNT(*) AS n FROM products WHERE status='active'").get().n;
  const offline = db.prepare("SELECT COUNT(*) AS n FROM products WHERE status='offline'").get().n;
  const draft = db.prepare("SELECT COUNT(*) AS n FROM products WHERE status='draft'").get().n;
  res.json({ total, active, offline, draft });
});

// GET /api/admin/products/category-counts
router.get('/products/category-counts', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT category, COUNT(*) AS cnt FROM products GROUP BY category').all();
  const map = {};
  rows.forEach(r => { map[r.category] = r.cnt; });
  res.json(map);
});

// GET /api/admin/products?category=&status=&q=&limit=50&page=1
router.get('/products', requireAdmin, (req, res) => {
  const { category, status, q, limit: lim, page: pg } = req.query;
  const limit = Math.min(Number(lim) || 50, 200);
  const page = Math.max(Number(pg) || 1, 1);
  const offset = (page - 1) * limit;

  let where = '1=1';
  const params = [];
  if (category) { where += ' AND category = ?'; params.push(category); }
  if (status) { where += ' AND status = ?'; params.push(status); }
  if (q) { where += ' AND (name LIKE ? OR sku LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }

  const total = db.prepare(`SELECT COUNT(*) AS n FROM products WHERE ${where}`).get(...params).n;
  const rows = db.prepare(`SELECT * FROM products WHERE ${where} ORDER BY sort_order ASC, id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  res.json({ total, page, limit, pages: Math.ceil(total / limit), products: rows });
});

// GET /api/admin/products/:id
router.get('/products/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '商品不存在' });
  res.json(row);
});

// POST /api/admin/products
router.post('/products', requireAdmin, (req, res) => {
  const { name, sku, category, price, original_price, status, stock, image_url, description, specs, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: '商品名称不能为空' });
  try {
    const result = db.prepare(
      'INSERT INTO products (name, sku, category, price, original_price, status, stock, image_url, description, specs, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(name, sku || null, category || '', Number(price) || 0, Number(original_price) || 0, status || 'draft', Number(stock) || 0, image_url || '', description || '', typeof specs === 'object' ? JSON.stringify(specs) : (specs || '{}'), Number(sort_order) || 0);
    const created = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
    res.json(created);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PUT /api/admin/products/:id
router.put('/products/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '商品不存在' });

  const fields = ['name', 'sku', 'category', 'price', 'original_price', 'status', 'stock', 'image_url', 'description', 'specs', 'sort_order'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      let v = req.body[f];
      if (f === 'specs' && typeof v === 'object') v = JSON.stringify(v);
      if (['price', 'original_price', 'stock', 'sort_order'].includes(f)) v = Number(v) || 0;
      params.push(v);
    }
  }
  if (!updates.length) return res.json(row);
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id);
  db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
});

// DELETE /api/admin/products/:id
router.delete('/products/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '商品不存在' });
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET /api/admin/product-categories
router.get('/product-categories', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM product_categories ORDER BY sort_order ASC').all();
  res.json(rows);
});

// POST /api/admin/product-categories
router.post('/product-categories', requireAdmin, (req, res) => {
  const { name, parent_id, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: '分类名称不能为空' });
  const result = db.prepare('INSERT INTO product_categories (name, parent_id, sort_order) VALUES (?, ?, ?)').run(name, Number(parent_id) || 0, Number(sort_order) || 0);
  res.json(db.prepare('SELECT * FROM product_categories WHERE id = ?').get(result.lastInsertRowid));
});

// DELETE /api/admin/product-categories/:id
router.delete('/product-categories/:id', requireAdmin, (req, res) => {
  const prodCount = db.prepare('SELECT COUNT(*) AS n FROM products WHERE category = (SELECT name FROM product_categories WHERE id = ?)').get(req.params.id).n;
  if (prodCount > 0) return res.status(400).json({ error: `该分类下有 ${prodCount} 个商品，无法删除` });
  db.prepare('DELETE FROM product_categories WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ===== 营销任务 CRUD =====

// GET /api/admin/marketing-tasks?status=&type=&limit=50
router.get('/marketing-tasks', requireAdmin, (req, res) => {
  const { status, type, limit: lim } = req.query;
  const limit = Math.min(Number(lim) || 50, 200);
  let where = '1=1';
  const params = [];
  if (status) { where += ' AND status = ?'; params.push(status); }
  if (type) { where += ' AND type = ?'; params.push(type); }
  const rows = db.prepare(`SELECT * FROM marketing_tasks WHERE ${where} ORDER BY id DESC LIMIT ?`).all(...params, limit);
  res.json(rows);
});

// POST /api/admin/marketing-tasks
router.post('/marketing-tasks', requireAdmin, (req, res) => {
  const { name, type, target_audience, content, status, scheduled_at } = req.body;
  if (!name) return res.status(400).json({ error: '任务名称不能为空' });
  const result = db.prepare(
    'INSERT INTO marketing_tasks (name, type, target_audience, content, status, scheduled_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(name, type || 'push', target_audience || '', content || '', status || 'draft', scheduled_at || null, req.session.admin.id);
  res.json(db.prepare('SELECT * FROM marketing_tasks WHERE id = ?').get(result.lastInsertRowid));
});

// PUT /api/admin/marketing-tasks/:id
router.put('/marketing-tasks/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM marketing_tasks WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '任务不存在' });
  const fields = ['name', 'type', 'target_audience', 'content', 'status', 'scheduled_at'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
  }
  if (!updates.length) return res.json(row);
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id);
  db.prepare(`UPDATE marketing_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json(db.prepare('SELECT * FROM marketing_tasks WHERE id = ?').get(req.params.id));
});

// DELETE /api/admin/marketing-tasks/:id
router.delete('/marketing-tasks/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM marketing_tasks WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '任务不存在' });
  db.prepare('DELETE FROM marketing_tasks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// PUT /api/admin/marketing-tasks/:id/execute — 执行任务（模拟）
router.put('/marketing-tasks/:id/execute', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM marketing_tasks WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '任务不存在' });
  // 模拟执行结果
  const reach = Math.floor(Math.random() * 10000) + 1000;
  const click = Math.floor(reach * (Math.random() * 0.3 + 0.05));
  const convert = Math.floor(click * (Math.random() * 0.2 + 0.02));
  db.prepare('UPDATE marketing_tasks SET status = ?, executed_at = CURRENT_TIMESTAMP, reach_count = ?, click_count = ?, convert_count = ? WHERE id = ?')
    .run('completed', reach, click, convert, req.params.id);
  res.json(db.prepare('SELECT * FROM marketing_tasks WHERE id = ?').get(req.params.id));
});

module.exports = router;
