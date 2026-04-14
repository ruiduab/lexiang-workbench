const express = require('express');
const router = express.Router();
const https = require('https');
const db = require('../db/schema');
const registry = require('../core/skill-registry');
const { buildContextMessages } = require('../core/compressor');
const { v4: uuidv4 } = require('uuid');

const API_KEY = process.env.DASHSCOPE_API_KEY;
const MODEL = 'qwen-plus';

// 鉴权中间件：需要 admin 登录
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  res.status(401).json({ error: '需要登录' });
}

// 获取当前用户的角色权限
function getUserPermissions(adminId) {
  const roles = db.prepare(`
    SELECT r.permissions FROM roles r
    JOIN admin_user_roles ar ON ar.role_id = r.id
    WHERE ar.admin_user_id = ?
  `).all(adminId);

  const perms = new Set();
  for (const role of roles) {
    try {
      const p = JSON.parse(role.permissions);
      p.forEach(x => perms.add(x));
    } catch {}
  }
  // 没分配角色默认给 * (兼容旧数据)
  if (perms.size === 0) perms.add('*');
  return [...perms];
}

// 获取当前用户的可见菜单
function getUserMenuTree(adminId) {
  const roles = db.prepare(`
    SELECT r.menu_tree FROM roles r
    JOIN admin_user_roles ar ON ar.role_id = r.id
    WHERE ar.admin_user_id = ?
  `).all(adminId);

  const menus = new Set();
  for (const role of roles) {
    try {
      const m = JSON.parse(role.menu_tree);
      m.forEach(x => menus.add(x));
    } catch {}
  }
  // 没分配角色默认全部可见
  if (menus.size === 0) {
    return ['dashboard', 'geo', 'ecommerce', 'marketing', 'content', 'ai', 'users', 'settings'];
  }
  return [...menus];
}

// ===== SSE 通信引擎 =====
// 连接池：sessionId → { res, adminId, lastHeartbeat }
const sseClients = new Map();

// GET /api/harness/sse/connect — 建立SSE长连接
router.get('/sse/connect', requireAdmin, (req, res) => {
  const adminId = req.session.admin.id;
  const sessionId = Buffer.from(adminId + ':' + Date.now()).toString('base64').replace(/=/g, '');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // nginx SSE support
  });

  // 发送sessionId
  res.write(`id: 201\ndata: ${sessionId}\n\n`);

  sseClients.set(sessionId, { res, adminId, lastHeartbeat: Date.now() });
  console.log(`[SSE] Client connected: ${sessionId} (admin: ${adminId})`);

  req.on('close', () => {
    sseClients.delete(sessionId);
    console.log(`[SSE] Client disconnected: ${sessionId}`);
  });
});

// GET /api/harness/sse/heartbeat — 心跳保活
router.get('/sse/heartbeat', requireAdmin, (req, res) => {
  const { sessionId } = req.query;
  const client = sseClients.get(sessionId);
  if (client) {
    client.lastHeartbeat = Date.now();
    try { client.res.write(`id: hb\ndata: pong\n\n`); } catch {}
    res.json({ status: 'ok' });
  } else {
    res.status(404).json({ error: 'session not found' });
  }
});

// SSE推送函数
function ssePush(sessionId, msgObj) {
  const client = sseClients.get(sessionId);
  if (!client) return false;
  const id = Date.now();
  try {
    client.res.write(`id: ${id}\ndata: ${JSON.stringify(msgObj)}\n\n`);
    return true;
  } catch { return false; }
}

