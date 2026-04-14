const db = require('../db/schema');

/**
 * 在 knowledge_qa_fts 中搜索相关 QA 对
 * @param {string} userMessage
 * @param {number} limit
 * @returns {Array<{question, answer, score}>}
 */
function searchQA(userMessage, limit = 3) {
  if (!userMessage || userMessage.trim().length === 0) return [];
  try {
    const rows = db.prepare(`
      SELECT kqf.qa_id, kqf.question, kqf.answer, bm25(knowledge_qa_fts) AS score
      FROM knowledge_qa_fts kqf
      WHERE knowledge_qa_fts MATCH ?
      ORDER BY score
      LIMIT ?
    `).all(userMessage.trim(), limit);
    return rows.map(r => ({ qa_id: r.qa_id, question: r.question, answer: r.answer, score: r.score }));
  } catch (e) {
    // FTS 语法错误降级 LIKE
    try {
      const like = `%${userMessage}%`;
      const rows = db.prepare(`
        SELECT kq.id AS qa_id, kq.question, kq.answer, 0 AS score
        FROM knowledge_qa kq
        WHERE kq.question LIKE ? OR kq.answer LIKE ?
        LIMIT ?
      `).all(like, like, limit);
      return rows;
    } catch (e2) {
      return [];
    }
  }
}

/**
 * 插入一条 QA 对，同时更新 FTS 索引
 * @param {object} qa - { question, answer, source?, doc_id? }
 * @returns {number} 新插入的 id
 */
function insertQA(qa) {
  const { question, answer, source = null, doc_id = null } = qa;
  // doc_id NOT NULL 兼容：若为 null 用 0（旧表约束）
  const result = db.prepare(
    'INSERT INTO knowledge_qa (question, answer, source, doc_id) VALUES (?, ?, ?, ?)'
  ).run(question, answer, source, doc_id !== null ? doc_id : 0);
  const id = result.lastInsertRowid;
  db.prepare(
    'INSERT INTO knowledge_qa_fts (qa_id, question, answer) VALUES (?, ?, ?)'
  ).run(id, question, answer);
  return id;
}

/**
 * 删除一条 QA 对，同时删除 FTS 索引
 * @param {number} id
 */
function deleteQA(id) {
  db.prepare('DELETE FROM knowledge_qa_fts WHERE qa_id = ?').run(id);
  db.prepare('DELETE FROM knowledge_qa WHERE id = ?').run(id);
}

module.exports = { searchQA, insertQA, deleteQA };
