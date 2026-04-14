/**
 * L2.8 Agent 持续学习模块（Learner）
 *
 * 行为蒸馏：从高质量对话提取 few-shot 示范，从失败案例提取改进点，
 * 并自动生成回归测试用例（Data 进化）。
 *
 * 与 evolver.js 的分工：
 *   - evolver: 改 optimization_notes（行为改进指令）
 *   - learner: 改 few_shot_demos（优质回答示范）+ failure_patterns（失败模式）
 *              + 自动生成 regression_cases（Data 进化）
 */

const https = require('https');
const db = require('../db/schema');

const API_KEY = process.env.DASHSCOPE_API_KEY;
const MODEL = 'qwen-plus';
const LLM_TIMEOUT = 15000;

// 数据不足阈值
const MIN_FEEDBACK = 3;
const MIN_REFLECTION = 3;

// 字数限制
const MAX_FEW_SHOT_DEMOS = 400;
const MAX_FAILURE_PATTERNS = 200;

/**
 * 调用 LLM（带超时保护，失败时 resolve('')）
 */
function callLLMSilent(prompt, maxTokens = 400) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.4
    });

    try {
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
            resolve(j.choices?.[0]?.message?.content?.trim() || '');
          } catch (e) {
            resolve('');
          }
        });
        res.on('error', () => resolve(''));
      });

      req.on('error', () => resolve(''));
      req.setTimeout(LLM_TIMEOUT, () => {
        req.destroy();
        resolve('');
      });
      req.write(body);
      req.end();
    } catch (e) {
      resolve('');
    }
  });
}

/**
 * upsert bot_config
 */
