// Skill: 联想客服 & 联系方式
// 返回官方客服渠道信息

module.exports = {
  name: 'contact_service',
  description: '提供联想官方客服联系方式、售后服务渠道、门店查询等信息。当用户需要联系客服、报修、投诉或寻找门店时使用。',
  parameters: {
    type: 'object',
    properties: {
      service_type: {
        type: 'string',
        description: '服务类型：customer_service（客服）| after_sales（售后）| store（门店）| complaint（投诉）| b2b（企业采购）'
      }
    },
    required: ['service_type']
  },
  execute: async ({ service_type }) => {
    const contacts = {
      customer_service: {
        hotline: '400-990-8888',
        hours: '周一至周日 9:00-21:00',
        online: 'https://support.lenovo.com.cn',
        wechat: '搜索"联想服务"小程序',
        description: '联想消费者客服热线，解答产品咨询、订单查询等问题'
      },
      after_sales: {
        hotline: '400-990-8888',
        portal: 'https://support.lenovo.com.cn',
        service_check: '可通过官网查询最近的联想授权服务网点',
        warranty: '可在官网输入SN码查询保修状态',
        description: '联想售后服务，支持上门服务、快递维修、门店维修'
      },
      store: {
        portal: 'https://www.lenovo.com.cn/stores',
        description: '全国3000+联想授权门店，可在官网地图查询最近门店',
        online_store: 'https://lenovo.tmall.com（天猫旗舰店）'
      },
      complaint: {
        hotline: '400-990-8888 转投诉',
        email: 'feedback@lenovo.com',
        description: '联想重视每一位用户反馈，投诉将在3个工作日内响应'
      },
      b2b: {
        hotline: '400-990-8866',
        portal: 'https://b2b.lenovo.com.cn',
        description: '联想企业级客户专属服务，提供定制化解决方案和专属客户经理'
      }
    };

    const info = contacts[service_type] || contacts['customer_service'];
    return { service_type, ...info };
  }
};
