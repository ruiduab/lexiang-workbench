/**
 * L2.6 自主进化模块（Evolver）
 * 分析 reflection_logs 和 message_feedback，用 LLM 生成行为改进指令，
 * 写入 bot_config 表 key='optimization_notes'，最终注入 System Prompt。
 */

const https = require('https');
const db = require('../db/schema');

const API_KEY = process.env.DASHSCOPE_API_KEY;
const MODEL = 'qwen-plus';
const MIN_FEEDBACK = 5;   // 数据不足阈值：feedback < 5
const MIN_REFLECTION = 5; // 数据不足阈值：reflection < 5
const LLM_TIMEOUT = 15000; // 15秒超时

/**
 * 调用 LLM 生成改进建议（带超时保护）
 */
function callLLMForEvolution(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
      temperature: 0.5
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
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const content = j.choices?.[0]?.message?.content?.trim() || '';
          resolve(content);
        } catch (e) {
          reject(new Error('JSON parse error: ' + data.slice(0, 200)));
        }
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(LLM_TIMEOUT, () => {
      req.destroy();
      reject(new Error('LLM timeout after ' + LLM_TIMEOUT + 'ms'));
    });
    req.write(body);
    req.end();
  });
}

/**
 * 分析近期反馈和反思日志，生成优化建议并写入 bot_config
 * @returns {{ success: boolean, notes?: string, reason?: string, analysisTime: string }}
 */
async function runEvolution() {
  // 1. 查询 reflection_logs 最近30条 score < 60 的记录，统计高频 issue_type
  let reflectionRows = [];
  try {
    reflectionRows = db.prepare(
      'SELECT issue_type, detail FROM reflection_logs WHERE score < 60 ORDER BY created_at DESC LIMIT 30'
    ).all();
  } catch (e) {
    reflectionRows = [];
  }

  // 2. 查询 message_feedback 最近50条 rating=-1 的记录，join 拿到对应问题
  let badFeedbackRows = [];
  try {
    badFeedbackRows = db.prepare(`
      SELECT f.conv_id,
             (SELECT content FROM messages WHERE conv_id=f.conv_id AND role='user' ORDER BY created_at ASC LIMIT 1) AS question
      FROM message_feedback f
      WHERE f.rating = -1
      ORDER BY f.created_at DESC
      LIMIT 50
    `).all();
  } catch (e) {
    badFeedbackRows = [];
  }

  // 3. 数据不足时直接返回，不调 LLM
  if (badFeedbackRows.length < MIN_FEEDBACK && reflectionRows.length < MIN_REFLECTION) {
    console.log('[Evolver] 数据不足（feedback=%d, reflection=%d），跳过进化', badFeedbackRows.length, reflectionRows.length);
    return {
      success: false,
      reason: `数据不足：差评反馈 ${badFeedbackRows.length} 条（需 ≥${MIN_FEEDBACK}），低质回答 ${reflectionRows.length} 条（需 ≥${MIN_REFLECTION}）`,
      analysisTime: new Date().toISOString()
    };
  }

  // 4. 构建分析摘要
  // 统计高频 issue_type
  const issueTypeCount = {};
  for (const row of reflectionRows) {
    const t = row.issue_type || '未知';
    issueTypeCount[t] = (issueTypeCount[t] || 0) + 1;
  }
  const issueTypeSummary = Object.entries(issueTypeCount)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${type}(${count}次)`)
    .join('、') || '无';

  // 取部分反思细节示例（最多5条）
  const reflectionExamples = reflectionRows.slice(0, 5)
    .map(r => `- [${r.issue_type}] ${(r.detail || '').slice(0, 80)}`)
    .join('\n') || '（无）';

  // 取部分差评问题示例（最多8条，去掉 null）
  const badQuestions = badFeedbackRows
    .filter(r => r.question)
    .slice(0, 8)
    .map(r => `- ${r.question.slice(0, 80)}`)
    .join('\n') || '（无）';

  // 5. 构建 LLM prompt
  const prompt = `你是联想乐享AI助手的质量分析专家。
根据以下用户差评和AI自检问题，生成2-3条简洁的行为改进指令，帮助AI改善回答质量。

【用户差评问题（共${badFeedbackRows.length}条，示例）】
${badQuestions}

【AI自检发现的问题类型（最近30条低分回答）】
高频问题：${issueTypeSummary}
细节示例：
${reflectionExamples}

【要求】
- 改进指令要具体、可操作，直接描述AI应该怎么做
- 每条不超过50字
- 只输出改进指令列表，格式：
1. ...
2. ...
3. ...（可选）
- 不要输出分析过程，只输出指令`;

  // 6. 调用 LLM
  let notes;
  try {
    notes = await callLLMForEvolution(prompt);
  } catch (e) {
    console.error('[Evolver] LLM 调用失败:', e.message);
    return {
      success: false,
      reason: 'LLM 调用失败：' + e.message,
      analysisTime: new Date().toISOString()
    };
  }

  if (!notes || notes.trim().length < 10) {
    return {
      success: false,
      reason: 'LLM 返回内容为空或过短',
      analysisTime: new Date().toISOString()
    };
  }

  // 截断到200字
  const truncatedNotes = notes.slice(0, 200);

  // 7. 写入 bot_config 表
  try {
    db.prepare(`
      INSERT INTO bot_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run('optimization_notes', truncatedNotes);
  } catch (e) {
    console.error('[Evolver] 写入 bot_config 失败:', e.message);
    return {
      success: false,
      reason: '写入数据库失败：' + e.message,
      analysisTime: new Date().toISOString()
    };
  }

  // 8. 记录本次分析时间
  try {
    db.prepare(`
      INSERT INTO bot_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run('optimization_last_run', new Date().toISOString());
  } catch (e) {
    // 非关键，忽略
  }

  console.log('[Evolver] 进化完成，已更新 optimization_notes');
  return {
    success: true,
    notes: truncatedNotes,
    dataStats: {
      badFeedback: badFeedbackRows.length,
      lowScoreReflections: reflectionRows.length,
      issueTypes: issueTypeCount
    },
    analysisTime: new Date().toISOString()
  };
}

/**
 * 读取当前 optimization_notes 和上次分析时间
 */
function getEvolutionHistory() {
  try {
    const notesRow = db.prepare("SELECT value, updated_at FROM bot_config WHERE key = 'optimization_notes'").get();
    const lastRunRow = db.prepare("SELECT value FROM bot_config WHERE key = 'optimization_last_run'").get();
    return {
      notes: notesRow ? notesRow.value : null,
      updatedAt: notesRow ? notesRow.updated_at : null,
      lastRun: lastRunRow ? lastRunRow.value : null
    };
  } catch (e) {
    return { notes: null, updatedAt: null, lastRun: null };
  }
}

module.exports = { runEvolution, getEvolutionHistory };