function upsertBotConfig(key, value) {
  db.prepare(`
    INSERT INTO bot_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value);
}

/**
 * 从高质量对话中提取 few-shot 示范案例
 * - 查 message_feedback rating=1（赞）+ reflection_logs score>=80 的对话
 * - 提炼成 2-3 条"示范对话摘要"（问题类型+回答策略）
 * - 写入 bot_config key='few_shot_demos'
 */
async function extractDemonstrations(limit = 5) {
  // 查有点赞反馈的对话
  let goodFeedbackRows = [];
  try {
    goodFeedbackRows = db.prepare(`
      SELECT f.conv_id,
             (SELECT content FROM messages WHERE conv_id=f.conv_id AND role='user' ORDER BY created_at ASC LIMIT 1) AS question,
             (SELECT content FROM messages WHERE conv_id=f.conv_id AND role='assistant' ORDER BY created_at ASC LIMIT 1) AS answer
      FROM message_feedback f
      WHERE f.rating = 1
      ORDER BY f.created_at DESC
      LIMIT ?
    `).all(limit * 2);
  } catch (e) {
    goodFeedbackRows = [];
  }

  // 查高质量反思记录（score >= 80）
  let goodReflectionRows = [];
  try {
    goodReflectionRows = db.prepare(`
      SELECT r.conv_id, r.score,
             (SELECT content FROM messages WHERE conv_id=r.conv_id AND role='user' ORDER BY created_at ASC LIMIT 1) AS question,
             (SELECT content FROM messages WHERE conv_id=r.conv_id AND role='assistant' ORDER BY created_at ASC LIMIT 1) AS answer
      FROM reflection_logs r
      WHERE r.score >= 80
      ORDER BY r.score DESC, r.created_at DESC
      LIMIT ?
    `).all(limit * 2);
  } catch (e) {
    goodReflectionRows = [];
  }

  // 数据不足时跳过
  if (goodFeedbackRows.length < MIN_FEEDBACK && goodReflectionRows.length < MIN_REFLECTION) {
    console.log('[Learner] extractDemonstrations: 数据不足（feedback=%d, reflection=%d），跳过',
      goodFeedbackRows.length, goodReflectionRows.length);
    return { skipped: true, reason: `数据不足：好评 ${goodFeedbackRows.length} 条（需 ≥${MIN_FEEDBACK}），高质反思 ${goodReflectionRows.length} 条（需 ≥${MIN_REFLECTION}）` };
  }

  // 合并去重，最多取 limit 条
  const seenConv = new Set();
  const candidates = [];
  for (const r of [...goodFeedbackRows, ...goodReflectionRows]) {
    if (r.question && r.answer && !seenConv.has(r.conv_id)) {
      seenConv.add(r.conv_id);
      candidates.push(r);
      if (candidates.length >= limit) break;
    }
  }

  if (candidates.length === 0) {
    return { skipped: true, reason: '无有效对话数据' };
  }

  // 构建 LLM prompt，提炼示范摘要
  const examplesText = candidates.map((c, i) =>
    `示例${i + 1}：\n用户问：${c.question.slice(0, 150)}\nAI答要点：${c.answer.slice(0, 200)}`
  ).join('\n\n');

  const prompt = `你是联想乐享AI助手的学习分析师。
分析以下高质量对话案例，提炼出 2-3 条"回答策略示范"（总计不超过 ${MAX_FEW_SHOT_DEMOS} 字）。

每条格式：[问题类型] 回答策略要点（20-40字，描述怎么答而不是复述内容）

【高质量对话样本】
${examplesText}

只输出策略条目，不要分析过程，不要重复问题内容，格式示例：
[产品推荐] 先了解预算和使用场景，再给出具体型号+核心优势对比，结尾附官网购买链接
[故障排查] 按"现象→可能原因→操作步骤"结构回答，操作步骤用数字编号`;

  const content = await callLLMSilent(prompt, 300);

  if (!content || content.trim().length < 10) {
    return { skipped: true, reason: 'LLM 返回内容为空' };
  }

  const demos = content.trim().slice(0, MAX_FEW_SHOT_DEMOS);

  try {
    upsertBotConfig('few_shot_demos', demos);
    console.log('[Learner] extractDemonstrations: 已更新 few_shot_demos，%d 字', demos.length);
    return { success: true, demos, candidateCount: candidates.length };
  } catch (e) {
    console.error('[Learner] 写入 few_shot_demos 失败:', e.message);
    return { skipped: true, reason: '写入失败: ' + e.message };
  }
}

/**
 * 从失败案例中提取改进点
 * - 查 reflection_logs score<60 的记录
 * - 提取失败模式，更新 bot_config key='failure_patterns'
 */
async function learnFromFailures(limit = 10) {
  let failureRows = [];
  try {
    failureRows = db.prepare(`
      SELECT issue_type, detail, score
      FROM reflection_logs
      WHERE score < 60
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);
  } catch (e) {
    failureRows = [];
  }

  if (failureRows.length < 2) {
    console.log('[Learner] learnFromFailures: 失败样本不足（%d 条），跳过', failureRows.length);
    return { skipped: true, reason: `失败样本 ${failureRows.length} 条，需 ≥2` };
  }

  // 统计高频 issue_type
  const issueCount = {};
  for (const r of failureRows) {
    const t = r.issue_type || '未知';
    issueCount[t] = (issueCount[t] || 0) + 1;
  }
  const topIssues = Object.entries(issueCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => `${type}(${count}次)`)
    .join('、');

  const details = failureRows.slice(0, 5)
    .map(r => `[${r.issue_type}] ${(r.detail || '').slice(0, 80)}`)
    .join('\n');

  const prompt = `你是质量分析专家。
根据以下 AI 回答失败案例，总结 2-3 条简洁的"注意事项"（总计不超过 ${MAX_FAILURE_PATTERNS} 字）。

【高频问题类型】${topIssues}
【案例细节】
${details}

每条格式：[类型] 注意要点（15-30字）
只输出条目，不要分析过程：`;

  const content = await callLLMSilent(prompt, 200);

  if (!content || content.trim().length < 10) {
    return { skipped: true, reason: 'LLM 返回内容为空' };
  }

  const patterns = content.trim().slice(0, MAX_FAILURE_PATTERNS);

  try {
    upsertBotConfig('failure_patterns', patterns);
    console.log('[Learner] learnFromFailures: 已更新 failure_patterns，%d 字', patterns.length);
    return { success: true, patterns, sampleCount: failureRows.length };
  } catch (e) {
    console.error('[Learner] 写入 failure_patterns 失败:', e.message);
    return { skipped: true, reason: '写入失败: ' + e.message };
  }
}

/**
 * 从高频用户问题自动生成回归测试用例（Data 进化）
 * - 查 experience_patterns hit_count >= 2
 * - 跳过已有相似用例的（FTS 粗匹配）
 * - 生成新用例写入 regression_cases
 */
