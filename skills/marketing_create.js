// Skill: 创建营销任务 — AI 助手可直接创建营销推送
const db = require('../db/schema');

module.exports = {
  name: 'marketing_create',
  description: '创建营销任务/推送活动。可指定任务名、类型、目标人群、时间等。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '任务名称' },
      type: { type: 'string', description: '类型：push(推送)/sms(短信)/email(邮件)/banner(横幅)，默认push' },
      target: { type: 'string', description: '目标人群描述' },
      content: { type: 'string', description: '推送内容/文案' },
      scheduled_at: { type: 'string', description: '计划执行时间（ISO格式），不填则立即' }
    },
    required: ['name']
  },
  execute: async ({ name, type, target, content, scheduled_at }) => {
    try {
      const result = db.prepare(`
        INSERT INTO marketing_tasks (name, type, target_desc, content, status, scheduled_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(name, type || 'push', target || '全部用户', content || '', scheduled_at || null);
      return {
        success: true,
        id: result.lastInsertRowid,
        message: `营销任务「${name}」已创建，类型: ${type || 'push'}，状态: 待执行`
      };
    } catch (e) {
      return { error: `创建失败: ${e.message}` };
    }
  }
};
