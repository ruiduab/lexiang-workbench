/**
 * L2.7 多Agent协作调度器
 * 根据用户问题决定是否 dispatch 给子 Agent，以及 dispatch 给哪个
 */

const productAdvisor = require('./sub_agents/product_advisor');
const supportAgent = require('./sub_agents/support_agent');
const faqAgent = require('./sub_agents/faq_agent');

// 支持调度的子 Agent 列表（按优先级排列，前面的优先匹配）
const SUB_AGENTS = [productAdvisor, supportAgent, faqAgent];

/**
 * 判断是否应该 dispatch，返回子 Agent 或 null
 * 路由规则：关键词匹配 + 长度判断，宁可不分发，不能误分发
 *
 * @param {string} userMessage
 * @returns {object|null} 子 Agent 对象，或 null（走主 Agent）
 */
function shouldDispatch(userMessage) {
  if (!userMessage || typeof userMessage !== 'string') return null;

  const msg = userMessage.trim();
  if (!msg) return null;

  // 过短消息（单字、2字以下）不分发
  if (msg.length < 3) return null;

  // 优先检查产品推荐和售后（关键词精准匹配）
  for (const agent of [productAdvisor, supportAgent]) {
    if (!agent.keywords || agent.keywords.length === 0) continue;
    const matched = agent.keywords.some(kw => msg.includes(kw));
    if (matched) {
      console.log(`[Dispatcher] Route to ${agent.name} (keyword match)`);
      return agent;
    }
  }

  // FAQ Agent：问题 < 20字 且不含复杂需求标志
  const complexIndicators = ['帮我', '制定', '方案', '规划', '分析', '总结', '写', '生成', '翻译', '代码'];
  const hasComplex = complexIndicators.some(kw => msg.includes(kw));
  if (msg.length < 20 && !hasComplex) {
    // 必须是联想相关（含联想/ThinkPad/小新等产品词，或是简单的是/否问题）
    const lenovo_keywords = ['联想', 'lenovo', 'thinkpad', 'thinkbook', '小新', 'yoga', '拯救者', 'ideapad', '天逸', '昭阳'];
    const isLenovoRelated = lenovo_keywords.some(kw => msg.toLowerCase().includes(kw));
    if (isLenovoRelated) {
      console.log(`[Dispatcher] Route to ${faqAgent.name} (short+lenovo)`);
      return faqAgent;
    }
  }

  return null;
}

/**
 * 执行子 Agent，失败时抛出错误（由调用方 fallback）
 *
 * @param {object} subAgent - 子 Agent 对象
 * @param {string} userMessage
 * @param {Array} historyMessages - 历史消息数组
 * @param {string} ragContext - RAG 上下文
 * @returns {Promise<{text: string}>}
 */
async function dispatch(subAgent, userMessage, historyMessages, ragContext, onChunk) {
  console.log(`[Dispatcher] Dispatching to ${subAgent.name}`);
  const result = await subAgent.run(userMessage, historyMessages || [], ragContext || '', onChunk);
  if (!result || !result.text) {
    throw new Error(`${subAgent.name} returned empty response`);
  }
  return result;
}

module.exports = { shouldDispatch, dispatch };
