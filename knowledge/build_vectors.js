/**
 * 批量向量化脚本
 * 对所有还没有向量的 knowledge_chunks 生成 embedding 并存入 knowledge_vectors
 * 可安全中断后重跑（自动跳过已有向量）
 */
const db = require('../db/schema');
const { embedTexts, DIMENSION } = require('./embed');
const { addVector } = require('./vector_index');

const BATCH = 10;    // DashScope 限制每批最多10条
const DELAY = 300;   // 批次间延迟ms（避免限流）

let jobState = { status: 'idle', total: 0, done: 0, failed: 0, logs: [] };

function log(msg) {
  console.log('[BuildVectors]', msg);
  jobState.logs.push(msg);
  if (jobState.logs.length > 200) jobState.logs.shift();
  jobState.updated_at = new Date().toISOString();
}

function getState() { return jobState; }

async function buildVectors({ onProgress } = {}) {
  if (jobState.status === 'running') return jobState;

  jobState = { status: 'running', total: 0, done: 0, failed: 0, logs: [] };

  // 找出所有没有向量的 chunks
  const chunks = db.prepare(`
    SELECT c.id, c.content, d.title
    FROM knowledge_chunks c
    JOIN knowledge_docs d ON d.id = c.doc_id
    LEFT JOIN knowledge_vectors v ON v.chunk_id = c.id
    WHERE v.chunk_id IS NULL
  `).all();

  jobState.total = chunks.length;
  log(`需要向量化的 chunk 数量: ${chunks.length}`);

  if (chunks.length === 0) {
    jobState.status = 'done';
    log('所有 chunk 都已有向量，无需处理');
    return jobState;
  }

  const insertVec = db.prepare('INSERT OR REPLACE INTO knowledge_vectors (chunk_id, vector) VALUES (?, ?)');

  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const texts = batch.map(c => (c.title + ' ' + c.content).slice(0, 2000));

    try {
      const vecs = await embedTexts(texts);

      const insertBatch = db.transaction(() => {
        for (let j = 0; j < batch.length; j++) {
          const vec = vecs[j];
          if (!vec || vec.length !== DIMENSION) continue;
          // 存 Float32Array 的 buffer → BLOB（省空间）
          const blob = Buffer.from(new Float32Array(vec).buffer);
          insertVec.run(batch[j].id, blob);
          addVector(batch[j].id, vec); // 同步更新内存索引
          jobState.done++;
        }
      });
      insertBatch();

      if ((i + BATCH) % 500 === 0 || i + BATCH >= chunks.length) {
        log(`进度: ${Math.min(i + BATCH, chunks.length)}/${chunks.length}，已完成 ${jobState.done}`);
        if (onProgress) onProgress(jobState);
      }
    } catch (e) {
      jobState.failed += batch.length;
      log(`批次失败(${i}-${i + BATCH}): ${e.message}`);
      await new Promise(r => setTimeout(r, 2000)); // 失败后多等一会
    }

    if (i + BATCH < chunks.length) {
      await new Promise(r => setTimeout(r, DELAY));
    }
  }

  jobState.status = 'done';
  log(`完成！成功 ${jobState.done}，失败 ${jobState.failed}`);
  return jobState;
}

module.exports = { buildVectors, getState };
