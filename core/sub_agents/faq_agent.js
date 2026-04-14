/**
 * 子 Agent：快速问答专家
 * 快速、简洁回答常见问题，不废话
 */
const https = require('https');
const { searchAsync } = require('../../knowledge/search');

const API_KEY = process.env.DASHSCOPE_API_KEY;
const MODEL = 'qwen-plus';

const SYSTEM_PROMPT = `你是联想快速问答助手"小Q"，专门用简洁直接的方式回答联想相关常见问题。

## 回答原则
- 直接给答案，不废话，不重复用户的问题
- 不超过100字（除非列表/步骤确实需要）
- 不知道就直接说"建议联系官方客服：400-990-8888"
- 对于事实类问题（参数、价格、政策）务必准确，不确定加"请以官网为准"

## 你擅长回答
- 联想产品基本参数、型号确认
- 简单的联系方式、官网地址
- 快速的是/否类政策问题
- 简单的操作步骤（≤3步）`;

module.exports = {
  name: 'faq_agent',
  description: '快速问答专家，简洁回答联想相关常见问题',
  keywords: [], // FAQ Agent 通过问题长度判断，不用关键词

  async run(userMessage, historyMessages, ragContext) {
    // 做知识库搜索，优先给出精准答案
    let extraContext = ragContext || '';
    try {
      const hits = await searchAsync(userMessage, 2);
      if (hits.length > 0) {
        const kbContext = hits.map((h, i) =>
          `[${i + 1}] 《${h.title}》\n${h.content.slice(0, 300)}`
        ).join('\n\n');
        extraContext = kbContext + (extraContext ? '\n\n' + extraContext : '');
      }
    } catch (e) {
      // 知识搜索失败不阻断
    }

    let systemContent = SYSTEM_PROMPT;
    if (extraContext && extraContext.trim()) {
      systemContent += '\n\n## 知识库参考\n' + extraContext;
    }

    const messages = [
      { role: 'system', content: systemContent },
      ...historyMessages.slice(-2), // FAQ 只需要最近2条历史
      { role: 'user', content: userMessage }
    ];

    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: 300,
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
      req.setTimeout(20000, () => { req.destroy(); reject(new Error('faq_agent timeout')); });
      req.write(body);
      req.end();
    });
  }
};
