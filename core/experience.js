/**
 * L2.2 经验记忆（高频问题路径复用）
 *
 * recordExperience: 对话结束后异步提取问题模式和回答要点，相似的合并累计
 * getRelevantExperience: 用 FTS5 检索相似历史问题，返回有效回答提示
 *
 * 设计原则：
 *   - 不区分用户，经验是全局共享的（群体智慧）
 *   - hit_count >= 2 才注入 System Prompt，避免噪音
 *   - 使用 FTS5 全文检索相似问题，不引入新依赖
 *   - 回答要点是策略提示，不是完整回答
 */

const https = require('https');
const db = require('../db/schema');

const API_KEY = process.env.DASHSCOPE_API_KEY;
const MODEL = 'qwen-plus';

function callLLM(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: '你是经验提取助手，只输出 JSON 对象。' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 300,
      temperature: 0.2
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
        try { resolve(JSON.parse(data).choices?.[0]?.message?.content?.trim() || ''); }
        catch { resolve(''); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('LLM timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * 对话结束后异步提取问题模式和回答要点，存入经验库
 * 相似的已有记录会合并（hit_count++），新记录直接插入
 * @param {string} question - 用户问题
 * @param {string} answer   - AI 回答
 */
async function recordExperience(question, answer) {
  if (!question || !answer) return;

  // 先检索是否有相似的已有模式（避免重复创建）
  let existingPatternId = null;
  try {
    const similar = db.prepare(`
      SELECT ep.id, ep.pattern
      FROM experience_fts ef
      JOIN experience_patterns ep ON ep.id = ef.pattern_id
      WHERE experience_fts MATCH ?
      ORDER BY rank
      LIMIT 1
    `).get(question.replace(/['"]/g, ' '));

    if (similar) {
      // 有相似记录，直接累计命中次数
      db.prepare(`
        UPDATE experience_patterns
        SET hit_count = hit_count + 1, last_hit = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(similar.id);
      console.log(`[Experience] 合并到已有模式 #${similar.id}，hit_count++`);
      return;
    }
  } catch (e) {
    // FTS 检索失败不影响插入新记录
  }

  // 调用 LLM 提取模式和要点
  const prompt = `分析以下一轮用户对话，提取：
1. 问题模式（pattern）：用户问题的抽象归纳，去掉具体产品型号等细节，保留问题类型，不超过30字
2. 回答要点（answer_tips）：对这类问题有效的回答策略/要点，不超过80字，供AI下次参考

用户问题：${question.slice(0, 300)}
AI回答摘要：${answer.slice(0, 400)}

只返回 JSON 对象，格式：{"pattern": "...", "answer_tips": "..."}
不要任何其他文字。`;

  try {
    const raw = await callLLM(prompt);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return;
    const item = JSON.parse(match[0]);
    if (!item.pattern || !item.answer_tips) return;

    // 插入新经验记录
    const result = db.prepare(`
      INSERT INTO experience_patterns (pattern, answer_tips) VALUES (?, ?)
    `).run(item.pattern.slice(0, 100), item.answer_tips.slice(0, 200));

    const newId = result.lastInsertRowid;

    // 同步写入 FTS 索引
    db.prepare(`
      INSERT INTO experience_fts (pattern_id, pattern) VALUES (?, ?)
    `).run(newId, item.pattern.slice(0, 100));

    console.log(`[Experience] 新增经验模式 #${newId}: ${item.pattern}`);
  } catch (e) {
    console.error('[Experience] 提取失败:', e.message);
  }
}

/**
 * 检索与当前问题相似的高频经验，返回注入 System Prompt 的提示段落
 * 只返回 hit_count >= 2 的记录（避免噪音）
 * @param {string} question
 * @returns {string} 注入段落，无相关经验时返回空字符串
 */
function getRelevantExperience(question) {
  if (!question) return '';
  try {
    // FTS5 检索，只取 hit_count >= 2 的高频模式
    const rows = db.prepare(`
      SELECT ep.pattern, ep.answer_tips, ep.hit_count
      FROM experience_fts ef
      JOIN experience_patterns ep ON ep.id = ef.pattern_id
      WHERE experience_fts MATCH ? AND ep.hit_count >= 2
      ORDER BY rank
      LIMIT 3
    `).all(question.replace(/['"]/g, ' '));

    if (!rows || rows.length === 0) return '';

    const lines = rows.map(r =>
      `- 【常见问题】${r.pattern}（被问过${r.hit_count}次）\n  回答策略：${r.answer_tips}`
    );

    return `\n\n## 经验参考（高频问题回答策略）\n以下是该类问题的有效回答策略，请参考：\n${lines.join('\n')}`;
  } catch (e) {
    return '';
  }
}

module.exports = { recordExperience, getRelevantExperience };
