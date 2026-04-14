// 对方案B/A更新过的文档重新切片+清除旧向量，准备重建
const db = require('better-sqlite3')('/root/lexiang/lexiang.db');

const UPDATE_SINCE = '2026-03-18 09:23';

function chunkText(text, size = 500, overlap = 100) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end).trim());
    if (end === text.length) break;
    start += size - overlap;
  }
  return chunks.filter(c => c.length > 20);
}

const docs = db.prepare(
  "SELECT id, title, content FROM knowledge_docs WHERE updated_at >= ?"
).all(UPDATE_SINCE);

console.log('需要重新切片的文档:', docs.length, '篇');

let totalChunks = 0;

const rechunk = db.transaction(() => {
  for (const doc of docs) {
    // 删旧chunks（级联清除向量和FTS）
    const oldChunkIds = db.prepare('SELECT id FROM knowledge_chunks WHERE doc_id = ?').all(doc.id).map(r => r.id);
    if (oldChunkIds.length > 0) {
      db.prepare('DELETE FROM knowledge_vectors WHERE chunk_id IN (' + oldChunkIds.map(() => '?').join(',') + ')').run(...oldChunkIds);
      db.prepare('DELETE FROM knowledge_fts WHERE chunk_id IN (' + oldChunkIds.map(() => '?').join(',') + ')').run(...oldChunkIds);
      db.prepare('DELETE FROM knowledge_chunks WHERE doc_id = ?').run(doc.id);
    }

    // 重新切片
    const chunks = chunkText(doc.content || '');
    const insertChunk = db.prepare('INSERT INTO knowledge_chunks (doc_id, chunk_index, content) VALUES (?, ?, ?)');
    const insertFts = db.prepare('INSERT INTO knowledge_fts (chunk_id, doc_id, title, content) VALUES (?, ?, ?, ?)');

    for (let i = 0; i < chunks.length; i++) {
      const res = insertChunk.run(doc.id, i, chunks[i]);
      insertFts.run(res.lastInsertRowid, doc.id, doc.title, chunks[i]);
    }
    db.prepare('UPDATE knowledge_docs SET chunk_count = ? WHERE id = ?').run(chunks.length, doc.id);
    totalChunks += chunks.length;
  }
});

rechunk();
console.log('重新切片完成，新增 chunks:', totalChunks);

const noVec = db.prepare('SELECT COUNT(*) as c FROM knowledge_chunks c LEFT JOIN knowledge_vectors v ON v.chunk_id = c.id WHERE v.chunk_id IS NULL').get();
console.log('待向量化 chunks:', noVec.c);
