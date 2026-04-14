/**
 * L2.5 自主反思验证模块
 * 异步对 AI 回答做自评估，记录有问题的回答到 reflection_logs 表
 */
const https = require('https');
const db = require('../db/schema');

const API_KEY = process.env.DASHSCOPE_API_KEY;
const MODEL = 'qwen-plus';
const MAX_ANSWER_LEN = 800;

/**
 * 异步对 AI 回答做自评估
 * @param {string} userMessage - 用户问题
 * @param {string} answer - AI 回答
 * @param {string} convId - 对话 ID
 */
async function reflectOnAnswer(userMessage, answer, convId) {
  // 超过 800 字截取前 800 字控制成本
  const truncatedAnswer = answer.length > MAX_ANSWER_LEN
    ? answer.slice(0, MAX_ANSWER_LEN) + '...(截断)'
    : answer;

  const prompt = `你是一个回答质量评估员，请对以下 AI 助手的回答进行质量检查。

用户问题：${userMessage.slice(0, 300)}

AI 回答：
${truncatedAnswer}

请按以下标准打分并识别问题类型（如有）：

检查项：
1. 是否包含编造的 URL（非 lenovo.com / s.lenovo.com.cn / biz.lenovo.com.cn 域名的商品链接）
2. 是否包含明显的数字矛盾（价格、参数前后不一致）
3. 回答是否完全偏离用户问题（答非所问）

输出格式（严格遵守 JSON，不要输出其他内容）：
{
  "score": <0-100的整数，100为最优>,
  "issue_type": <"fabricated_url" | "contradiction" | "off_topic" | "other" | null>,
  "detail": <如有问题，简洁描述具体问题；无问题则为 null>
}`;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.1
    });

    const req = https.request({
      hostname: 'dashscope.aliyuncs.com',
      path: '/compatible-mode/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const content = j.choices?.[0]?.message?.content?.trim() || '';
          // 提取 JSON
          const match = content.match(/\{[\s\S]*\}/);
          if (!match) return resolve(null);
          const result = JSON.parse(match[0]);
          const score = typeof result.score === 'number' ? result.score : 100;
          // 只记录 score < 80 的问题回答
          if (score < 80 && result.issue_type) {
            db.prepare(
              'INSERT INTO reflection_logs (conv_id, issue_type, detail, score) VALUES (?, ?, ?, ?)'
            ).run(
              convId || null,
              result.issue_type || 'other',
              result.detail || null,
              score
            );
          }
          resolve(result);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

/**
 * 返回近7天的自评估统计（供 admin 查看）
 */
function getReflectionStats() {
  const total = db.prepare(
    "SELECT COUNT(*) AS n FROM reflection_logs WHERE created_at >= datetime('now','-7 days')"
  ).get().n;

  const byType = db.prepare(
    "SELECT issue_type, COUNT(*) AS n FROM reflection_logs WHERE created_at >= datetime('now','-7 days') GROUP BY issue_type ORDER BY n DESC"
  ).all();

  const avgScore = db.prepare(
    "SELECT ROUND(AVG(score),1) AS avg FROM reflection_logs WHERE created_at >= datetime('now','-7 days')"
  ).get().avg;

  const recent = db.prepare(
    "SELECT * FROM reflection_logs ORDER BY created_at DESC LIMIT 20"
  ).all();

  return { total, byType, avgScore, recent };
}

module.exports = { reflectOnAnswer, getReflectionStats };
