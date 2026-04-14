// Skill: 知识库写入 — AI 助手可创建/更新知识条目
const db = require('../db/schema');
const { ingestText } = require('../knowledge/ingest');

module.exports = {
  name: 'knowledge_create',
  description: '向知识库添加新的知识文档或QA问答对。支持两种模式：1)添加文档(doc)：写入长文本知识；2)添加QA对(qa)：写入问答对供检索。',
  parameters: {
    type: 'object',
    properties: {
      mode: { type: 'string', description: '模式：doc(文档) 或 qa(问答对)', default: 'doc' },
      title: { type: 'string', description: '文档标题（doc模式必填）' },
      content: { type: 'string', description: '文档内容（doc模式必填）' },
      question: { type: 'string', description: '问题（qa模式必填）' },
      answer: { type: 'string', description: '回答（qa模式必填）' },
      source: { type: 'string', description: '来源说明，如"用户提供"、"官网文档"等' },
      tags: { type: 'string', description: '标签，逗号分隔，如"ThinkPad,电池,校准"' }
    },
    required: ['mode']
  },
  execute: async ({ mode, title, content, question, answer, source, tags }) => {
    if (mode === 'qa') {
      if (!question || !answer) return { error: '添加QA对需要提供 question 和 answer' };
      // 写入 knowledge_qa 表
      const result = db.prepare(
        'INSERT INTO knowledge_qa (question, answer, source, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
      ).run(question, answer, source || 'AI助手创建');
      // 写入 FTS 索引
      try {
        db.prepare('INSERT INTO knowledge_qa_fts (qa_id, question, answer) VALUES (?, ?, ?)').run(result.lastInsertRowid, question, answer);
      } catch (e) { /* FTS 可能未初始化 */ }
      return {
        success: true,
        id: result.lastInsertRowid,
        message: `QA对已创建 (ID: ${result.lastInsertRowid})`,
        question: question.slice(0, 50),
        answer: answer.slice(0, 80)
      };
    }

    if (mode === 'doc') {
      if (!title || !content) return { error: '添加文档需要提供 title 和 content' };
      // 如果有标签，拼在内容前面便于检索
      let fullContent = content;
      if (tags) fullContent = `[标签: ${tags}]\n\n${content}`;
      const result = await ingestText(fullContent, title, {
        source_type: 'manual',
        source_url: null,
        filename: null
      });
      return {
        success: true,
        docId: result.docId,
        chunks: result.chunks,
        message: `知识文档「${title}」已创建，切分为 ${result.chunks} 个片段`,
        tags: tags || null
      };
    }

    return { error: `不支持的模式: ${mode}，请用 doc 或 qa` };
  }
};
