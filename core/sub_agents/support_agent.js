/**
 * 子 Agent：售后服务专家
 * 专注联想售后、保修、维修、驱动等问题
 */
const https = require('https');
const { searchAsync } = require('../../knowledge/search');

const API_KEY = process.env.DASHSCOPE_API_KEY;
const MODEL = 'qwen-plus';

const SYSTEM_PROMPT = `你是联想售后服务专家"小联"，精通联想产品的保修政策、维修流程、驱动下载和故障排查。

## 你的专长
- 联想保修政策（整机保修1年、电池保修1年等各类政策）
- 延保服务（联想随心换、联想一站式服务等）
- 维修服务流程（预约、邮寄、上门服务）
- 驱动程序下载（官网 support.lenovo.com.cn）
- 常见故障排查（蓝屏、无法开机、WIFI问题等）
- 官方客服联系方式

## 回答风格
- 直接给出解决方案，步骤清晰
- 对于保修问题，先确认购买渠道和时间
- 提供官方渠道（官网、客服电话400-990-8888）
- 不能确定的问题引导用户联系官方客服

## 关键知识
- 联想消费类产品整机一年保修（部分产品2年）
- 电池单独保修1年（特殊情况6个月）
- ThinkPad商用产品标配3年保修
- 驱动下载：https://support.lenovo.com.cn
- 官方服务热线：400-990-8888
- 全国服务中心查询：https://support.lenovo.com.cn/SC/serviceStation`;

module.exports = {
  name: 'support_agent',
  description: '联想售后服务专家，处理保修、维修、驱动、故障排查等问题',
  keywords: ['保修', '维修', '故障', '驱动', '售后', '修', '坏', '蓝屏', '无法', '不能开机', '黑屏', '延保', '返修', '寄修'],

  async run(userMessage, historyMessages, ragContext) {
    // 先做知识库搜索增强回答
    let extraContext = ragContext || '';
    try {
      const hits = await searchAsync(userMessage, 3);
      if (hits.length > 0) {
        const kbContext = hits.map((h, i) =>
          `[${i + 1}] 《${h.title}》\n${h.content.slice(0, 400)}`
        ).join('\n\n');
        extraContext = kbContext + (extraContext ? '\n\n' + extraContext : '');
      }
    } catch (e) {
      // 知识搜索失败不阻断
    }

    // 联网搜索（售后信息可能需要实时）
    try {
      const registry = require('../skill-registry');
      const webResult = await registry.execute('web_search', { query: '联想 ' + userMessage });
      if (webResult.found && webResult.results?.length > 0) {
        const webCtx = webResult.results.slice(0, 2).map((r, i) =>
          `[网络${i + 1}] ${r.title}\n${r.snippet}`
        ).join('\n\n');
        extraContext += (extraContext ? '\n\n---\n' : '') + '## 网络搜索参考\n' + webCtx;
      }
    } catch (e) {
      // 联网搜索失败不阻断
    }

    let systemContent = SYSTEM_PROMPT;
    if (extraContext && extraContext.trim()) {
      systemContent += '\n\n## 参考资料\n' + extraContext;
    }

    const messages = [
      { role: 'system', content: systemContent },
      ...historyMessages.slice(-4),
      { role: 'user', content: userMessage }
    ];

    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: 600,
        temperature: 0.3
      });

      const req = https.request({
        hostname: 'dashscope.aliyuncs.com',
        path: '/compatible-mode/v1/chat/completions',
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + API_KEY,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            if (j.error) return reject(new Error(j.error.message || 'API error'));
            const text = j.choices?.[0]?.message?.content || '';
            resolve({ text });
          } catch (e) {
            reject(new Error('JSON parse error: ' + data.slice(0, 100)));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('support_agent timeout')); });
      req.write(body);
      req.end();
    });
  }
};
