/**
 * L3.1 Graph-RAG — 实体关系图增强检索
 *
 * graphSearch(userMessage, baseHits)  — 纯DB查询，不调LLM，< 20ms
 * buildKnowledgeGraph(limit)          — 后台异步建图，用LLM提取实体+关系
 */

'use strict';

const https = require('https');
const db = require('../db/schema');

const API_KEY = process.env.DASHSCOPE_API_KEY;
const MODEL = 'qwen-plus';

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────

/**
 * 调用 DashScope Chat API，返回文本
 */
function callLLM(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
      temperature: 0.1
    });
    const req = https.request({
      hostname: 'dashscope.aliyuncs.com',
      path: '/compatible-mode/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve(j.choices?.[0]?.message?.content?.trim() || '');
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('LLM timeout')); });
    req.write(body);
    req.end();
  });
}

// ──────────────────────────────────────────────
// graphSearch：纯DB查询，快速（< 20ms）
// ──────────────────────────────────────────────

/**
 * 从用户问题提取候选实体名（简单关键词匹配，不调LLM）
 * 方法：把问题分词后与 kg_entities.name 做前缀/包含匹配
 */
function extractCandidateEntities(userMessage) {
  // 先取所有实体名（数量通常不大，< 5000 行可以全量）
  let rows;
  try {
    rows = db.prepare('SELECT id, name, aliases, doc_ids FROM kg_entities LIMIT 5000').all();
  } catch (e) {
    return [];
  }
  if (!rows || rows.length === 0) return [];

  const msg = userMessage.toLowerCase();
  const matched = [];

  for (const row of rows) {
    const names = [row.name];
    if (row.aliases) {
      try { names.push(...JSON.parse(row.aliases)); } catch {}
    }
    for (const n of names) {
      if (n && msg.includes(n.toLowerCase())) {
        matched.push(row);
        break;
      }
    }
  }
  return matched;
}

/**
 * 图增强检索：基于命中实体沿关系边扩展一跳，补充相关文档的 chunks
 * @param {string} userMessage
 * @param {Array} baseHits  — 已有的 FTS/向量检索结果
 * @param {number} extraK   — 最多补充几条图增强结果
 * @returns {Array} merged hits（去重，base hits 优先）
 */
async function graphSearch(userMessage, baseHits, extraK = 3) {
  if (!userMessage) return baseHits;

  try {
    // 检查 kg_entities 表是否有数据
    const count = db.prepare('SELECT COUNT(*) AS n FROM kg_entities').get();
    if (!count || count.n === 0) return baseHits;

    // 提取候选实体
    const entities = extractCandidateEntities(userMessage);
    if (entities.length === 0) return baseHits;

    // 沿关系边扩展一跳，收集相关实体的 doc_ids
    const entityIds = entities.map(e => e.id);
    const extraDocIds = new Set();

    // 先把命中实体自身的 doc_ids 加入
    for (const e of entities) {
      if (e.doc_ids) {
        try { JSON.parse(e.doc_ids).forEach(id => extraDocIds.add(id)); } catch {}
      }
    }

    // 一跳邻居
    if (entityIds.length > 0) {
      const placeholders = entityIds.map(() => '?').join(',');
      const neighbors = db.prepare(`
        SELECT DISTINCT
          CASE WHEN from_id IN (${placeholders}) THEN to_id ELSE from_id END AS neighbor_id
        FROM kg_relations
        WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})
      `).all(...entityIds, ...entityIds, ...entityIds);

      if (neighbors.length > 0) {
        const neighborIds = neighbors.map(n => n.neighbor_id);
        const nPlaceholders = neighborIds.map(() => '?').join(',');
        const neighborEntities = db.prepare(
          `SELECT doc_ids FROM kg_entities WHERE id IN (${nPlaceholders})`
        ).all(...neighborIds);

        for (const ne of neighborEntities) {
          if (ne.doc_ids) {
            try { JSON.parse(ne.doc_ids).forEach(id => extraDocIds.add(id)); } catch {}
          }
        }
      }
    }

    if (extraDocIds.size === 0) return baseHits;

    // 已在 baseHits 中的 doc_ids（去重用）
    const baseDocIds = new Set(baseHits.map(h => h.doc_id));
    const newDocIds = [...extraDocIds].filter(id => !baseDocIds.has(id)).slice(0, extraK * 2);

    if (newDocIds.length === 0) return baseHits;

    // 从 knowledge_chunks 补充这些文档的第一个 chunk（代表性内容）
    const ph2 = newDocIds.map(() => '?').join(',');
    const extraChunks = db.prepare(`
      SELECT kc.id AS chunk_id, kc.doc_id, kd.title, kc.content, kd.source_url,
             0.3 AS score
      FROM knowledge_chunks kc
      JOIN knowledge_docs kd ON kd.id = kc.doc_id
      WHERE kc.doc_id IN (${ph2})
      GROUP BY kc.doc_id
      ORDER BY kc.doc_id
      LIMIT ?
    `).all(...newDocIds, extraK);

    const extra = extraChunks.map(c => ({ ...c, source: 'graph' }));
    return [...baseHits, ...extra];
  } catch (e) {
    // 图增强失败不影响正常检索
    console.warn('[GraphRAG] graphSearch 失败:', e.message);
    return baseHits;
  }
}

// ──────────────────────────────────────────────
// buildKnowledgeGraph：后台异步建图
// ──────────────────────────────────────────────

let _building = false;

/**
 * 从 knowledge_docs 提取实体和关系，写入 kg_entities/kg_relations
 * @param {number} limit — 每次处理多少条文档
 */