async function generateRegressionCases(limit = 5) {
  // 查高频问题模式
  let patterns = [];
  try {
    patterns = db.prepare(`
      SELECT id, pattern, answer_hint, hit_count
      FROM experience_patterns
      WHERE hit_count >= 2
      ORDER BY hit_count DESC
      LIMIT ?
    `).all(limit * 3); // 多取一些，后面过滤已有的
  } catch (e) {
    console.error('[Learner] 查 experience_patterns 失败:', e.message);
    return { skipped: true, reason: '查询 experience_patterns 失败: ' + e.message };
  }

  if (patterns.length === 0) {
    return { skipped: true, reason: '无高频问题模式（hit_count >= 2）' };
  }

  // 查已有回归用例，用于去重
  let existingCases = [];
  try {
    existingCases = db.prepare('SELECT question FROM regression_cases').all()
      .map(r => r.question.toLowerCase());
  } catch (e) {
    existingCases = [];
  }

  // 过滤掉已有相似用例（关键词粗匹配）
  const newPatterns = patterns.filter(p => {
    const patternLower = p.pattern.toLowerCase();
    // 如果 pattern 的前10字在已有用例中出现过，认为已有
    const key = patternLower.slice(0, 10);
    return !existingCases.some(q => q.includes(key));
  }).slice(0, limit);

  if (newPatterns.length === 0) {
    return { skipped: true, reason: '所有高频问题已有对应回归用例' };
  }

  let generated = 0;
  for (const p of newPatterns) {
    // 构建 prompt，让 LLM 生成测试用例
    const prompt = `根据以下高频用户问题模式，生成一个回归测试用例。

问题模式：${p.pattern}
回答提示：${(p.answer_hint || '').slice(0, 100)}

要求：
1. 生成一个具体的测试问题（不超过30字，自然口语）
2. 生成 3-5 个期望关键词（JSON数组，每个词2-6字）
3. 给出分类标签（一个词，如：产品推荐/故障排查/价格咨询/配置查询/售后服务）

只输出JSON，格式：{"question":"...","keywords":["词1","词2","词3"],"category":"..."}`;

    const content = await callLLMSilent(prompt, 150);
    if (!content) continue;

    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) continue;
      const obj = JSON.parse(match[0]);
      if (!obj.question || !Array.isArray(obj.keywords) || obj.keywords.length === 0) continue;

      db.prepare(
        'INSERT INTO regression_cases (question, expected_keywords, category) VALUES (?, ?, ?)'
      ).run(
        obj.question.trim().slice(0, 100),
        JSON.stringify(obj.keywords.slice(0, 5)),
        obj.category || null
      );
      generated++;
      console.log('[Learner] 生成回归用例: %s', obj.question);
    } catch (e) {
      // JSON 解析失败，跳过
    }
  }

  return { success: generated > 0, generated, patternsChecked: newPatterns.length };
}

/**
 * 运行完整学习周期
 */
async function runLearningCycle() {
  const startTime = Date.now();
  console.log('[Learner] 开始学习周期...');

  const results = {};

  // 1. 提取 few-shot 示范
  try {
    results.demonstrations = await extractDemonstrations(5);
  } catch (e) {
    console.error('[Learner] extractDemonstrations 异常:', e.message);
    results.demonstrations = { skipped: true, reason: e.message };
  }

  // 2. 从失败案例学习
  try {
    results.failures = await learnFromFailures(10);
  } catch (e) {
    console.error('[Learner] learnFromFailures 异常:', e.message);
    results.failures = { skipped: true, reason: e.message };
  }

  // 3. 生成回归测试用例
  try {
    results.regressionCases = await generateRegressionCases(5);
  } catch (e) {
    console.error('[Learner] generateRegressionCases 异常:', e.message);
    results.regressionCases = { skipped: true, reason: e.message };
  }

  const elapsed = Date.now() - startTime;
  const now = new Date().toISOString();

  // 记录本次执行时间
  try {
    upsertBotConfig('last_learning_at', now);
  } catch (e) {
    // 非关键，忽略
  }

  console.log('[Learner] 学习周期完成，耗时 %dms', elapsed);
  return { success: true, results, elapsed, runAt: now };
}

/**
 * 读取学习状态
 */
function getLearningStatus() {
  try {
    const lastAt = db.prepare("SELECT value FROM bot_config WHERE key='last_learning_at'").get();
    const demos = db.prepare("SELECT value, updated_at FROM bot_config WHERE key='few_shot_demos'").get();
    const failures = db.prepare("SELECT value, updated_at FROM bot_config WHERE key='failure_patterns'").get();
    const regCount = db.prepare('SELECT COUNT(*) AS n FROM regression_cases').get();

    return {
      lastLearningAt: lastAt ? lastAt.value : null,
      fewShotDemos: demos ? demos.value : null,
      fewShotDemosUpdatedAt: demos ? demos.updated_at : null,
      failurePatterns: failures ? failures.value : null,
      regressionCaseCount: regCount ? regCount.n : 0
    };
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = {
  extractDemonstrations,
  learnFromFailures,
  generateRegressionCases,
  runLearningCycle,
  getLearningStatus
};
