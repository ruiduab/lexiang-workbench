/**
 * L1.2 对话摘要压缩
 *
 * buildContextMessages(convId, lang):
 *   返回注入 LLM 的 messages 数组（含摘要+最近原始消息），并按需触发压缩
 *
 * 策略：
 *   - 保留最近 KEEP_RAW 条原始消息不压缩（保证细节）
 *   - 历史消息总数 > COMPRESS_THRESHOLD 时，把 [摘要点之后 ~ 最近KEEP_RAW条之前] 的部分压缩
 *   - 摘要存 conv_summaries 表，复用已有摘要增量追加
 */

const db = require('../db/schema');
const fetch = require('node-fetch');

// L1.3 滑动窗口截断：按 Token 估算控制历史长度
const MAX_HISTORY_TOKENS = 3000;   // 历史消息最大 token 预算
const COMPRESS_TOKEN_THRESHOLD = 4000; // 未摘要部分估算 token 超过此值时触发压缩

// 兼容旧逻辑的条数阈值（仅用于极短消息兜底）
const KEEP_RAW = 8;           // 最多保留最近 N 条原始消息（token 预算内可保留更多）
const COMPRESS_THRESHOLD = 14; // 条数兜底阈值（token 触发优先）

/**
 * L1.3 Token 估算函数（粗估，不引入新包）
 * 中文字符 × 1.5 + 英文单词数 × 1.3
 */
function estimateTokens(text) {
  if (!text) return 0;
  // 统计中文字符数
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length;
  // 统计英文单词数（剔除中文后剩余文本按空白分词）
  const nonChinese = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, ' ');
  const englishWords = (nonChinese.match(/[a-zA-Z0-9]+/g) || []).length;
  return Math.ceil(chineseChars * 1.5 + englishWords * 1.3);
}

const DASHSCOPE_API_URL = process.env.DASHSCOPE_API_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;

async function summarizeMessages(messages, existingSummary) {
  const turns = messages.map(m => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`).join('\n');
  const prefix = existingSummary
    ? `已有摘要（请在此基础上追加新内容，不要重复）：\n${existingSummary}\n\n新增对话：\n`
    : '以下是一段对话，请提取关键信息做简洁摘要：\n\n';

  const prompt = `${prefix}${turns}\n\n请输出一段简洁的摘要，保留：用户的需求、偏好、明确说过的条件（如预算、场景）、已达成的结论。不超过 300 字。只输出摘要正文，不要标题。`;

  const res = await fetch(`${DASHSCOPE_API_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DASHSCOPE_API_KEY}` },
    body: JSON.stringify({
      model: 'qwen-plus',
      messages: [
        { role: 'system', content: '你是对话摘要助手，只输出摘要正文。' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 512,
      temperature: 0.2
    })
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

/**
 * 构建对话上下文消息数组（供 LLM 使用）
 * 同时异步触发摘要更新（不阻塞当前请求）
 *
 * @param {string} convId
 * @param {string} lang
 * @returns {{ messages: Array, summary: string|null }}
 */
async function buildContextMessages(convId, lang = 'zh') {
  // 取全部历史（只拿 id + role + content）
  const allRows = db.prepare(
    'SELECT id, role, content FROM messages WHERE conv_id = ? ORDER BY created_at ASC'
  ).all(convId);

  if (allRows.length === 0) return { messages: [], summary: null };

  // 读现有摘要
  const summaryRow = db.prepare('SELECT * FROM conv_summaries WHERE conv_id = ?').get(convId);
  const existingSummary = summaryRow?.summary || null;
  const summarizedUpTo = summaryRow?.summarized_up_to || 0; // message.id

  // 找到哪些消息已摘要（id <= summarizedUpTo），哪些还没
  const unsummarizedRows = allRows.filter(r => r.id > summarizedUpTo);
  const totalUnsummarized = unsummarizedRows.length;

  // L1.3 滑动窗口：从最新消息往前累加 token 估算，超过 MAX_HISTORY_TOKENS 就停止
  let tokenBudget = 0;
  let rawRows = [];
  for (let i = allRows.length - 1; i >= 0; i--) {
    const t = estimateTokens(allRows[i].content);
    if (tokenBudget + t > MAX_HISTORY_TOKENS && rawRows.length > 0) break;
    tokenBudget += t;
    rawRows.unshift(allRows[i]);
    // 最多不超过 KEEP_RAW 条（避免大量极短消息占满窗口）
    if (rawRows.length >= KEEP_RAW) break;
  }
  // 兜底：至少保留最新1条
  if (rawRows.length === 0 && allRows.length > 0) {
    rawRows = [allRows[allRows.length - 1]];
  }
  const rawIds = new Set(rawRows.map(r => r.id));

  // 需要压缩的：未摘要且不在 rawRows 里的
  const toCompress = unsummarizedRows.filter(r => !rawIds.has(r.id));

  // L1.3 按 token 估算触发压缩（优先），兜底按条数
  const unsummarizedTokens = unsummarizedRows.reduce((sum, r) => sum + estimateTokens(r.content), 0);
  const shouldCompress = (unsummarizedTokens > COMPRESS_TOKEN_THRESHOLD || totalUnsummarized > COMPRESS_THRESHOLD) && toCompress.length > 0;

  if (shouldCompress) {
    const lastCompressId = toCompress[toCompress.length - 1].id;
    // 异步执行，不阻塞主流程
    setImmediate(async () => {
      try {
        const newSummary = await summarizeMessages(toCompress, existingSummary);
        if (!newSummary) return;
        db.prepare(`
          INSERT INTO conv_summaries (conv_id, summary, summarized_up_to, updated_at)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(conv_id) DO UPDATE SET
            summary = excluded.summary,
            summarized_up_to = excluded.summarized_up_to,
            updated_at = excluded.updated_at
        `).run(convId, newSummary, lastCompressId);
        console.log(`[Compressor] 对话 ${convId} 摘要已更新，压缩到 msg#${lastCompressId}`);
      } catch (e) {
        console.error('[Compressor] 压缩失败:', e.message);
      }
    });
  }

  // 拼接最终 messages：[摘要消息（如有）] + [最近 KEEP_RAW 条原始消息]
  const result = [];
  if (existingSummary) {
    result.push({
      role: 'user',
      content: `[历史摘要]\n${existingSummary}`
    });
    result.push({
      role: 'assistant',
      content: '好的，我已了解之前的对话内容，请继续。'
    });
  }
  result.push(...rawRows.map(r => ({ role: r.role, content: r.content })));

  return { messages: result, summary: existingSummary };
}

module.exports = { buildContextMessages };
