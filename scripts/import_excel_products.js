/**
 * 从 Excel 导入联想商品知识到 knowledge_docs（全量，含已下架）
 * 用法: node scripts/import_excel_products.js <excel文件路径>
 */

require('dotenv').config();
const XLSX = require('xlsx');
const db = require('../db/schema');

const filePath = process.argv[2];
if (!filePath) {
  console.error('用法: node scripts/import_excel_products.js <excel文件路径>');
  process.exit(1);
}

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

function parseJsonField(val) {
  if (!val) return [];
  try {
    const arr = JSON.parse(val);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function buildProductText(row) {
  const isDeleted = row.is_del === 1;
  const lines = [];

  // 状态标记（供 AI 判断是否推荐）
  lines.push(`状态：${isDeleted ? '已下架' : '在售'}`);
  lines.push(`商品名称：${row.name || ''}`);
  if (row.gbrief) lines.push(`简介：${row.gbrief}`);
  if (row.category_name) lines.push(`品类：${row.category_name}`);
  if (row.sub_category_name) lines.push(`子品类：${row.sub_category_name}`);
  if (row.brand) lines.push(`品牌：${row.brand}`);
  if (row.series) lines.push(`系列：${row.series}`);
  if (row.model) lines.push(`型号：${row.model}`);
  if (row.baseprice) lines.push(`价格：${row.baseprice} 元`);

  const poi = parseJsonField(row.poi);
  if (poi.length) {
    lines.push('\n核心卖点：');
    poi.forEach(p => lines.push(`- ${p}`));
  }

  if (row.summary) {
    lines.push('\n详细介绍：');
    lines.push(row.summary);
  }

  const targetUser = parseJsonField(row.target_user);
  if (targetUser.length) {
    lines.push('\n适合人群：');
    targetUser.forEach(u => lines.push(`- ${u}`));
  }

  // 硬件规格
  const specs = [];
  if (row.cpu) specs.push(`CPU：${row.cpu}`);
  if (row.memory_capacity_description) specs.push(`内存：${row.memory_capacity_description}`);
  if (row.disk_capacity_description) specs.push(`存储：${row.disk_capacity_description}`);
  if (row.gpu_description) specs.push(`显卡：${row.gpu_description}`);
  if (row.screen_size) specs.push(`屏幕尺寸：${row.screen_size}`);
  if (row.screen_resolution) specs.push(`分辨率：${row.screen_resolution}`);
  if (row.screen_refresh_rate) specs.push(`刷新率：${row.screen_refresh_rate}`);
  if (row.os) specs.push(`操作系统：${row.os}`);
  if (row.warranty_policy) specs.push(`保修：${row.warranty_policy}`);
  if (row.weight) specs.push(`重量：${row.weight}`);

  if (specs.length) {
    lines.push('\n规格参数：');
    specs.forEach(s => lines.push(`- ${s}`));
  }

  // 商品链接（无论在售/下架都保留，方便wiki页面跳转）
  if (row.pcdetailurl) {
    lines.push(`\n商品链接：${row.pcdetailurl}`);
  }

  return lines.join('\n');
}

const insertDoc = db.prepare(`
  INSERT INTO knowledge_docs (title, filename, source_type, source_url, content, chunk_count)
  VALUES (?, ?, ?, ?, ?, 0)
`);
const insertChunk = db.prepare('INSERT INTO knowledge_chunks (doc_id, chunk_index, content) VALUES (?, ?, ?)');
const insertFts = db.prepare('INSERT INTO knowledge_fts (chunk_id, doc_id, title, content) VALUES (?, ?, ?, ?)');
const updateCount = db.prepare('UPDATE knowledge_docs SET chunk_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
const checkUrl = db.prepare('SELECT id FROM knowledge_docs WHERE source_url = ?');

console.log('读取 Excel...');
const wb = XLSX.readFile(filePath);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws);

// 全量：有名字或描述的都导入
const valid = rows.filter(r => r.name && (r.summary || r.gbrief));
const active = valid.filter(r => r.is_del !== 1).length;
const deleted = valid.filter(r => r.is_del === 1).length;
console.log(`总有效商品：${valid.length}（在售 ${active}，已下架 ${deleted}）`);

let inserted = 0, skipped = 0, failed = 0;

const batchInsert = db.transaction((batch) => {
  for (const row of batch) {
    const url = row.is_del !== 1 && row.pcdetailurl ? row.pcdetailurl : null;

    if (url && checkUrl.get(url)) {
      skipped++;
      continue;
    }

    const title = row.name || `商品${row.id}`;
    const text = buildProductText(row);

    try {
      const docRes = insertDoc.run(title, null, 'url', url, text.slice(0, 5000));
      const docId = docRes.lastInsertRowid;
      const chunks = chunkText(text);
      for (let i = 0; i < chunks.length; i++) {
        const chunkRes = insertChunk.run(docId, i, chunks[i]);
        insertFts.run(chunkRes.lastInsertRowid, docId, title, chunks[i]);
      }
      updateCount.run(chunks.length, docId);
      inserted++;
    } catch (e) {
      console.error(`  失败 [${row.id}] ${row.name}: ${e.message}`);
      failed++;
    }
  }
});

const BATCH = 500;
for (let i = 0; i < valid.length; i += BATCH) {
  batchInsert(valid.slice(i, i + BATCH));
  console.log(`进度: ${Math.min(i + BATCH, valid.length)} / ${valid.length}  (导入:${inserted} 跳过:${skipped} 失败:${failed})`);
}

console.log(`\n完成！导入:${inserted}  跳过:${skipped}  失败:${failed}`);