// POST /api/harness/sse/say — 发送消息（通过SSE推送回复）
router.post('/sse/say', requireAdmin, async (req, res) => {
  const { message, sessionId, sceneCode, taskId } = req.body;
  if (!message || !sessionId) return res.status(400).json({ returnStatus: 'FAIL', error: 'message and sessionId required' });

  const client = sseClients.get(sessionId);
  if (!client) return res.status(404).json({ returnStatus: 'FAIL', error: 'session expired, reconnect' });

  res.json({ returnStatus: 'SUCCESS' });

  // 异步处理：先推thinking，再调LLM，再推结果
  const sayId = uuidv4();
  const adminId = client.adminId;

  // 1. 推送thinking
  ssePush(sessionId, {
    text: '',
    sessionid: sessionId,
    object: {
      msgs: [{ componentType: 'thinking', content: { status: 'start' } }],
      sayId, sayType: 'push', position: 'chat', sceneCode: sceneCode || 0, isThinking: true
    }
  });

  try {
    const sessionDbId = `admin:${adminId}`;
    // 复用或创建会话
    let convId = taskId;
    if (!convId) {
      const recent = db.prepare(
        "SELECT id FROM conversations WHERE session_id = ? AND title LIKE '%工作台%' ORDER BY updated_at DESC LIMIT 1"
      ).get(sessionDbId);
      convId = recent ? recent.id : uuidv4();
      if (!recent) db.prepare('INSERT INTO conversations (id, session_id, title) VALUES (?, ?, ?)').run(convId, sessionDbId, 'AI工作台对话');
    }

    const permissions = getUserPermissions(adminId);
    const skills = registry.getToolsForRole(permissions);
    const llmTools = [
      { type: 'function', function: { name: 'query_stats', description: '查询运营统计数据', parameters: { type: 'object', properties: { type: { type: 'string', default: 'overview' } } } } },
      ...skills.map(s => ({ type: 'function', function: { name: s.name, description: s.description || s.name, parameters: s.input_schema || { type: 'object', properties: {} } } }))
    ];

    const systemPrompt = buildWorkbenchSystemPrompt(skills, 'dashboard.overview');
    db.prepare('INSERT INTO messages (conv_id, role, content) VALUES (?, ?, ?)').run(convId, 'user', message);
    const { messages: historyMessages } = await buildContextMessages(convId, 'zh');
    const contextMsgs = historyMessages.filter(m => m.role === 'user' || m.role === 'assistant');

    // 第一轮：意图识别
    const llmResponse = await callLLM(
      [{ role: 'system', content: systemPrompt }, ...contextMsgs, { role: 'user', content: message }],
      llmTools, 1024
    );

    let reply, toolsUsed = [];

    if (!llmResponse.tool_calls || !llmResponse.tool_calls.length) {
      reply = llmResponse.content || '我不太理解你的意思，可以再说具体一点吗？';
    } else {
      // 执行工具
      const toolResults = [];
      for (const tc of llmResponse.tool_calls) {
        const fnName = tc.function?.name;
        let args = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch {}
        let result;
        try {
          if (fnName === 'query_stats') result = await queryStats(args.type || 'overview');
          else result = await registry.invoke(fnName, args, { permissions, admin: req.session.admin });
        } catch (err) { result = { error: err.message }; }
        toolResults.push({ role: 'tool', tool_call_id: tc.id, content: typeof result === 'string' ? result : JSON.stringify(result, null, 2) });
        toolsUsed.push(fnName);
      }

      const finalResponse = await callLLM(
        [{ role: 'system', content: systemPrompt }, ...contextMsgs, { role: 'user', content: message }, { ...llmResponse, content: llmResponse.content || '' }, ...toolResults],
        null, 1024
      );
      reply = finalResponse.content || '操作完成。';
    }

    // 保存回复
    db.prepare('INSERT INTO messages (conv_id, role, content) VALUES (?, ?, ?)').run(convId, 'assistant', reply);
    db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(convId);

    // 2. 停止thinking
    ssePush(sessionId, {
      text: '', sessionid: sessionId,
      object: {
        msgs: [{ componentType: 'thinking', content: { status: 'done' } }],
        sayId, sayType: 'push', position: 'chat', sceneCode: sceneCode || 0, isThinking: false
      }
    });

    // 3. 推送回复（MDT类型，支持markdown）
    ssePush(sessionId, {
      text: reply, sessionid: sessionId,
      object: {
        msgs: [{ componentType: 'MDT', content: { status: 'done', text: reply } }],
        sayId, sayType: 'push', position: 'chat', sceneCode: sceneCode || 0, isThinking: false,
        taskId: convId, toolsUsed
      }
    });

  } catch (err) {
    console.error('[SSE Say] Error:', err.message);
    ssePush(sessionId, {
      text: '', sessionid: sessionId,
      object: {
        msgs: [{ componentType: 'thinking', content: { status: 'done' } }],
        sayId, isThinking: false
      }
    });
    ssePush(sessionId, {
      text: `处理出错: ${err.message}`, sessionid: sessionId,
      object: {
        msgs: [{ componentType: 'NT', content: { text: `处理出错: ${err.message}` } }],
        sayId, sayType: 'push', position: 'chat'
      }
    });
  }
});

