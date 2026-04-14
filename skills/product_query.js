// Skill: 商品查询 — AI 助手可查询/筛选商品数据
const db = require('../db/schema');

module.exports = {
  name: 'product_query',
  description: '查询商品数据库，支持按名称、分类、状态、价格范围筛选商品。',
  parameters: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: '搜索关键词（商品名称）' },
      category: { type: 'string', description: '分类筛选，如 ThinkPad、小新、拯救者' },
      status: { type: 'string', description: '状态：active/offline/draft' },
      max_price: { type: 'number', description: '最高价格' },
      min_price: { type: 'number', description: '最低价格' },
      limit: { type: 'number', description: '返回数量，默认10' }
    }
  },
  execute: async ({ keyword, category, status, max_price, min_price, limit = 10 }) => {
    let where = '1=1';
    const params = [];
    if (keyword) { where += ' AND name LIKE ?'; params.push(`%${keyword}%`); }
    if (category) { where += ' AND category = ?'; params.push(category); }
    if (status) { where += ' AND status = ?'; params.push(status); }
    if (max_price) { where += ' AND price <= ?'; params.push(max_price); }
    if (min_price) { where += ' AND price >= ?'; params.push(min_price); }

    const products = db.prepare(
      `SELECT name, sku, category, price, stock, status FROM products WHERE ${where} ORDER BY sort_order ASC LIMIT ?`
    ).all(...params, Math.min(limit, 20));

    const total = db.prepare(`SELECT COUNT(*) AS n FROM products WHERE ${where}`).get(...params).n;

    return {
      total,
      returned: products.length,
      products: products.map(p => ({
        名称: p.name,
        SKU: p.sku,
        分类: p.category,
        价格: `¥${p.price}`,
        库存: p.stock,
        状态: p.status === 'active' ? '在售' : p.status === 'offline' ? '已下架' : '草稿'
      }))
    };
  }
};
