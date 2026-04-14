/**
 * L2.1 跨会话记忆（Agentic Memory）
 * L2.3 记忆进化（Memory Evolution）
 *
 * extractAndSaveMemories: 从对话中提取值得跨会话保留的记忆条目，并自动检测/清除冲突旧记忆
 * consolidateMemories: 合并高度相似的记忆条目（>15条时触发，异步）
 * getMemoryPrompt: 生成注入 System Prompt 的记忆描述（带30秒内存缓存）
 *
 * 和 profiler 的区别：
 *   - profiler: 结构化用户画像（预算/偏好/职业等固定字段）
 *   - memory: 任意粒度的事实/决策/目标，自然语言存储，更灵活
 */

const db = require('../db/schema');
const fetch = require('node-fetch');

const DASHSCOPE_API_URL = process.env.DASHSCOPE_API_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
const MAX_MEMORIES = 20; // 每用户最多保留记忆条数（按重要性+时间淘汰）
const CONSOLIDATE_THRESHOLD = 15; // 超过此数量时触发合并

// ── 内存缓存层（L2.3）──────────────────────────────────────────
// key: userId, value: { prompt, expiresAt }
const memoryPromptCache = new Map();
const CACHE_TTL_MS = 30 * 1000; // 30 秒

function getCachedPrompt(userId) {
  const entry = memoryPromptCache.get(userId);
  if (entry && entry.expiresAt > Date.now()) return entry.prompt;
  memoryPromptCache.delete(userId);
  return null;
}

function setCachedPrompt(userId, prompt) {
  memoryPromptCache.set(userId, { prompt, expiresAt: Date.now() + CACHE_TTL_MS });
}

function invalidateCache(userId) {
  memoryPromptCache.delete(userId);
}

