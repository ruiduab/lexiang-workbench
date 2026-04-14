/**
 * 子 Agent：产品推荐专家
 * 专注联想产品选型，掌握详细产品矩阵知识
 */
const https = require('https');
const { searchAsync } = require('../../knowledge/search');
const db = require('../../db/schema');

const API_KEY = process.env.DASHSCOPE_API_KEY;
const MODEL = 'qwen-plus';

const SYSTEM_PROMPT = `你是联想产品选购专家"小想"，精通联想全线产品的性能参数、定位和价格区间。

## 你的专长
- ThinkPad 系列（商务、安全、耐用）：X系列轻薄、T系列经典、E系列入门、P系列工作站
- 拯救者系列（游戏娱乐）：Y旗舰、R主流、IdeaPad Gaming入门
- YOGA 系列（创意旗舰）：14s/Pro 轻薄、Slim系列、二合一翻转
- 小新系列（学生/性价比）：小新Air轻薄、小新Pro高性能
- ThinkBook 系列（职场年轻人）：轻薄商务创作
- 联想台式机、一体机、平板（Tab系列）、手机

## 回答风格
- 直接给出推荐，不废话
- 给出2-3个具体型号或系列，简要说明适合理由
- 有预算限制时严格按预算筛选
- 对比类问题直接列表对比核心差异
- 末尾提示"更多详情请访问联想官网 lenovo.com.cn"

## 产品知识
价位参考：
- 入门（3000-5000元）：小新15系列、IdeaPad、ThinkPad E系列
- 中端（5000-8000元）：小新Pro、ThinkBook、拯救者R系列
- 高端（8000-15000元）：ThinkPad X/T旗舰、YOGA Pro、拯救者Y系列
- 旗舰（15000+）：ThinkPad Z系列、ThinkStation工作站`;

module.exports = {
  name: 'product_advisor',
  description: '联想产品推荐专家，擅长根据需求推荐合适的联想产品',
  keywords: ['推荐', '选购', '哪款好', '哪款', '对比', '比较', '选哪', '买哪', '适合', '性价比', '配置'],

  async run(userMessage, historyMessages, ragContext) {
    // 搜索匹配的商品，用于前端卡片展示
    let matchedProducts = [];
    try {
      const keywords = userMessage.replace(/[推荐一个一款最新的买哪什么怎么选]/g, '').trim().split(/\s+/).filter(w => w.length > 1);
      if (keywords.length > 0) {
        const where = keywords.map(() => '(name LIKE ? OR category LIKE ?)').join(' OR ');
        const params = keywords.flatMap(k => [`%${k}%`, `%${k}%`]);
        matchedProducts = db.prepare(
          `SELECT name, category, price, original_price, description, specs FROM products WHERE price > 0 AND (${where}) ORDER BY price ASC LIMIT 5`
        ).all(...params);
      }
    } catch (e) { /* ignore */ }

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

    let systemContent = SYSTEM_PROMPT;
    if (extraContext && extraContext.trim()) {
      systemContent += '\n\n## 知识库参考\n' + extraContext;
    }

    const messages = [
      { role: 'system', content: systemContent },
      ...historyMessages.slice(-4), // 只保留最近4条历史避免太长
      { role: 'user', content: userMessage }
    ];

    const onChunk = arguments[3]; // 可选的流式回调
    return new Promise((resolve, reject) => {
      const useStream = typeof onChunk === 'function';
      const body = JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: 800,
        temperature: 0.4,
        stream: useStream
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
        let fullText = '';
        if (useStream) {
          let buf = '';
          res.on('data', chunk => {
            buf += chunk.toString();
            const lines = buf.split('\n');
            buf = lines.pop();
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const raw = line.slice(6).trim();
              if (raw === '[DONE]') continue;
              try {
                const j = JSON.parse(raw);
                const delta = j.choices?.[0]?.delta?.content || '';
                if (delta) { fullText += delta; onChunk(delta); }
              } catch {}
            }
          });
          res.on('end', () => resolve({ text: fullText, products: matchedProducts }));
        } else {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try {
              const j = JSON.parse(data);
              if (j.error) return reject(new Error(j.error.message || 'API error'));
              const text = j.choices?.[0]?.message?.content || '';
              resolve({ text, products: matchedProducts });
            } catch (e) {
              reject(new Error('JSON parse error: ' + data.slice(0, 100)));
            }
          });
        }
      });
      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('product_advisor timeout')); });
      req.write(body);
      req.end();
    });
  }
};
