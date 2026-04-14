/**
 * L3.4 可观测监控模块
 * 采集关键指标快照，检查告警阈值
 */
const db = require('../db/schema');

// 阈值配置
const THRESHOLDS = {
  reflection_error_rate: { warn: 0.3, label: '反思错误率过高' },
  msg_count_1h: { warn: 200, label: '高流量提示' },
};

/**
 * 采集一次当前快照，写入 metrics_snapshots
 */
async function collectMetrics() {
  const now = new Date();

  // 1. active_users_1h: 过去1小时有对话的 session 数
  const activeUsers = db.prepare(`
    SELECT COUNT(DISTINCT session_id) AS n FROM conversations
    WHERE created_at >= datetime('now', '-1 hour')
  `).get().n;

  // 2. msg_count_1h: 过去1小时消息数
  const msgCount1h = db.prepare(`
    SELECT COUNT(*) AS n FROM messages
    WHERE created_at >= datetime('now', '-1 hour')
  `).get().n;

  // 3. avg_msg_length: 过去1小时 assistant 消息平均字数（中文按字符数）
  const avgLengthRow = db.prepare(`
    SELECT AVG(LENGTH(content)) AS avg_len FROM messages
    WHERE role = 'assistant' AND created_at >= datetime('now', '-1 hour')
  `).get();
  const avgMsgLength = avgLengthRow.avg_len ? Math.round(avgLengthRow.avg_len) : 0;

  // 4. reflection_error_rate: 过去1小时 reflection_logs 中 score<60 的比例
  let reflectionErrorRate = 0;
  try {
    const totalRefl = db.prepare(`
      SELECT COUNT(*) AS n FROM reflection_logs
      WHERE created_at >= datetime('now', '-1 hour')
    `).get().n;
    if (totalRefl > 0) {
      const badRefl = db.prepare(`
        SELECT COUNT(*) AS n FROM reflection_logs
        WHERE score < 60 AND created_at >= datetime('now', '-1 hour')
      `).get().n;
      reflectionErrorRate = Math.round((badRefl / totalRefl) * 1000) / 1000;
    }
  } catch (e) {
    // reflection_logs 表可能不存在，忽略
  }

  // 5. knowledge_hit_rate: 过去1小时 assistant 消息中包含 "📎" 的比例（引用知识库）
  let knowledgeHitRate = 0;
  const totalAssist = db.prepare(`
    SELECT COUNT(*) AS n FROM messages
    WHERE role = 'assistant' AND created_at >= datetime('now', '-1 hour')
  `).get().n;
  if (totalAssist > 0) {
    const hitCount = db.prepare(`
      SELECT COUNT(*) AS n FROM messages
      WHERE role = 'assistant' AND content LIKE '%📎%' AND created_at >= datetime('now', '-1 hour')
    `).get().n;
    knowledgeHitRate = Math.round((hitCount / totalAssist) * 1000) / 1000;
  }

  const metrics = {
    active_users_1h: activeUsers,
    msg_count_1h: msgCount1h,
    avg_msg_length: avgMsgLength,
    reflection_error_rate: reflectionErrorRate,
    knowledge_hit_rate: knowledgeHitRate,
  };

  // 写入 metrics_snapshots
  const insertStmt = db.prepare(`
    INSERT INTO metrics_snapshots (period, metric_key, metric_value)
    VALUES ('hourly', ?, ?)
  `);
  const insertMany = db.transaction((mts) => {
    for (const [key, val] of Object.entries(mts)) {
      insertStmt.run(key, val);
    }
  });
  insertMany(metrics);

  // 清理 30 天前的快照
  db.prepare(`
    DELETE FROM metrics_snapshots
    WHERE snapshot_at < datetime('now', '-30 days')
  `).run();

  // 检查告警
  const alerts = checkAlerts(metrics);
  if (alerts.length > 0) {
    console.log('[Monitor] 告警:', alerts.map(a => a.message).join(' | '));
  }

  return { metrics, alerts };
}

/**
 * 检查告警阈值，返回告警列表
 */
function checkAlerts(metrics) {
  const alerts = [];

  if (metrics.reflection_error_rate > THRESHOLDS.reflection_error_rate.warn) {
    alerts.push({
      level: 'warn',
      key: 'reflection_error_rate',
      value: metrics.reflection_error_rate,
      threshold: THRESHOLDS.reflection_error_rate.warn,
      message: `${THRESHOLDS.reflection_error_rate.label}：当前 ${(metrics.reflection_error_rate * 100).toFixed(1)}% > 阈值 ${THRESHOLDS.reflection_error_rate.warn * 100}%`,
    });
  }

  if (metrics.msg_count_1h > THRESHOLDS.msg_count_1h.warn) {
    alerts.push({
      level: 'info',
      key: 'msg_count_1h',
      value: metrics.msg_count_1h,
      threshold: THRESHOLDS.msg_count_1h.warn,
      message: `${THRESHOLDS.msg_count_1h.label}：过去1小时消息 ${metrics.msg_count_1h} 条 > 阈值 ${THRESHOLDS.msg_count_1h.warn}`,
    });
  }

  return alerts;
}

/**
 * 读取近期指标趋势
 * @param {string} metricKey
 * @param {number} hours
 */
function getMetricsTrend(metricKey, hours = 24) {
  const rows = db.prepare(`
    SELECT metric_value, snapshot_at
    FROM metrics_snapshots
    WHERE period = 'hourly'
      AND metric_key = ?
      AND snapshot_at >= datetime('now', ? || ' hours')
    ORDER BY snapshot_at ASC
  `).all(metricKey, `-${hours}`);
  return rows;
}

/**
 * 获取所有指标的最新快照（每个 key 取最新一条）
 */
function getLatestMetrics() {
  const keys = ['active_users_1h', 'msg_count_1h', 'avg_msg_length', 'reflection_error_rate', 'knowledge_hit_rate'];
  const result = {};
  for (const key of keys) {
    const row = db.prepare(`
      SELECT metric_value, snapshot_at FROM metrics_snapshots
      WHERE period = 'hourly' AND metric_key = ?
      ORDER BY snapshot_at DESC LIMIT 1
    `).get(key);
    result[key] = row || { metric_value: null, snapshot_at: null };
  }
  return result;
}

module.exports = { collectMetrics, checkAlerts, getMetricsTrend, getLatestMetrics };