// ── LLM 工具 ──────────────────────────────────────────────────
async function callLLM(prompt) {
  const res = await fetch(`${DASHSCOPE_API_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DASHSCOPE_API_KEY}` },
    body: JSON.stringify({
      model: 'qwen-plus',
      messages: [
        { role: 'system', content: '你是记忆提取助手，只输出 JSON 数组。' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 512,
      temperature: 0.2
    })
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// 用于冲突判断和合并的单条 LLM 调用（返回 JSON 对象）
async function callLLMForConflict(systemMsg, userMsg) {
  const res = await fetch(`${DASHSCOPE_API_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DASHSCOPE_API_KEY}` },
    body: JSON.stringify({
      model: 'qwen-plus',
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg }
      ],
      max_tokens: 256,
      temperature: 0.1
    })
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ── 冲突检测（L2.3）──────────────────────────────────────────
/**
 * 对一条新记忆，检查已有同类型记忆中是否存在冲突/过时的条目
 * 先用简单字符串粗筛候选，再用 LLM 细判
 * 冲突则删除旧条目，让新记忆覆盖
 */
async function resolveConflicts(userId, newItem) {
  // 读取同类型的已有记忆
  const candidates = db.prepare(
    'SELECT id, content FROM user_memories WHERE user_id = ? AND type = ? ORDER BY importance DESC, created_at DESC LIMIT 10'
  ).all(userId, newItem.type);

  if (!candidates.length) return;

  // 粗筛：提取候选中关键词重叠的
  const newWords = new Set(newItem.content.replace(/[，。！？\s]/g, '').split(''));
  const shortlist = candidates.filter(c => {
    const words = c.content.replace(/[，。！？\s]/g, '').split('');
    const overlap = words.filter(w => newWords.has(w)).length;
    return overlap >= 2; // 至少2个字符重叠才值得 LLM 细判
  });

  if (!shortlist.length) return;

  const prompt = `判断新记忆是否与已有记忆存在语义冲突（新的覆盖/替代旧的）。
新记忆：${newItem.content}
已有记忆（JSON 数组，每项含 id 和 content）：
${JSON.stringify(shortlist.map(c => ({ id: c.id, content: c.content })))}

规则：
- 冲突 = 新旧记忆描述同一事物但内容矛盾（如预算从3000变6000、已决定换型号等）
- 不冲突 = 仅话题相关但不矛盾

只输出 JSON：{ "conflict_ids": [要删除的旧记忆 id 数组，无冲突则为 []] }`;

  try {
    const raw = await callLLMForConflict('你是记忆冲突判断助手，只输出 JSON 对象。', prompt);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return;
    const result = JSON.parse(match[0]);
    const toDelete = result.conflict_ids;
    if (!Array.isArray(toDelete) || !toDelete.length) return;

    const del = db.prepare('DELETE FROM user_memories WHERE id = ? AND user_id = ?');
    toDelete.forEach(id => del.run(id, userId));
    console.log(`[Memory] 用户 ${userId} 冲突清理：删除 ${toDelete.length} 条旧记忆 [${toDelete.join(',')}]`);
  } catch (e) {
    console.error('[Memory] 冲突检测失败（不影响主流程）:', e.message);
  }
}

// ── 记忆合并（L2.3）──────────────────────────────────────────
/**
 * 合并同类型重复/高度相似记忆
 * 超过 CONSOLIDATE_THRESHOLD 条时触发，异步执行不阻塞
 */
async function consolidateMemories(userId) {
  const count = db.prepare('SELECT COUNT(*) as n FROM user_memories WHERE user_id = ?').get(userId).n;
  if (count <= CONSOLIDATE_THRESHOLD) return;

  // 按 type 分组，找同类型超过2条的
  const groups = db.prepare(
    'SELECT type, COUNT(*) as n FROM user_memories WHERE user_id = ? GROUP BY type HAVING n >= 2'
  ).all(userId);

  if (!groups.length) return;

  for (const group of groups) {
    const rows = db.prepare(
      'SELECT id, content, importance FROM user_memories WHERE user_id = ? AND type = ? ORDER BY importance DESC, created_at DESC'
    ).all(userId, group.type);

    if (rows.length < 2) continue;

    const prompt = `以下是同一用户同类型（${group.type}）的记忆条目，请找出内容高度相似（重复或语义几乎相同）的组，将每组合并为一条简洁记忆。

记忆列表：
${JSON.stringify(rows.map(r => ({ id: r.id, content: r.content, importance: r.importance })))}

规则：
- 只合并内容高度相似的（90%以上语义重叠），不同事情不要合并
- 合并后保留最高重要性
- 未参与合并的 id 不返回

只输出 JSON 数组：[{ "delete_ids": [要删除的旧id数组], "keep_id": 保留的id, "merged_content": "合并后的内容" }]
没有可合并的返回 []`;

    try {
      const raw = await callLLMForConflict('你是记忆合并助手，只输出 JSON 数组。', prompt);
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) continue;
      const merges = JSON.parse(match[0]);
      if (!Array.isArray(merges) || !merges.length) continue;

      const delStmt = db.prepare('DELETE FROM user_memories WHERE id = ? AND user_id = ?');
      const updateStmt = db.prepare('UPDATE user_memories SET content = ?, importance = MAX(importance, ?) WHERE id = ? AND user_id = ?');

      for (const m of merges) {
        if (!m.keep_id || !Array.isArray(m.delete_ids) || !m.merged_content) continue;
        // 找 keep 记录的当前 importance
        const keepRow = rows.find(r => r.id === m.keep_id);
        if (!keepRow) continue;
        const maxImportance = rows
          .filter(r => m.delete_ids.includes(r.id) || r.id === m.keep_id)
          .reduce((max, r) => Math.max(max, r.importance), 1);

        updateStmt.run(m.merged_content.slice(0, 100), maxImportance, m.keep_id, userId);
        m.delete_ids.forEach(id => delStmt.run(id, userId));
      }

      console.log(`[Memory] 用户 ${userId} 合并完成 type=${group.type}，合并 ${merges.length} 组`);
    } catch (e) {
      console.error('[Memory] 合并失败（不影响主流程）:', e.message);
    }
  }
}

/**
 * 从本轮对话中提取值得长期记忆的信息，异步存储
 * L2.3 新增：存储前先做冲突检测，存储后检查是否触发合并
 * @param {number} userId
 * @param {string} userMessage
 * @param {string} assistantReply
 * @param {string} convId
 */
async function extractAndSaveMemories(userId, userMessage, assistantReply, convId) {
  if (!userId) return;

  // 读取已有记忆（用于去重判断）
  const existing = db.prepare(
    'SELECT content FROM user_memories WHERE user_id = ? ORDER BY importance DESC, created_at DESC LIMIT 10'
  ).all(userId).map(r => r.content);

  const existingSummary = existing.length
    ? `已有记忆（避免重复提取）：\n${existing.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
    : '暂无已有记忆。';

  const prompt = `你是一个记忆提取助手。分析以下一轮对话，提取值得跨会话长期记住的用户信息。

${existingSummary}

本轮对话：
用户：${userMessage}
助手：${assistantReply.slice(0, 600)}

请提取以下类型的信息（如果有的话）：
- preference（偏好）：用户对产品/服务/体验的明确偏好
- goal（目标）：用户正在尝试达成的目标或任务
- fact（事实）：关于用户的客观信息（职业、设备、已有产品等）
- decision（决策）：用户做出的明确购买/选择决定

每条记忆格式：{ "type": "preference|goal|fact|decision", "content": "简洁的自然语言描述", "importance": 1-5 }

规则：
- 只提取有价值的新信息，已有记忆里有的不要重复
- 每条 content 不超过50个字
- 重要性：5=非常重要（明确购买决策），4=重要（明确需求/目标），3=一般，1-2=可有可无
- 没有值得记忆的信息时返回 []

只返回 JSON 数组，不要任何其他文字。`;

  try {
    const raw = await callLLM(prompt);
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return;
    const items = JSON.parse(match[0]);
    if (!Array.isArray(items) || items.length === 0) return;

    // L2.3：逐条做冲突检测，删除旧的矛盾记忆
    for (const item of items) {
      if (item.content && item.type) {
        await resolveConflicts(userId, item);
      }
    }

    const insert = db.prepare(
      'INSERT INTO user_memories (user_id, type, content, source_conv_id, importance) VALUES (?, ?, ?, ?, ?)'
    );
    items.forEach(item => {
      if (item.content && item.type) {
        insert.run(userId, item.type, item.content.slice(0, 100), convId, Math.min(5, Math.max(1, item.importance || 3)));
      }
    });

    // 超出 MAX_MEMORIES 时删除最不重要的旧记忆
    const count = db.prepare('SELECT COUNT(*) as n FROM user_memories WHERE user_id = ?').get(userId).n;
    if (count > MAX_MEMORIES) {
      db.prepare(`
        DELETE FROM user_memories WHERE id IN (
          SELECT id FROM user_memories WHERE user_id = ?
          ORDER BY importance ASC, created_at ASC
          LIMIT ?
        )
      `).run(userId, count - MAX_MEMORIES);
    }

    // L2.3：清除缓存（有新记忆写入）
    invalidateCache(userId);

    console.log(`[Memory] 用户 ${userId} 新增 ${items.length} 条记忆`);

    // L2.3：异步合并（不阻塞主流程）
    consolidateMemories(userId).catch(e => {
      console.error('[Memory] 合并任务异常:', e.message);
    });
  } catch (e) {
    console.error('[Memory] 提取失败:', e.message);
  }
}

/**
 * 获取注入 System Prompt 的记忆描述（L2.3 带30秒缓存）
 * @param {number|null} userId
 * @returns {string}
 */
function getMemoryPrompt(userId) {
  if (!userId) return '';

  // L2.3：优先返回缓存
  const cached = getCachedPrompt(userId);
  if (cached !== null) return cached;

  try {
    const rows = db.prepare(
      'SELECT type, content FROM user_memories WHERE user_id = ? ORDER BY importance DESC, created_at DESC LIMIT 8'
    ).all(userId);
    if (!rows.length) {
      setCachedPrompt(userId, '');
      return '';
    }

    const lines = rows.map(r => {
      const typeLabel = { preference: '偏好', goal: '目标', fact: '已知事实', decision: '决策' }[r.type] || r.type;
      return `- [${typeLabel}] ${r.content}`;
    });

    const prompt = `\n\n## 用户历史记忆\n以下是该用户在历史会话中留下的关键信息，请结合这些信息提供更精准的回答：\n${lines.join('\n')}`;
    setCachedPrompt(userId, prompt);
    return prompt;
  } catch {
    return '';
  }
}

module.exports = { extractAndSaveMemories, getMemoryPrompt, consolidateMemories };
