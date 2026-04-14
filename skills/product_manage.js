// Skill: 商品管理 — AI 助手可上下架/改价/改库存
const db = require('../db/schema');

module.exports = {
  name: 'product_manage',
  description: '管理商品：上架、下架、修改价格、修改库存。支持按名称或SKU定位商品。',
  parameters: {
    type: 'object',
    properties: {
      sku: { type: 'string', description: '商品SKU' },
      name: { type: 'string', description: '商品名称（模糊匹配）' },
      action: { type: 'string', description: '操作：上架(active)/下架(offline)/改价(set_price)/改库存(set_stock)' },
      value: { type: 'number', description: '新价格或新库存值（改价/改库存时必填）' }
    },
    required: ['action']
  },
  execute: async ({ sku, name, action, value }) => {
    // 定位商品
    let product;
    if (sku) {
      product = db.prepare('SELECT * FROM products WHERE sku = ?').get(sku);
    } else if (name) {
      product = db.prepare('SELECT * FROM products WHERE name LIKE ? LIMIT 1').get(`%${name}%`);
    }
    if (!product) return { error: '未找到匹配的商品，请提供准确的SKU或名称' };

    switch (action) {
      case 'active':
      case '上架':
        db.prepare('UPDATE products SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('active', product.id);
        return { success: true, message: `「${product.name}」已上架` };
      case 'offline':
      case '下架':
        db.prepare('UPDATE products SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('offline', product.id);
        return { success: true, message: `「${product.name}」已下架` };
      case 'set_price':
      case '改价':
        if (!value || value <= 0) return { error: '请提供有效的价格' };
        db.prepare('UPDATE products SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(value, product.id);
        return { success: true, message: `「${product.name}」价格已更新为 ¥${value}（原价 ¥${product.price}）` };
      case 'set_stock':
      case '改库存':
        if (value == null || value < 0) return { error: '请提供有效的库存数' };
        db.prepare('UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(value, product.id);
        return { success: true, message: `「${product.name}」库存已更新为 ${value}（原库存 ${product.stock}）` };
      default:
        return { error: `不支持的操作: ${action}，可用：上架/下架/改价/改库存` };
    }
  }
};