// 清理超时连接（5分钟无心跳）
setInterval(() => {
  const now = Date.now();
  for (const [sid, client] of sseClients) {
    if (now - client.lastHeartbeat > 5 * 60 * 1000) {
      try { client.res.end(); } catch {}
      sseClients.delete(sid);
    }
  }
}, 60000);

// ===== Harness 统一调用入口 =====

// POST /api/harness/invoke — Agent 和 UI 共用的统一执行接口
router.post('/invoke', requireAdmin, async (req, res) => {
  const { skill: skillName, input = {} } = req.body;
  if (!skillName) return res.status(400).json({ error: 'skill name required' });

  const permissions = getUserPermissions(req.session.admin.id);
  try {
    const result = await registry.invoke(skillName, input, { permissions, admin: req.session.admin });
    res.json({ success: true, result });
  } catch (err) {
    const status = err.message.includes('Permission denied') ? 403 :
                   err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/harness/skills — 按当前角色返回可用 skill 列表
router.get('/skills', requireAdmin, (req, res) => {
  const permissions = getUserPermissions(req.session.admin.id);
  const skills = registry.getToolsForRole(permissions);
  res.json({ skills });
});

// GET /api/harness/skills/grouped — 按命名空间分组
router.get('/skills/grouped', requireAdmin, (req, res) => {
  const grouped = registry.listByNamespace();
  res.json({ grouped });
});

// GET /api/harness/schema/:name — 获取 skill 参数 schema（UI 自动渲染表单）
router.get('/schema/:name', requireAdmin, (req, res) => {
  const schema = registry.getSchema(req.params.name);
  if (!schema) return res.status(404).json({ error: 'Skill not found' });
  res.json({ schema });
});

// GET /api/harness/menu — 当前用户的可见菜单树
router.get('/menu', requireAdmin, (req, res) => {
  const menus = getUserMenuTree(req.session.admin.id);
  const permissions = getUserPermissions(req.session.admin.id);
  res.json({ menus, permissions });
});

// ===== 角色管理 =====

// GET /api/harness/roles — 角色列表
router.get('/roles', requireAdmin, (req, res) => {
  const roles = db.prepare('SELECT * FROM roles ORDER BY is_system DESC, id ASC').all();
  roles.forEach(r => {
    try { r.permissions = JSON.parse(r.permissions); } catch { r.permissions = []; }
    try { r.menu_tree = JSON.parse(r.menu_tree); } catch { r.menu_tree = []; }
  });
  res.json({ roles });
});

// POST /api/harness/roles — 创建角色
router.post('/roles', requireAdmin, (req, res) => {
  const { name, display_name, description, permissions = [], menu_tree = [] } = req.body;
  if (!name || !display_name) return res.status(400).json({ error: 'name and display_name required' });
  try {
    db.prepare(
      'INSERT INTO roles (name, display_name, description, permissions, menu_tree) VALUES (?, ?, ?, ?, ?)'
    ).run(name, display_name, description || '', JSON.stringify(permissions), JSON.stringify(menu_tree));
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/harness/roles/:id — 更新角色
router.put('/roles/:id', requireAdmin, (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });

  const { display_name, description, permissions, menu_tree } = req.body;
  const updates = [];
  const params = [];

  if (display_name !== undefined) { updates.push('display_name = ?'); params.push(display_name); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (permissions !== undefined) { updates.push('permissions = ?'); params.push(JSON.stringify(permissions)); }
  if (menu_tree !== undefined) { updates.push('menu_tree = ?'); params.push(JSON.stringify(menu_tree)); }

  if (updates.length === 0) return res.json({ success: true });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id);
  db.prepare(`UPDATE roles SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

// DELETE /api/harness/roles/:id — 删除角色（系统角色不可删）
router.delete('/roles/:id', requireAdmin, (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  if (role.is_system) return res.status(403).json({ error: '系统角色不可删除' });
  db.prepare('DELETE FROM roles WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ===== 用户角色分配 =====

// GET /api/harness/user-roles/:userId
router.get('/user-roles/:userId', requireAdmin, (req, res) => {
  const roles = db.prepare(`
    SELECT r.* FROM roles r
    JOIN admin_user_roles ar ON ar.role_id = r.id
    WHERE ar.admin_user_id = ?
  `).all(req.params.userId);
  roles.forEach(r => {
    try { r.permissions = JSON.parse(r.permissions); } catch { r.permissions = []; }
    try { r.menu_tree = JSON.parse(r.menu_tree); } catch { r.menu_tree = []; }
  });
  res.json({ roles });
});

// PUT /api/harness/user-roles/:userId — 设置用户角色（替换式）
router.put('/user-roles/:userId', requireAdmin, (req, res) => {
  const { role_ids = [] } = req.body;
  const userId = parseInt(req.params.userId);

  db.prepare('DELETE FROM admin_user_roles WHERE admin_user_id = ?').run(userId);
  const insert = db.prepare('INSERT INTO admin_user_roles (admin_user_id, role_id) VALUES (?, ?)');
  for (const roleId of role_ids) {
    insert.run(userId, roleId);
  }
  res.json({ success: true });
});

// ===== Harness Chat — AI 助手意图路由 =====

// LLM 调用封装
function callLLM(messages, tools, maxTokens = 1024) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.3,
      ...(tools && tools.length ? { tools, tool_choice: 'auto' } : {})
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
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.error) return reject(new Error(j.error.message || JSON.stringify(j.error)));
          resolve(j.choices?.[0]?.message || {});
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('LLM timeout')); });
    req.write(body);
    req.end();
  });
}

// 流式调用：onDelta(chunkText) 每收到一段文本就回调，结束后 resolve 完整文本
function callLLMStream(messages, onDelta, maxTokens = 1024) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.3,
      stream: true
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
    }, (res) => {
      let buffer = '';
      let full = '';
      res.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload);
            const delta = j.choices?.[0]?.delta?.content || '';
            if (delta) {
              full += delta;
              try { onDelta(delta); } catch {}
            }
          } catch {}
        }
      });
      res.on('end', () => resolve(full));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('LLM stream timeout')); });
    req.write(body);
    req.end();
  });
}

// 构建工作台系统 prompt
function buildWorkbenchSystemPrompt(skills, currentPage) {
  const skillList = skills.map(s =>
    `- ${s.name}: ${s.description} (参数: ${JSON.stringify(Object.keys(s.input_schema?.properties || {}))})`
  ).join('\n');

  return `你是乐享 AI 工作台助手。你在一个管理后台中运行，帮助运营人员执行操作和查询数据。

当前用户所在页面: ${currentPage}

你可以使用以下工具（Skill）：
${skillList}

内置操作（不需要 Skill）：
- 查询运营指标 → 调用 query_stats
- 生成报告/分析 → 直接用你的知识回答

## 回复格式规范

你的回复会被渲染为富文本卡片，请善用以下 markdown 格式：

1. **加粗标题**用 **双星号**
2. 列表用 - 开头
3. 链接用 [文字](URL) 格式
4. 推荐文档/资源时，用编号列表+加粗标题+描述的格式，会自动渲染为卡片：
   1. **《文档标题》**
   - 内容：描述
   - 链接：[点击查看](URL)

## 导出操作规范

当用户说"导出"、"下载"、"export"时：
- 必须调用 data_export 工具生成文件
- 工具会返回文件下载链接（files数组中每个元素有url字段）
- 你必须在回复中用 [文件名](URL) 格式给出可点击的下载链接
- 不要只在聊天中列出数据摘要，用户要的是可下载的文件

## 核心原则（违反即失败！）

你是一个工具调用代理，不是知识问答系统。你自己不存储任何业务数据。

### 必须调用工具的场景（没有例外）：
| 用户意图 | 必须调用的工具 | 禁止行为 |
|---------|-------------|---------|
| 查商品/查库存/查价格 | product_query | 不能从对话历史里"回忆"商品数据 |
| 改价/上架/下架/改库存 | product_manage | 不能说"已操作"但没调工具 |
| 搜知识/查文档 | knowledge_search | 不能编造文档链接 |
| 导出/下载 | data_export | 不能只打印数据 |
| 查统计/查运营数据 | query_stats | 不能编数字 |

### 绝对禁止：
1. **禁止编造数据** — 你没有通过工具查询就没有数据，不能根据上下文旧信息或训练知识编造
2. **禁止伪装执行** — 不能说"已成功操作"但 toolsUsed 为空，写操作必须有 tool_call
3. 如果不确定，先调工具再回答

## 后续建议规范（重要）

回答末尾可以提供 1-3 个"下一步建议"，但**必须遵守**：

1. 每个建议必须是你**确实能执行**的操作，即上面的 Skill 列表里有对应工具，或者是导航操作（"打开xxx页面"）
2. **禁止承诺你做不到的事**：
   - ❌ "导出 CSV/Excel" — 除非有 data_export 工具且已验证可用
   - ❌ "生成图表/折线图/柱状图" — 你不会画图
   - ❌ "跳转到 xxx 页" — 必须是菜单里真实存在的页面
   - ❌ "为 xxx 创建营销任务" — 除非有 marketing_create 工具
3. 建议格式：每条独占一行，以 "- " 开头，以 "？" 结尾，例如：
   - 查看昨天的渠道明细？
   - 打开知识库搜索"退货"？
4. 如果没有合适的后续操作，就**不要**列建议，直接结束回答。宁可不建议也不要乱承诺。

## 规则
1. 涉及具体数据 → 必须 tool_call，不能凭记忆
2. 涉及写操作 → 必须 tool_call，不能伪装
3. 回答简洁有力，用结构化格式
4. 始终用中文回答`;
}

// POST /api/harness/chat — 工作台 AI 助手（复用 Harness 会话架构）
router.post('/chat', requireAdmin, async (req, res) => {
  const { message, convId: clientConvId, currentPage = 'dashboard.overview', stream } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  // ===== 流式分支 =====
  if (stream) {
    if (!API_KEY) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'error', message: '未配置 DASHSCOPE_API_KEY' })}\n\n`);
      return res.end();
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const send = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} };

    const adminId = req.session.admin.id;
    const sessionId = `admin:${adminId}`;
    let convId = clientConvId;
    if (!convId) {
      const recent = db.prepare("SELECT id FROM conversations WHERE session_id = ? AND title LIKE '%工作台%' ORDER BY updated_at DESC LIMIT 1").get(sessionId);
      convId = recent ? recent.id : null;
    }
    if (!convId) {
      convId = uuidv4();
      db.prepare('INSERT INTO conversations (id, session_id, title) VALUES (?, ?, ?)').run(convId, sessionId, 'AI工作台对话');
    } else {
      const exists = db.prepare('SELECT id FROM conversations WHERE id = ?').get(convId);
      if (!exists) db.prepare('INSERT INTO conversations (id, session_id, title) VALUES (?, ?, ?)').run(convId, sessionId, 'AI工作台对话');
    }
    send({ type: 'start', convId });

    const permissions = getUserPermissions(adminId);
    const skills = registry.getToolsForRole(permissions);
    const llmTools = [
      { type: 'function', function: { name: 'query_stats', description: '查询运营统计数据', parameters: { type: 'object', properties: { type: { type: 'string', default: 'overview' } } } } },
      ...skills.map(s => ({ type: 'function', function: { name: s.name, description: s.description || s.name, parameters: s.input_schema || { type: 'object', properties: {} } } }))
    ];
    const systemPrompt = buildWorkbenchSystemPrompt(skills, currentPage);

    try {
      const { messages: historyMessages } = await buildContextMessages(convId, 'zh');
      db.prepare('INSERT INTO messages (conv_id, role, content) VALUES (?, ?, ?)').run(convId, 'user', message);
      const contextMsgs = historyMessages.filter(m => m.role === 'user' || m.role === 'assistant');

      // 第一轮非流式：判定是否有 tool_call
      const llmResponse = await callLLM(
        [{ role: 'system', content: systemPrompt }, ...contextMsgs, { role: 'user', content: message }],
        llmTools,
        1024
      );

      let finalMessages;
      if (!llmResponse.tool_calls || !llmResponse.tool_calls.length) {
        // 没有工具调用 → 流式重放第一轮（让用户看到打字效果）
        finalMessages = [{ role: 'system', content: systemPrompt }, ...contextMsgs, { role: 'user', content: message }];
      } else {
        // 有工具调用：先执行，再流式生成最终回复
        send({ type: 'tools', tools: llmResponse.tool_calls.map(tc => tc.function?.name) });
        const toolResults = [];
        for (const tc of llmResponse.tool_calls) {
          const fnName = tc.function?.name;
          let args = {};
          try { args = JSON.parse(tc.function?.arguments || '{}'); } catch {}
          console.log(`[Harness Chat Stream] Tool call: ${fnName}`);
          let result;
          try {
            if (fnName === 'query_stats') result = await queryStats(args.type || 'overview');
            else result = await registry.invoke(fnName, args, { permissions, admin: req.session.admin });
          } catch (err) { result = { error: err.message }; }
          toolResults.push({ role: 'tool', tool_call_id: tc.id, content: typeof result === 'string' ? result : JSON.stringify(result, null, 2) });
        }
        finalMessages = [
          { role: 'system', content: systemPrompt },
          ...contextMsgs,
          { role: 'user', content: message },
          { ...llmResponse, content: llmResponse.content || '' },
          ...toolResults
        ];
      }

      let fullReply = '';
      try {
        fullReply = await callLLMStream(finalMessages, (delta) => {
          send({ type: 'delta', text: delta });
        }, 1024);
      } catch (streamErr) {
        send({ type: 'error', message: streamErr.message });
      }
      if (!fullReply) fullReply = '（空响应）';

      db.prepare('INSERT INTO messages (conv_id, role, content) VALUES (?, ?, ?)').run(convId, 'assistant', fullReply);
      db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(convId);

      const toolsUsed = llmResponse.tool_calls ? llmResponse.tool_calls.map(tc => tc.function?.name) : [];
      send({ type: 'done', toolsUsed, convId });
      res.end();
    } catch (err) {
      console.error('[Harness Chat Stream] Error:', err.message);
      send({ type: 'error', message: err.message });
      res.end();
    }
    return;
  }
  // ===== 非流式分支（保留原逻辑） =====

  if (!API_KEY) {
    return res.json({ reply: '未配置 DASHSCOPE_API_KEY，AI 助手不可用' });
  }

  const adminId = req.session.admin.id;
  const sessionId = `admin:${adminId}`;

  // 复用或创建会话（每个admin用户一个工作台会话）
  let convId = clientConvId;
  if (!convId) {
    // 查找该 admin 最近的工作台会话
    const recent = db.prepare(
      "SELECT id FROM conversations WHERE session_id = ? AND title LIKE '%工作台%' ORDER BY updated_at DESC LIMIT 1"
    ).get(sessionId);
    convId = recent ? recent.id : null;
  }
  if (!convId) {
    convId = uuidv4();
    db.prepare('INSERT INTO conversations (id, session_id, title) VALUES (?, ?, ?)').run(convId, sessionId, 'AI工作台对话');
  } else {
    const exists = db.prepare('SELECT id FROM conversations WHERE id = ?').get(convId);
    if (!exists) {
      db.prepare('INSERT INTO conversations (id, session_id, title) VALUES (?, ?, ?)').run(convId, sessionId, 'AI工作台对话');
    }
  }

  const permissions = getUserPermissions(adminId);
  const skills = registry.getToolsForRole(permissions);

  const llmTools = [
    {
      type: 'function',
      function: {
        name: 'query_stats',
        description: '查询运营统计数据，包括对话数、知识库、好评率等',
        parameters: { type: 'object', properties: { type: { type: 'string', description: '查询类型: overview/knowledge/trend', default: 'overview' } } }
      }
    },
    ...skills.map(s => ({
      type: 'function',
      function: {
        name: s.name,
        description: s.description || s.name,
        parameters: s.input_schema || { type: 'object', properties: {} }
      }
    }))
  ];

  const systemPrompt = buildWorkbenchSystemPrompt(skills, currentPage);

  try {
    // 用 Harness 原生的上下文构建（摘要压缩 + 最近消息）
    const { messages: historyMessages } = await buildContextMessages(convId, 'zh');

    // 保存本轮 user 消息到 DB
    db.prepare('INSERT INTO messages (conv_id, role, content) VALUES (?, ?, ?)').run(convId, 'user', message);

    const contextMsgs = historyMessages.filter(m => m.role === 'user' || m.role === 'assistant');

    // 第一轮：LLM 解析意图
    const llmResponse = await callLLM(
      [{ role: 'system', content: systemPrompt }, ...contextMsgs, { role: 'user', content: message }],
      llmTools,
      1024
    );

    // 没有 tool_call → 直接文本回答
    if (!llmResponse.tool_calls || !llmResponse.tool_calls.length) {
      const reply = llmResponse.content || '我不太理解你的意思，可以再说具体一点吗？';
      db.prepare('INSERT INTO messages (conv_id, role, content) VALUES (?, ?, ?)').run(convId, 'assistant', reply);
      db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(convId);
      return res.json({ reply, convId });
    }

    // 有 tool_call → 执行
    const toolResults = [];
    for (const tc of llmResponse.tool_calls) {
      const fnName = tc.function?.name;
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch {}

      console.log(`[Harness Chat] Tool call: ${fnName}`, JSON.stringify(args).slice(0, 100));

      let result;
      try {
        if (fnName === 'query_stats') {
          result = await queryStats(args.type || 'overview');
        } else {
          result = await registry.invoke(fnName, args, { permissions, admin: req.session.admin });
        }
      } catch (err) {
        result = { error: err.message };
      }

      toolResults.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      });
    }

    // 第二轮：LLM 根据工具结果生成最终回答
    const finalResponse = await callLLM(
      [
        { role: 'system', content: systemPrompt },
        ...contextMsgs,
        { role: 'user', content: message },
        { ...llmResponse, content: llmResponse.content || '' },
        ...toolResults
      ],
      null,
      1024
    );

    const reply = finalResponse.content || '操作完成，但没有返回结果。';
    const toolsUsed = llmResponse.tool_calls.map(tc => tc.function?.name);

    // 保存 assistant 回复到 DB
    db.prepare('INSERT INTO messages (conv_id, role, content) VALUES (?, ?, ?)').run(convId, 'assistant', reply);
    db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(convId);

    res.json({ reply, toolsUsed, convId });
  } catch (err) {
    console.error('[Harness Chat] Error:', err.message);
    res.json({ reply: `处理出错: ${err.message}`, convId });
  }
});

