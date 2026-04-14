// Skill: 多步任务规划器
// 将复杂用户需求拆解为有序子任务列表，返回结构化任务计划

const https = require('https');

const API_KEY = process.env.DASHSCOPE_API_KEY;
const MODEL = 'qwen-plus';

module.exports = {
  name: 'task_planner',
  description: '将复杂用户需求拆解为有序子任务列表，返回结构化任务计划。适用于多步骤问题（如选购方案、对比分析、系统规划等）。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '用户的复杂需求描述'
      },
      context: {
        type: 'string',
        description: '额外上下文信息，如已知条件、约束条件等（可选）'
      }
    },
    required: ['query']
  },
  execute: async ({ query, context }) => {
    const contextPart = context ? `\n背景信息：${context}` : '';
    const prompt = `你是一个任务规划专家。请将以下用户需求拆解为3-6个有序的子任务步骤。

用户需求：${query}${contextPart}

请用以下JSON格式输出（只输出JSON，不要其他内容）：
{
  "summary": "一句话总结任务目标",
  "steps": [
    {
      "step": 1,
      "description": "具体步骤描述",
      "tool_hint": "建议使用的工具名称，如product_recommend/knowledge_rag/web_search，若不需要工具则填null"
    }
  ]
}`;

    return new Promise((resolve) => {
      const body = JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
        temperature: 0.3
      });

      const req = https.request({
        hostname: 'dashscope.aliyuncs.com',
        path: '/compatible-mode/v1/chat/completions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            const content = j.choices?.[0]?.message?.content?.trim() || '';
            // 提取 JSON 内容（去除可能的 markdown 代码块）
            const match = content.match(/\{[\s\S]*\}/);
            if (match) {
              const plan = JSON.parse(match[0]);
              resolve({
                success: true,
                summary: plan.summary || '',
                steps: Array.isArray(plan.steps) ? plan.steps : []
              });
            } else {
              resolve({
                success: false,
                error: '任务拆解失败：LLM 未返回有效 JSON',
                summary: '',
                steps: []
              });
            }
          } catch (e) {
            resolve({
              success: false,
              error: `解析失败: ${e.message}`,
              summary: '',
              steps: []
            });
          }
        });
        res.on('error', (e) => {
          resolve({ success: false, error: e.message, summary: '', steps: [] });
        });
      });

      req.on('error', (e) => {
        resolve({ success: false, error: e.message, summary: '', steps: [] });
      });
      req.setTimeout(30000, () => {
        req.destroy();
        resolve({ success: false, error: '任务规划超时', summary: '', steps: [] });
      });
      req.write(body);
      req.end();
    });
  }
};
