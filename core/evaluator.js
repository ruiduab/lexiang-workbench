'use strict';

const db = require('../db/schema');
const { runAgent } = require('./agent');

/**
 * 运行所有回归测试用例
 * @param {number} limit 最多测试条数
 * @returns {{ total, passed, failed, rate, details }}
 */
async function runRegressionTests(limit = 20) {
  const cases = db.prepare(
    'SELECT * FROM regression_cases ORDER BY id ASC LIMIT ?'
  ).all(limit);

  const details = [];
  let passed = 0;

  for (const c of cases) {
    let keywords;
    try {
      keywords = JSON.parse(c.expected_keywords);
    } catch (_) {
      keywords = [];
    }

    let answer = '';
    try {
      const convId = `regression_${c.id}_${Date.now()}`;
      const result = await runAgent(c.question, convId, 'regression', { lang: 'zh' });
      answer = (result && result.text) ? result.text : (typeof result === 'string' ? result : '');
    } catch (e) {
      answer = '';
    }

    const answerLower = answer.toLowerCase();
    const missingKeywords = keywords.filter(kw => !answerLower.includes(kw.toLowerCase()));
    const ok = missingKeywords.length === 0;
    if (ok) passed++;

    details.push({
      id: c.id,
      question: c.question,
      category: c.category,
      expected_keywords: keywords,
      missing_keywords: missingKeywords,
      passed: ok,
      answer_snippet: answer.slice(0, 200)
    });
  }

  const total = cases.length;
  const failed = total - passed;
  const rate = total > 0 ? Math.round((passed / total) * 100) : 0;

  return { total, passed, failed, rate, details };
}

/**
 * 获取 AB 实验结果统计
 * @param {number} experimentId
 * @returns {{ experiment, variantA, variantB }}
 */
function getExperimentStats(experimentId) {
  const experiment = db.prepare('SELECT * FROM ab_experiments WHERE id = ?').get(experimentId);
  if (!experiment) return null;

  const statsQuery = db.prepare(`
    SELECT
      a.variant,
      COUNT(a.session_id) AS sessions,
      COUNT(f.id) AS feedbacks,
      SUM(CASE WHEN f.rating = 1 THEN 1 ELSE 0 END) AS likes,
      SUM(CASE WHEN f.rating = -1 THEN 1 ELSE 0 END) AS dislikes,
      AVG(CASE WHEN f.rating IS NOT NULL THEN CAST(f.rating AS REAL) ELSE NULL END) AS avg_rating
    FROM ab_assignments a
    LEFT JOIN message_feedback f ON f.session_id = a.session_id
    WHERE a.experiment_id = ?
    GROUP BY a.variant
  `);

  const rows = statsQuery.all(experimentId);
  const variantA = rows.find(r => r.variant === 'a') || { variant: 'a', sessions: 0, feedbacks: 0, likes: 0, dislikes: 0, avg_rating: null };
  const variantB = rows.find(r => r.variant === 'b') || { variant: 'b', sessions: 0, feedbacks: 0, likes: 0, dislikes: 0, avg_rating: null };

  return { experiment, variantA, variantB };
}

/**
 * 为 session 分配 AB 实验组（幂等）
 * @param {string} sessionId
 * @param {number} experimentId
 * @param {number} trafficSplit A组流量比例（0-1）
 * @returns {'a'|'b'}
 */
function assignVariant(sessionId, experimentId, trafficSplit) {
  // 已有分配则返回已有的
  const existing = db.prepare(
    'SELECT variant FROM ab_assignments WHERE session_id = ? AND experiment_id = ?'
  ).get(sessionId, experimentId);
  if (existing) return existing.variant;

  // 新分配
  const variant = Math.random() < trafficSplit ? 'a' : 'b';
  try {
    db.prepare(
      'INSERT INTO ab_assignments (session_id, experiment_id, variant) VALUES (?, ?, ?)'
    ).run(sessionId, experimentId, variant);
  } catch (_) {
    // 并发冲突时重读
    const retry = db.prepare(
      'SELECT variant FROM ab_assignments WHERE session_id = ? AND experiment_id = ?'
    ).get(sessionId, experimentId);
    if (retry) return retry.variant;
  }
  return variant;
}

module.exports = { runRegressionTests, getExperimentStats, assignVariant };
