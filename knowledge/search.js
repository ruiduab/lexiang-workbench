const db = require('../db/schema');
const { graphSearch } = require('./graph_rag');
const { rerank } = require('./reranker');
const { searchQA } = require('./qa_search');
const { deduplicateAndClean } = require('./deduplicator');

// 向量索引（懒加载，第一次用到时才初始化）
let vectorModule = null;
let embedModule = null;
let vectorReady = false;

function initVector() {
  if (vectorModule) return;
  try {
    vectorModule = require('./vector_index');
    embedModule = require('./embed');
    // 异步构建索引，不阻塞启动
    vectorModule.buildIndex().then(() => {
      vectorReady = true;
      console.log('[Search] 向量索引已就绪，共', vectorModule.size(), '条');
    }).catch(e => {
      console.warn('[Search] 向量索引构建失败，降级为纯FTS:', e.message);
    });
  } catch (e) {
    console.warn('[Search] 向量模块加载失败，使用纯FTS:', e.message);
  }
}

// 启动时初始化
initVector();

/**
 * 混合检索：向量语义搜索 + FTS关键词搜索，结果合并去重
 * @param {string} query
 * @param {string} [userMessage]  原始用户消息（用于重排），不传则用 query
 * @param {number} topK
 * @returns {Array<{chunk_id, doc_id, title, content, score}>}
 */
