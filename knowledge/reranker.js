/**
 * L3.2 检索重排模块
 * 用 LLM 对检索结果打相关性分数，重新排序后取 top-K
 */
const https = require('https');
const db = require('../db/schema');

const API_KEY = process.env.DASHSCOPE_API_KEY;
const RERANK_MODEL = 'qwen-turbo';
const RERANK_TIMEOUT_MS = 8000;
const CHUNK_PREVIEW_LEN = 150;

/**
 * 读 rerank_enabled 配置（每次直接查 DB，不走 cache）
 */
function isRerankEnabled() {
  try {
    const row = db.prepare('SELECT value FROM bot_config WHERE key = ?').get('rerank_enabled');
    return row ? row.value === '1' : true;
  } catch (e) {
    return true; // 查询失败默认启用
  }
}

/**
 * 调用 DashScope qwen-turbo，返回 ranking 数组（按相关性从高到低的编号）
 * @param {string} prompt
 * @returns {Promise<number[]>}
 */
function callRerankerLLM(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: RERANK_MODEL,
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
          const content = j.choices?.[0]?.message?.content || '';
          // 提取 JSON
          const match = content.match(/\{[\s\S]*\}/);
          if (!match) return reject(new Error('no JSON in response'));
          const parsed = JSON.parse(match[0]);
          if (!Array.isArray(parsed.ranking)) return reject(new Error('no ranking array'));
          resolve(parsed.ranking);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(RERANK_TIMEOUT_MS, () => {
      req.destroy(new Error('reranker timeout'));
    });
    req.write(body);
    req.end();
  });
}

/**
 * 对检索结果重排
 * @param {string} userMessage
 * @param {Array} hits  [{title, content, source_url, score, ...}]
 * @param {number} topK  最终保留条数，默认3
 * @returns {Promise<Array>} 重排后的 top-K hits
 */
async function rerank(userMessage, hits, topK = 3) {
  // hits <= topK 直接返回，无需调 LLM
  if (!hits || hits.length <= topK) return hits || [];

  // 检查开关
  if (!isRerankEnabled()) {
    return hits.slice(0, topK);
  }

  try {
    // 构建 prompt
    const chunksText = hits.map((h, i) => {
      const title = (h.title || '').slice(0, 50);
      const content = (h.content || '').slice(0, CHUNK_PREVIEW_LEN);
      return `[${i}] 标题：${title}\n内容：${content}`;
    }).join('\n\n');

    const prompt = `你是一个检索相关性评估助手。根据用户问题，对以下文档片段按相关性从高到低排序。

用户问题：${userMessage.slice(0, 200)}

文档片段（共${hits.length}条）：
${chunksText}

请输出 JSON 格式，ranking 数组包含所有编号（0开始），按相关性从高到低排列：
{"ranking": [最相关的编号, ..., 最不相关的编号]}

只输出 JSON，不要任何解释。`;

    const ranking = await callRerankerLLM(prompt);

    // 按 ranking 顺序重建 hits，过滤非法索引
    const reranked = [];
    for (const idx of ranking) {
      if (typeof idx === 'number' && idx >= 0 && idx < hits.length) {
        reranked.push(hits[idx]);
        if (reranked.length >= topK) break;
      }
    }

    // 如果 ranking 不够 topK（部分索引无效），补充原始顺序中未出现的
    if (reranked.length < topK) {
      const usedIdx = new Set(ranking.filter(i => typeof i === 'number' && i >= 0 && i < hits.length));
      for (let i = 0; i < hits.length && reranked.length < topK; i++) {
        if (!usedIdx.has(i)) reranked.push(hits[i]);
      }
    }

    return reranked;
  } catch (e) {
    // 失败完全 silent，fallback 原始顺序取 top-K
    return hits.slice(0, topK);
  }
}

module.exports = { rerank };
