/**
 * 向量索引管理
 * - 启动时优先从磁盘加载持久化索引，加载更快
 * - 无磁盘缓存时从 SQLite 重建并持久化
 * - 提供 vectorSearch(queryVec, topK) 接口
 * - 新增向量时动态插入索引并标记待持久化
 */
const { HierarchicalNSW } = require('hnswlib-node');
const path = require('path');
const fs = require('fs');
const db = require('../db/schema');
const { DIMENSION } = require('./embed');

const INDEX_PATH = path.join(__dirname, '../lexiang.hnsw');
const IDMAP_PATH = path.join(__dirname, '../lexiang.hnsw.ids');

let index = null;
let idMap = [];            // HNSW内部ID → chunk_id 映射
let built = false;
let building = false;
let dirtyCount = 0;        // 新增后尚未持久化的条数
const DIRTY_FLUSH = 200;   // 每积累200条新增才持久化一次

async function buildIndex() {
  if (building) return;
  building = true;
  try {
    // 优先尝试从磁盘加载
    if (fs.existsSync(INDEX_PATH) && fs.existsSync(IDMAP_PATH)) {
      try {
        const savedMap = JSON.parse(fs.readFileSync(IDMAP_PATH, 'utf8'));
        const dbCount = db.prepare('SELECT COUNT(*) as n FROM knowledge_vectors').get().n;

        if (savedMap.length === dbCount) {
          // 磁盘索引与DB一致，直接加载
          const maxElements = Math.max(savedMap.length + 10000, 50000);
          index = new HierarchicalNSW('cosine', DIMENSION);
          index.initIndex(maxElements, 16, 200, 100);
          index.readIndex(INDEX_PATH, true);
          idMap = savedMap;
          built = true;
          console.log(`[VectorIndex] 磁盘索引加载完成，共 ${idMap.length} 条向量`);
          building = false;
          return;
        }
      } catch (e) {
        console.warn('[VectorIndex] 磁盘索引加载失败，重建:', e.message);
      }
    }

    // 从 SQLite 重建
    const rows = db.prepare('SELECT chunk_id, vector FROM knowledge_vectors').all();
    if (rows.length === 0) {
      built = true;
      building = false;
      return;
    }

    const maxElements = Math.max(rows.length + 10000, 50000);
    index = new HierarchicalNSW('cosine', DIMENSION);
    index.initIndex(maxElements, 16, 200, 100);

    idMap = [];
    for (let i = 0; i < rows.length; i++) {
      const vec = Array.from(new Float32Array(rows[i].vector.buffer));
      index.addPoint(vec, i);
      idMap[i] = rows[i].chunk_id;
    }

    built = true;
    console.log(`[VectorIndex] SQLite重建完成，共 ${rows.length} 条向量`);

    // 持久化到磁盘
    _flushToDisk();
  } catch (e) {
    console.error('[VectorIndex] buildIndex error:', e.message);
  } finally {
    building = false;
  }
}

function _flushToDisk() {
  try {
    if (!index) return;
    index.writeIndex(INDEX_PATH);
    fs.writeFileSync(IDMAP_PATH, JSON.stringify(idMap), 'utf8');
    dirtyCount = 0;
  } catch (e) {
    console.warn('[VectorIndex] 持久化失败:', e.message);
  }
}

function addVector(chunkId, vec) {
  if (!index) return;
  const internalId = idMap.length;
  idMap[internalId] = chunkId;
  index.addPoint(vec, internalId);
  dirtyCount++;
  if (dirtyCount >= DIRTY_FLUSH) _flushToDisk();
}

function vectorSearch(queryVec, topK = 5) {
  if (!index || idMap.length === 0) return [];
  const k = Math.min(topK, idMap.length);
  const result = index.searchKnn(queryVec, k);
  return result.neighbors.map((internalId, i) => ({
    chunk_id: idMap[internalId],
    score: 1 - result.distances[i]
  })).filter(r => r.score > 0.3);
}

function isReady() { return built; }
function size() { return idMap.length; }

// 进程退出前持久化
process.on('exit', () => { if (dirtyCount > 0) _flushToDisk(); });
process.on('SIGTERM', () => { if (dirtyCount > 0) _flushToDisk(); process.exit(0); });

module.exports = { buildIndex, addVector, vectorSearch, isReady, size };