async function searchAsync(query, userMessage, topK = 5) {
  // 兼容旧调用：searchAsync(query, topK)
  if (typeof userMessage === 'number') {
    topK = userMessage;
    userMessage = query;
  }
  if (!userMessage) userMessage = query;
  if (!query || query.trim().length === 0) return [];

  const results = new Map(); // chunk_id → result

  // 1. 向量语义搜索
  if (vectorReady && vectorModule && embedModule) {
    try {
      const queryVec = await embedModule.embedOne(query.slice(0, 512));
      const vecHits = vectorModule.vectorSearch(queryVec, topK * 2);

      if (vecHits.length > 0) {
        const chunkIds = vecHits.map(h => h.chunk_id);
        const placeholders = chunkIds.map(() => '?').join(',');
        const rows = db.prepare(`
          SELECT kc.id AS chunk_id, kc.doc_id, kd.title, kc.content, kd.source_url
          FROM knowledge_chunks kc
          JOIN knowledge_docs kd ON kd.id = kc.doc_id
          WHERE kc.id IN (${placeholders})
        `).all(...chunkIds);

        // 合并向量分数
        const scoreMap = new Map(vecHits.map(h => [h.chunk_id, h.score]));
        for (const row of rows) {
          results.set(row.chunk_id, { ...row, score: scoreMap.get(row.chunk_id) || 0, source: 'vector' });
        }
      }
    } catch (e) {
      // 向量搜索失败不影响FTS
    }
  }

  // 2. FTS关键词搜索
  try {
    const ftsRows = db.prepare(`
      SELECT kf.chunk_id, kf.doc_id, kf.title, kf.content, bm25(knowledge_fts) AS score, (SELECT source_url FROM knowledge_docs WHERE id = kf.doc_id) AS source_url
      FROM knowledge_fts kf
      WHERE knowledge_fts MATCH ?
      ORDER BY score
      LIMIT ?
    `).all(query, topK);

    for (const row of ftsRows) {
      if (!results.has(row.chunk_id)) {
        results.set(row.chunk_id, { ...row, source: 'fts' });
      } else {
        // 两种方式都找到了，加权提升分数
        results.get(row.chunk_id).score += 0.2;
        results.get(row.chunk_id).source = 'hybrid';
      }
    }
  } catch (e) {
    // FTS 语法错误降级 LIKE
    if (results.size === 0) {
      const like = `%${query}%`;
      const rows = db.prepare(`
        SELECT kc.id AS chunk_id, kc.doc_id, kd.title, kc.content, kd.source_url, 0 AS score
        FROM knowledge_chunks kc
        JOIN knowledge_docs kd ON kd.id = kc.doc_id
        WHERE kc.content LIKE ? LIMIT ?
      `).all(like, topK);
      for (const row of rows) results.set(row.chunk_id, { ...row, source: 'like' });
    }
  }

  // 按分数排序，取 topK
  const hits = [...results.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  // L3.1 Graph-RAG 图增强（失败不影响正常检索）
  let graphHits = hits;
  try {
    graphHits = await graphSearch(query, hits);
  } catch (e) {
    graphHits = hits;
  }

  // L3.2 检索重排（仅在 hits > 3 时调用，降低 LLM 调用频率）
  if (graphHits.length > 3) {
    try {
      const reranked = await rerank(userMessage, graphHits, 3);
      // L1.4 信息密度优化：去重 + 清洗 + 截断
      return deduplicateAndClean(reranked);
    } catch (e) {
      return deduplicateAndClean(graphHits.slice(0, 3));
    }
  }

  // L4.2 QA 双轨：搜索 QA 对，融合到结果前面（更精准，优先级更高）
  let qaHits = [];
  try {
    qaHits = searchQA(userMessage, 3);
  } catch (e) {
    // QA 搜索失败不影响正常检索
  }

  // 将 QA 结果转换为统一格式拼入，放在知识库结果前面
  const qaFormatted = qaHits.map(qa => ({
    chunk_id: `qa_${qa.qa_id}`,
    doc_id: null,
    title: '[QA对]',
    content: `[QA对] Q: ${qa.question}\nA: ${qa.answer}`,
    score: qa.score,
    source: 'qa',
    source_url: null
  }));

  // 产品库搜索：从 products 表搜索相关产品，融入 RAG 上下文
  let productHits = [];
  try {
    const keywords = userMessage.replace(/[推荐一个一款最新的]/g, '').trim().split(/\s+/).filter(w => w.length > 1);
    const likeConditions = keywords.length > 0
      ? keywords.map(() => '(name LIKE ? OR category LIKE ? OR description LIKE ?)').join(' OR ')
      : 'name LIKE ?';
    const likeParams = keywords.length > 0
      ? keywords.flatMap(k => [`%${k}%`, `%${k}%`, `%${k}%`])
      : [`%${userMessage.slice(0, 20)}%`];
    const productRows = db.prepare(`
      SELECT name, category, price, description, specs FROM products
      WHERE price > 0 AND (${likeConditions})
      ORDER BY price DESC LIMIT 5
    `).all(...likeParams);
    productHits = productRows.map((p, i) => {
      let specsText = '';
      try { const s = JSON.parse(p.specs || '{}'); specsText = Object.entries(s).map(([k,v]) => `${k}:${v}`).join('，'); } catch {}
      return {
        chunk_id: `product_${i}`,
        doc_id: null,
        title: `[联想产品] ${p.name}`,
        content: `[联想在售产品] ${p.name}\n类别：${p.category}\n价格：¥${p.price}\n${p.description || ''}${specsText ? '\n参数：' + specsText : ''}`,
        score: 1.0,
        source: 'product',
        source_url: null
      };
    });
  } catch (e) {
    // 产品搜索失败不影响正常检索
  }

  // L1.4 信息密度优化：去重 + 清洗 + 截断
  return deduplicateAndClean([...productHits, ...qaFormatted, ...graphHits]);
}

/**
 * 同步版（兼容旧代码，纯FTS）
 */
function search(query, topK = 5) {
  if (!query || query.trim().length === 0) return [];
  try {
    return db.prepare(`
      SELECT kf.chunk_id, kf.doc_id, kf.title, kf.content, bm25(knowledge_fts) AS score, (SELECT source_url FROM knowledge_docs WHERE id = kf.doc_id) AS source_url
      FROM knowledge_fts kf
      WHERE knowledge_fts MATCH ?
      ORDER BY score LIMIT ?
    `).all(query, topK);
  } catch (e) {
    const like = `%${query}%`;
    return db.prepare(`
      SELECT kc.id AS chunk_id, kc.doc_id, kd.title, kc.content, kd.source_url, 0 AS score
      FROM knowledge_chunks kc JOIN knowledge_docs kd ON kd.id = kc.doc_id
      WHERE kc.content LIKE ? LIMIT ?
    `).all(like, topK);
  }
}

module.exports = { search, searchAsync };
