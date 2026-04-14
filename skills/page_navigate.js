// Skill: 页面导航 — AI 识别用户意图后返回导航指令
// 前端AI会拦截回复中的 [NAV:pageId] 标记自动跳转
module.exports = {
  name: 'page_navigate',
  description: '导航到工作台指定页面。当用户说"打开xxx"、"去xxx"、"看看xxx"时使用此工具。可用页面：运营总览(dashboard.overview)、GEO监控(dashboard.geo)、Query分析(dashboard.query)、商品管理(ecommerce.products)、分类管理(ecommerce.categories)、订单管理(ecommerce.orders)、售后(ecommerce.aftersale)、门店(ecommerce.stores)、营销任务(marketing.tasks)、页面管理(content.pages)、组件库(content.components)、知识库(content.knowledge)、对话记录(ai.conversations)、AI控制台(ai.console)、技能管理(ai.skills)、人设(ai.personas)、进化系统(ai.evolution)、监控告警(ai.monitor)、回归测试(ai.regression)、客户画像(users.profiles)、成员管理(users.members)、系统配置(settings.config)、账号管理(settings.accounts)、操作日志(settings.logs)',
  parameters: {
    type: 'object',
    properties: {
      page_id: { type: 'string', description: '目标页面ID，如 ecommerce.products' },
      reason: { type: 'string', description: '简短说明为什么导航到此页面' }
    },
    required: ['page_id']
  },
  execute: async ({ page_id, reason }) => {
    return {
      action: 'navigate',
      page_id,
      message: `[NAV:${page_id}] 已导航到 ${page_id}`,
      reason: reason || ''
    };
  }
};