// 内置查询统计
async function queryStats(type) {
  if (type === 'knowledge') {
    const docs = db.prepare('SELECT COUNT(*) AS n FROM knowledge_docs').get().n;
    const vectors = db.prepare('SELECT COUNT(*) AS n FROM knowledge_vectors').get().n;
    let qa = 0, kg = 0;
    try { qa = db.prepare('SELECT COUNT(*) AS n FROM knowledge_qa').get().n; } catch {}
    try { kg = db.prepare('SELECT COUNT(*) AS n FROM kg_entities').get().n; } catch {}
    return { 知识文档: docs, 已向量化: vectors, QA对: qa, 图谱实体: kg };
  }
  if (type === 'trend') {
    return db.prepare(`
      SELECT date(created_at) AS day, COUNT(*) AS n
      FROM conversations WHERE created_at >= datetime('now','-7 days')
      GROUP BY day ORDER BY day
    `).all();
  }
  // overview
  const convCount = db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n;
  const todayConvs = db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE date(created_at)='" + new Date().toISOString().slice(0, 10) + "'").get().n;
  const userMsgs = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE role='user'").get().n;
  const likes = db.prepare("SELECT COUNT(*) AS n FROM message_feedback WHERE rating=1").get().n;
  const dislikes = db.prepare("SELECT COUNT(*) AS n FROM message_feedback WHERE rating=-1").get().n;
  const docs = db.prepare('SELECT COUNT(*) AS n FROM knowledge_docs').get().n;
  return {
    总对话数: convCount, 今日对话: todayConvs, 用户消息总数: userMsgs,
    好评: likes, 差评: dislikes,
    好评率: (likes + dislikes) > 0 ? Math.round(likes / (likes + dislikes) * 100) + '%' : '暂无',
    知识库文档: docs
  };
}

