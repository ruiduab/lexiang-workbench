// Skill: 创建商品 — AI 助手可直接创建新商品
const db = require('../db/schema');

module.exports = {
  name: 'product_create',
  description: '创建新商品。提供商品名称、价格、描述等信息即可创建。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '商品名称' },
      sku: { type: 'string', description: 'SKU编码' },
      price: { type: 'number', description: '价格（元）' },
      original_price: { type: 'number', description: '原价（元，可选）' },
      category: { type: 'string', description: '分类名称' },
      description: { type: 'string', description: '商品描述' },
      stock: { type: 'number', description: '库存数量，默认100' },
      status: { type: 'string', description: '状态：active(上架)/draft(草稿)，默认draft' }
    },
    required: ['name', 'price']
  },
  execute: async ({ name, sku, price, original_price, category, description, stock, status }) => {
    // 生成 SKU
    if (!sku) sku = 'SKU-' + Date.now().toString(36).toUpperCase();
    // 查分类
    let catId = null;
    if (category) {
      const cat = db.prepare('SELECT id FROM product_categories WHERE name LIKE ? LIMIT 1').get(`%${category}%`);
      catId = cat ? cat.id : null;
    }
    try {
      const result = db.prepare(`
        INSERT INTO products (name, sku, price, original_price, category_id, description, stock, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(name, sku, price, original_price || price, catId, description || '', stock || 100, status || 'draft');
      return {
        success: true,
        id: result.lastInsertRowid,
        message: `商品「${name}」已创建 (SKU: ${sku})，状态: ${status || 'draft'}`,
        sku,
        price
      };
    } catch (e) {
      return { error: `创建失败: ${e.message}` };
    }
  }
};
