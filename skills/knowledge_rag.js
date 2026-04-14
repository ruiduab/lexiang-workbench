const { searchAsync } = require('../knowledge/search');

// 注意：agent.js 每次请求已强制做一次 RAG 注入（5条）。
// 这个工具只在 AI 需要针对某个子问题做更深/更精准的二次检索时调用。
module.exports = {
  name: 'knowledge_search',
  description: '对联想官方知识库做精准二次检索。当用户问题包含多个子话题、或首次回答不够详细时，可用此工具针对具体问题再次检索。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '精确的搜索问题，用中文描述需要查找的内容'
      },
      top_k: {
        type: 'number',
        description: '返回结果数量，默认5，最多10'
      }
    },
    required: ['query']
  },
  execute: async ({ query, top_k = 5 }) => {
    const results = await searchAsync(query, Math.min(top_k || 5, 10));
    if (results.length === 0) {
      return { found: false, message: '知识库中未找到相关内容' };
    }
    return {
      found: true,
      results: results.map(r => ({
        title: r.title,
        content: r.content.slice(0, 500),
        source_url: r.source_url || null,
        score: Math.round(r.score * 100) / 100
      }))
    };
  }
};