// ====== 文件上传解析（AI聊天附件） ======
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const uploadDir = path.join(__dirname, '..', 'uploads', 'ai-chat');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const aiUpload = multer({ dest: uploadDir, limits: { fileSize: 2 * 1024 * 1024 } });

router.post('/upload', requireAdmin, aiUpload.single('file'), async (req, res) => {
  if (!req.file) return res.json({ error: '未收到文件' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  try {
    let content = '';
    if (['.txt','.md','.csv','.json','.xml','.log','.yaml','.yml','.sql'].includes(ext)) {
      content = fs.readFileSync(req.file.path, 'utf-8');
    } else if (ext === '.xlsx' || ext === '.xls') {
      try {
        const XLSX = require('xlsx');
        const wb = XLSX.readFile(req.file.path);
        const sheets = wb.SheetNames.map(name => {
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
          return `## Sheet: ${name}\n${csv}`;
        });
        content = sheets.join('\n\n');
      } catch { content = '[xlsx解析失败，请安装xlsx依赖]'; }
    } else if (ext === '.docx') {
      try {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: req.file.path });
        content = result.value;
      } catch { content = '[docx解析失败，请安装mammoth依赖]'; }
    } else {
      content = '[不支持的文件格式: ' + ext + ']';
    }
    // 清理临时文件
    fs.unlinkSync(req.file.path);
    res.json({ content, filename: req.file.originalname });
  } catch (e) {
    res.json({ error: e.message });
  }
});

module.exports = router;