async function buildKnowledgeGraph(limit = 100) {
  if (_building) {
    return { ok: false, message: '已在建图中，请稍后' };
  }
  _building = true;

  // 异步后台执行，立即返回
  setImmediate(async () => {
    try {
      console.log('[GraphRAG] 开始建图...');
      // 取最新的 limit 条文档（已处理的幂等跳过）
      const docs = db.prepare(`
        SELECT id, title, content FROM knowledge_docs
        ORDER BY id DESC LIMIT ?
      `).all(limit);

      if (docs.length === 0) {
        console.log('[GraphRAG] 知识库为空，无需建图');
        _building = false;
        return;
      }

      // 批量处理，每批 3 条
      const BATCH = 3;
      let entityCount = 0;
      let relationCount = 0;

      for (let i = 0; i < docs.length; i += BATCH) {
        const batch = docs.slice(i, i + BATCH);
        try {
          const { entities, relations } = await extractEntitiesFromDocs(batch);
          const idMap = {};

          // 写入实体（幂等：UNIQUE INDEX on name，ON CONFLICT IGNORE）
          for (const ent of entities) {
            try {
              const existing = db.prepare('SELECT id FROM kg_entities WHERE name = ?').get(ent.name);
              if (existing) {
                // 合并 doc_ids
                const old = db.prepare('SELECT doc_ids FROM kg_entities WHERE id = ?').get(existing.id);
                const oldIds = old && old.doc_ids ? JSON.parse(old.doc_ids) : [];
                const newIds = [...new Set([...oldIds, ...ent.doc_ids])];
                db.prepare('UPDATE kg_entities SET doc_ids = ? WHERE id = ?').run(JSON.stringify(newIds), existing.id);
                idMap[ent.name] = existing.id;
              } else {
                const info = db.prepare(
                  'INSERT INTO kg_entities (name, type, aliases, doc_ids) VALUES (?, ?, ?, ?)'
                ).run(ent.name, ent.type, JSON.stringify(ent.aliases || []), JSON.stringify(ent.doc_ids || []));
                idMap[ent.name] = info.lastInsertRowid;
                entityCount++;
              }
            } catch (e) {
              // 单条失败继续
            }
          }

          // 写入关系（幂等：查重后跳过）
          for (const rel of relations) {
            const fromId = idMap[rel.from];
            const toId = idMap[rel.to];
            if (!fromId || !toId) continue;
            try {
              const exists = db.prepare(
                'SELECT id FROM kg_relations WHERE from_id=? AND to_id=? AND relation=?'
              ).get(fromId, toId, rel.relation);
              if (!exists) {
                db.prepare(
                  'INSERT INTO kg_relations (from_id, to_id, relation) VALUES (?, ?, ?)'
                ).run(fromId, toId, rel.relation);
                relationCount++;
              }
            } catch (e) {
              // 单条失败继续
            }
          }

          // 让出事件循环，避免阻塞
          await new Promise(resolve => setImmediate(resolve));
        } catch (e) {
          console.warn('[GraphRAG] 批次处理失败:', e.message);
        }
      }

      console.log(`[GraphRAG] 建图完成，新增实体 ${entityCount} 个，关系 ${relationCount} 条`);
    } catch (e) {
      console.error('[GraphRAG] 建图失败:', e.message);
    } finally {
      _building = false;
    }
  });

  return { ok: true, message: '后台建图中' };
}

/**
 * 用 LLM 从一批文档中提取实体和关系
 * @param {Array<{id, title, content}>} docs
 * @returns {Promise<{entities, relations}>}
 */
async function extractEntitiesFromDocs(docs) {
  const docTexts = docs.map(d => {
    const text = (d.content || '').slice(0, 500);
    return `文档ID=${d.id} 标题:${d.title}\n${text}`;
  }).join('\n\n---\n\n');

  const prompt = `你是知识图谱构建专家。请从以下联想产品知识文档中提取实体和关系。

文档内容：
${docTexts}

请提取：
1. 实体：产品名、品牌名、系列名、功能特性、规格型号等
2. 关系：is_a（属于）、part_of（包含）、compared_with（对比）、successor_of（升级款）、feature_of（特性属于）

输出格式（严格JSON，不要任何解释）：
{
  "entities": [
    {"name": "ThinkPad X1 Carbon", "type": "product", "aliases": ["X1 Carbon", "碳纤维本"], "doc_ids": [文档ID数组]}
  ],
  "relations": [
    {"from": "ThinkPad X1 Carbon", "to": "ThinkPad", "relation": "is_a"}
  ]
}

注意：
- 只提取确实在文档中出现的实体
- doc_ids 只填对应文档的 ID（整数）
- 实体名用最常见的正式名称
- 最多提取 10 个实体，5 条关系`;

  const raw = await callLLM(prompt);

  // 提取 JSON
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { entities: [], relations: [] };

  const parsed = JSON.parse(match[0]);
  return {
    entities: Array.isArray(parsed.entities) ? parsed.entities : [],
    relations: Array.isArray(parsed.relations) ? parsed.relations : []
  };
}

/**
 * 获取图谱统计
 */
function getKGStats() {
  try {
    const entities = db.prepare('SELECT COUNT(*) AS n FROM kg_entities').get().n;
    const relations = db.prepare('SELECT COUNT(*) AS n FROM kg_relations').get().n;
    return { entities, relations, building: _building };
  } catch (e) {
    return { entities: 0, relations: 0, building: _building };
  }
}

module.exports = { graphSearch, buildKnowledgeGraph, getKGStats };
