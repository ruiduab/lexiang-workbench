/**
 * 用户画像模块
 * - extractAndUpdateProfile: 从对话中提取用户信息，异步更新 user_profiles 表
 * - getProfilePrompt: 生成注入 System Prompt 的用户画像描述
 */
const db = require('../db/schema');

// 调用 LLM 提取画像（直接用 inference 层）
async function callLLM(messages) {
  const fetch = require('node-fetch');
  const apiUrl = process.env.DASHSCOPE_API_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const apiKey = process.env.DASHSCOPE_API_KEY;

  const res = await fetch(`${apiUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'qwen-plus', messages, max_tokens: 512, temperature: 0.2 })
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * 从最近一次对话中提取用户画像信息并合并更新
 * @param {number} userId
 * @param {string} userMessage  本轮用户消息
 * @param {string} assistantReply  本轮 AI 回复
 */
async function extractAndUpdateProfile(userId, userMessage, assistantReply) {
  if (!userId) return;

  // 现有画像
  const existing = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId);

  const existingSummary = existing
    ? `当前已知画像：预算=${existing.budget || '未知'}，产品偏好=${existing.product_prefs || '[]'}，使用场景=${existing.use_cases || '[]'}，职业=${existing.occupation || '未知'}，其他=${existing.extra || '{}'}`
    : '当前尚无用户画像记录。';

  const prompt = `你是一个用户画像提取助手。根据以下对话，提取用户的个人信息，以 JSON 格式返回。

${existingSummary}

最新对话：
用户：${userMessage}
助手：${assistantReply.slice(0, 500)}

请提取并更新以下字段（只返回有新信息的字段，没有新信息的字段不要返回，字段值为 null 表示无法确定）：
- budget: 预算区间字符串，如 "3000-5000元"、"5000元以内"
- product_prefs: 产品偏好数组，如 ["ThinkPad", "游戏本", "平板"]
- use_cases: 使用场景数组，如 ["办公", "编程", "游戏", "学习"]
- occupation: 职业或身份字符串，如 "学生"、"IT工程师"、"设计师"
- extra: 其他有价值的偏好对象，如 {"os_pref":"Windows","priority":"轻薄","brand_loyalty":"高"}

只返回 JSON 对象，不要有任何其他文字。如果对话中没有任何有用的用户信息，返回 {}。`;

  try {
    const raw = await callLLM([
      { role: 'system', content: '你是用户画像提取助手，只输出 JSON。' },
      { role: 'user', content: prompt }
    ]);

    // 提取 JSON
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    const extracted = JSON.parse(jsonMatch[0]);
    if (!extracted || Object.keys(extracted).length === 0) return;

    // 合并到现有画像
    const merged = {
      budget: extracted.budget || existing?.budget || null,
      product_prefs: mergeArray(existing?.product_prefs, extracted.product_prefs),
      use_cases: mergeArray(existing?.use_cases, extracted.use_cases),
      occupation: extracted.occupation || existing?.occupation || null,
      extra: mergeExtra(existing?.extra, extracted.extra),
    };

    db.prepare(`
      INSERT INTO user_profiles (user_id, budget, product_prefs, use_cases, occupation, extra, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        budget = excluded.budget,
        product_prefs = excluded.product_prefs,
        use_cases = excluded.use_cases,
        occupation = excluded.occupation,
        extra = excluded.extra,
        updated_at = excluded.updated_at
    `).run(
      userId,
      merged.budget,
      merged.product_prefs,
      merged.use_cases,
      merged.occupation,
      merged.extra
    );

    console.log(`[Profile] 用户 ${userId} 画像已更新:`, JSON.stringify(merged));
  } catch (e) {
    console.error('[Profile] 提取失败:', e.message);
  }
}

function mergeArray(existingJson, newArr) {
  try {
    const existing = existingJson ? JSON.parse(existingJson) : [];
    const next = Array.isArray(newArr) ? newArr : [];
    const merged = [...new Set([...existing, ...next])];
    return merged.length ? JSON.stringify(merged) : null;
  } catch {
    return existingJson || null;
  }
}

function mergeExtra(existingJson, newObj) {
  try {
    const existing = existingJson ? JSON.parse(existingJson) : {};
    const next = (newObj && typeof newObj === 'object') ? newObj : {};
    const merged = { ...existing, ...next };
    return Object.keys(merged).length ? JSON.stringify(merged) : null;
  } catch {
    return existingJson || null;
  }
}

/**
 * 获取注入 System Prompt 的用户画像描述
 * @param {number|null} userId
 * @returns {string} 画像描述，没有画像时返回空字符串
 */
function getProfilePrompt(userId) {
  if (!userId) return '';
  try {
    const p = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId);
    if (!p) return '';

    const parts = [];
    if (p.occupation) parts.push(`身份：${p.occupation}`);
    if (p.budget) parts.push(`预算：${p.budget}`);
    if (p.product_prefs) {
      const arr = JSON.parse(p.product_prefs);
      if (arr.length) parts.push(`产品偏好：${arr.join('、')}`);
    }
    if (p.use_cases) {
      const arr = JSON.parse(p.use_cases);
      if (arr.length) parts.push(`使用场景：${arr.join('、')}`);
    }
    if (p.extra) {
      const obj = JSON.parse(p.extra);
      const extras = Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('、');
      if (extras) parts.push(`其他偏好：${extras}`);
    }

    if (!parts.length) return '';
    return `\n\n## 当前用户画像\n该用户的已知信息：${parts.join('，')}。请在回答中优先考虑这些偏好，提供个性化建议。`;
  } catch {
    return '';
  }
}

module.exports = { extractAndUpdateProfile, getProfilePrompt };
