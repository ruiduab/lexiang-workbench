const db = require('../db/schema');
const path = require('path');
const fs = require('fs');

// Split text into overlapping chunks
function chunkText(text, size = 500, overlap = 100) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end).trim());
    start += size - overlap;
    if (start >= text.length) break;
  }
  return chunks.filter(c => c.length > 20);
}

async function extractText(filePath, mimeType, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();

  if (ext === '.txt' || ext === '.md') {
    return fs.readFileSync(filePath, 'utf8');
  }

  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const buf = fs.readFileSync(filePath);
    const data = await pdfParse(buf);
    return data.text;
  }

  if (ext === '.docx' || ext === '.doc') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(filePath);
    let text = '';
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      text += `\n[Sheet: ${sheetName}]\n`;
      text += XLSX.utils.sheet_to_csv(ws);
    }
    return text;
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

async function extractFromUrl(url) {
  const fetch = require('node-fetch');
  const cheerio = require('cheerio');
  const res = await fetch(url, { timeout: 15000, headers: { 'User-Agent': 'LeAIBot/1.0' } });
  const html = await res.text();
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, aside').remove();
  const title = $('title').text().trim() || url;
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  return { title, text };
}

async function ingestFile(filePath, originalName, title) {
  const text = await extractText(filePath, null, originalName);
  return await ingestText(text, title || originalName, { filename: originalName, source_type: path.extname(originalName).slice(1).toLowerCase() || 'txt' });
}

async function ingestUrl(url, customTitle) {
  const { title, text } = await extractFromUrl(url);
  return await ingestText(text, customTitle || title, { source_type: 'url', source_url: url });
}

async function ingestText(text, title, meta = {}) {
  const { source_type = 'manual', source_url = null, filename = null } = meta;

  const preview = text.slice(0, 5000);

  // 增量更新：URL已存在时对比内容，有变化才更新
  if (source_url) {
    const exists = db.prepare('SELECT id, content FROM knowledge_docs WHERE source_url = ?').get(source_url);
    if (exists) {
      // 内容无变化 → 跳过
      if (exists.content === preview) {
        return { docId: exists.id, title, chunks: 0, skipped: true };
      }
      // 内容有变化 → 删除旧chunks/fts/vectors，重新入库
      const docId = exists.id;
      db.prepare('DELETE FROM knowledge_fts WHERE doc_id = ?').run(docId);
      db.prepare('DELETE FROM knowledge_vectors WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE doc_id = ?)').run(docId);
      db.prepare('DELETE FROM knowledge_chunks WHERE doc_id = ?').run(docId);
      db.prepare('UPDATE knowledge_docs SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(title, preview, docId);

      const chunks = chunkText(text);
      const insertChunk = db.prepare('INSERT INTO knowledge_chunks (doc_id, chunk_index, content) VALUES (?, ?, ?)');
      const insertFts = db.prepare('INSERT INTO knowledge_fts (chunk_id, doc_id, title, content) VALUES (?, ?, ?, ?)');
      db.transaction(() => {
        for (let i = 0; i < chunks.length; i++) {
          const chunkResult = insertChunk.run(docId, i, chunks[i]);
          insertFts.run(chunkResult.lastInsertRowid, docId, title, chunks[i]);
        }
      })();
      db.prepare('UPDATE knowledge_docs SET chunk_count = ? WHERE id = ?').run(chunks.length, docId);

      return { docId, title, chunks: chunks.length, updated: true };
    }
  }

  // 新文档：正常插入
  const docResult = db.prepare(`
    INSERT INTO knowledge_docs (title, filename, source_type, source_url, content)
    VALUES (?, ?, ?, ?, ?)
  `).run(title, filename, source_type, source_url, preview);

  const docId = docResult.lastInsertRowid;

  const chunks = chunkText(text);
  const insertChunk = db.prepare('INSERT INTO knowledge_chunks (doc_id, chunk_index, content) VALUES (?, ?, ?)');
  const insertFts = db.prepare('INSERT INTO knowledge_fts (chunk_id, doc_id, title, content) VALUES (?, ?, ?, ?)');

  const insertAll = db.transaction(() => {
    for (let i = 0; i < chunks.length; i++) {
      const chunkResult = insertChunk.run(docId, i, chunks[i]);
      insertFts.run(chunkResult.lastInsertRowid, docId, title, chunks[i]);
    }
  });
  insertAll();

  db.prepare('UPDATE knowledge_docs SET chunk_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(chunks.length, docId);

  return { docId, title, chunks: chunks.length };
}

async function deleteDoc(docId) {
  // Delete FTS entries for this doc
  db.prepare('DELETE FROM knowledge_fts WHERE doc_id = ?').run(docId);
  db.prepare('DELETE FROM knowledge_docs WHERE id = ?').run(docId);
}

module.exports = { ingestFile, ingestUrl, ingestText, deleteDoc };
