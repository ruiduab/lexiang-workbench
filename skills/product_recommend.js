// Skill: 联想产品推荐
// 根据用户需求推荐合适的联想产品线和购买建议

module.exports = {
  name: 'product_recommend',
  description: '根据用户描述的需求（预算、用途、偏好）推荐联想产品线，并给出购买建议和官网链接引导。',
  parameters: {
    type: 'object',
    properties: {
      use_case: {
        type: 'string',
        description: '用户的使用场景，如：办公、游戏、学生、设计、服务器等'
      },
      budget: {
        type: 'string',
        description: '预算范围，如：3000以内、5000-8000、不限等'
      },
      preference: {
        type: 'string',
        description: '其他偏好，如：轻薄、高性能、长续航、大屏等'
      }
    },
    required: ['use_case']
  },
  execute: async ({ use_case, budget, preference }) => {
    // 产品线知识库（静态数据，可后续替换为动态API）
    const catalog = {
      '商务办公': {
        series: ['ThinkPad X系列（轻薄商务）', 'ThinkPad T系列（经典商务）', 'ThinkPad E系列（入门商务）'],
        highlights: ['军规认证耐用性', 'ThinkShield安全套件', '长达20小时续航'],
        price_range: '4000-20000',
        url: 'https://www.lenovo.com.cn/products/laptops/thinkpad/'
      },
      '游戏娱乐': {
        series: ['拯救者Y系列（旗舰游戏）', '拯救者R系列（主流游戏）', 'IdeaPad Gaming系列（入门游戏）'],
        highlights: ['高刷新率屏幕165Hz+', '独立显卡RTX40系列', '高效散热液金属技术'],
        price_range: '5000-20000',
        url: 'https://www.lenovo.com.cn/products/laptops/legion/'
      },
      '学生': {
        series: ['小新系列（性价比首选）', 'IdeaPad系列（入门全能）'],
        highlights: ['轻薄便携', '高性价比', '长续航'],
        price_range: '3000-7000',
        url: 'https://www.lenovo.com.cn/products/laptops/ideapad/'
      },
      '创意设计': {
        series: ['YOGA系列（创意旗舰）', 'ThinkBook系列（轻薄创作）'],
        highlights: ['色域广屏幕100% sRGB', 'OLED可选', '触控翻转'],
        price_range: '6000-15000',
        url: 'https://www.lenovo.com.cn/products/laptops/yoga/'
      },
      '服务器': {
        series: ['ThinkSystem系列', 'ThinkAgile超融合系列', 'ThinkEdge边缘计算系列'],
        highlights: ['全球第一服务器品牌', '24/7企业级支持', '混合云解决方案'],
        price_range: '15000+',
        url: 'https://www.lenovo.com.cn/products/servers/'
      }
    };

    // 简单匹配逻辑
    let matched = null;
    const useLower = use_case.toLowerCase();
    if (useLower.includes('游戏') || useLower.includes('game')) matched = catalog['游戏娱乐'];
    else if (useLower.includes('设计') || useLower.includes('创意') || useLower.includes('绘图')) matched = catalog['创意设计'];
    else if (useLower.includes('学生') || useLower.includes('学习')) matched = catalog['学生'];
    else if (useLower.includes('服务器') || useLower.includes('企业') || useLower.includes('数据中心')) matched = catalog['服务器'];
    else matched = catalog['商务办公'];

    return {
      recommendations: matched,
      query: { use_case, budget, preference },
      note: '以上为产品线概述，具体型号和最新价格请访问联想官网或联系官方客服'
    };
  }
};
