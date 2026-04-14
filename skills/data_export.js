// Skill: 数据导出 — 生成真实可下载文件（CSV）
const db = require('../db/schema');
const fs = require('fs');
const path = require('path');

const EXPORT_DIR = path.join(__dirname, '..', 'public', 'exports');
if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });

function toCSV(headers, rows) {
  const escape = v => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers.map(escape).join(','), ...rows.map(r => headers.map((_, i) => escape(r[i])).join(','))].join('\n');
}

module.exports = {
  name: 'data_export',
  description: '导出运营数据为可下载的CSV文件。支持类型: overview(运营总览)/products(商品列表)/knowledge(知识库)/marketing(营销任务)/conversations(对话记录)/all(全部)。返回下载链接。',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: '导出类型: overview/products/knowledge/marketing/conversations/all',
        default: 'all'
      }
    }
  },
  execute: async ({ type = 'all' }) => {
    const timestamp = new Date().toISOString().slice(0, 16).replace(/[:-]/g, '');
    const files = [];

    if (type === 'all' || type === 'overview') {
      const convs = db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n;
      const msgs = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE role='user'").get().n;
      const likes = db.prepare("SELECT COUNT(*) AS n FROM message_feedback WHERE rating=1").get().n;
      const dislikes = db.prepare("SELECT COUNT(*) AS n FROM message_feedback WHERE rating=-1").get().n;
      const docs = db.prepare('SELECT COUNT(*) AS n FROM knowledge_docs').get().n;
      const vectors = db.prepare('SELECT COUNT(*) AS n FROM knowledge_vectors').get().n;
      let qa = 0; try { qa = db.prepare('SELECT COUNT(*) AS n FROM knowledge_qa').get().n; } catch {}
      const products = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
      const activeProducts = db.prepare("SELECT COUNT(*) AS n FROM products WHERE status='active'").get().n;

      const csv = toCSV(['指标', '数值'], [
        ['总对话数', convs], ['用户消息数', msgs], ['好评数', likes], ['差评数', dislikes],
        ['好评率', (likes+dislikes) > 0 ? Math.round(likes/(likes+dislikes)*100)+'%' : '暂无'],
        ['知识文档数', docs], ['向量索引数', vectors], ['QA对数', qa],
        ['商品总数', products], ['在售商品', activeProducts]
      ]);
      const fname = `overview_${timestamp}.csv`;
      fs.writeFileSync(path.join(EXPORT_DIR, fname), '\uFEFF' + csv); // BOM for Excel
      files.push({ name: '运营总览', file: fname, url: `/exports/${fname}` });
    }

    if (type === 'all' || type === 'products') {
      const rows = db.prepare('SELECT name, sku, category, price, original_price, stock, status, created_at FROM products ORDER BY sort_order').all();
      const csv = toCSV(['商品名', 'SKU', '分类', '价格', '原价', '库存', '状态', '创建时间'],
        rows.map(r => [r.name, r.sku, r.category, r.price, r.original_price, r.stock, r.status === 'active' ? '在售' : '下架', r.created_at])
      );
      const fname = `products_${timestamp}.csv`;
      fs.writeFileSync(path.join(EXPORT_DIR, fname), '\uFEFF' + csv);
      files.push({ name: '商品列表', file: fname, url: `/exports/${fname}`, count: rows.length });
    }

    if (type === 'all' || type === 'knowledge') {
      const rows = db.prepare('SELECT title, source_type, chunk_count, created_at FROM knowledge_docs ORDER BY created_at DESC LIMIT 500').all();
      const csv = toCSV(['标题', '来源类型', '分块数', '创建时间'],
        rows.map(r => [r.title, r.source_type, r.chunk_count, r.created_at])
      );
      const fname = `knowledge_${timestamp}.csv`;
      fs.writeFileSync(path.join(EXPORT_DIR, fname), '\uFEFF' + csv);
      files.push({ name: '知识库文档', file: fname, url: `/exports/${fname}`, count: rows.length });
    }

    if (type === 'all' || type === 'marketing') {
      const rows = db.prepare('SELECT name, type, target_audience, status, scheduled_at, reach_count, click_count, convert_count, created_at FROM marketing_tasks ORDER BY created_at DESC').all();
      const csv = toCSV(['任务名', '类型', '目标受众', '状态', '计划时间', '触达', '点击', '转化', '创建时间'],
        rows.map(r => [r.name, r.type, r.target_audience, r.status, r.scheduled_at, r.reach_count, r.click_count, r.convert_count, r.created_at])
      );
      const fname = `marketing_${timestamp}.csv`;
      fs.writeFileSync(path.join(EXPORT_DIR, fname), '\uFEFF' + csv);
      files.push({ name: '营销任务', file: fname, url: `/exports/${fname}`, count: rows.length });
    }

    if (type === 'all' || type === 'conversations') {
      const rows = db.prepare(`
        SELECT c.id, c.session_id, c.created_at, c.updated_at,
          (SELECT content FROM messages WHERE conv_id = c.id AND role = 'user' ORDER BY created_at ASC LIMIT 1) AS first_msg,
          (SELECT COUNT(*) FROM messages WHERE conv_id = c.id) AS msg_count
        FROM conversations c ORDER BY c.updated_at DESC LIMIT 1000
      `).all();
      const csv = toCSV(['对话ID', '用户标识', '首条消息', '消息数', '创建时间', '更新时间'],
        rows.map(r => [r.id, r.session_id, (r.first_msg || '').slice(0, 100), r.msg_count, r.created_at, r.updated_at])
      );
      const fname = `conversations_${timestamp}.csv`;
      fs.writeFileSync(path.join(EXPORT_DIR, fname), '\uFEFF' + csv);
      files.push({ name: '对话记录', file: fname, url: `/exports/${fname}`, count: rows.length });
    }

    // 返回结构化结果，让 AI 生成带下载链接的回复
    return {
      success: true,
      message: `已导出 ${files.length} 个文件`,
      files: files,
      hint: '请在回复中为每个文件提供可点击的下载链接，格式: [文件名](URL)'
    };
  }
};
