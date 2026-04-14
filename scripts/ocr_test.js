// 小批量测试：只处理指定id的文档
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const db = require('better-sqlite3')('/root/lexiang/lexiang.db');

const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY;
const TEST_IDS = [5735, 12097, 16002];

async function fetchDetail(no) {
  try {
    const res = await fetch('https://iknow.lenovo.com.cn/knowledgeapi/api/knowledge/knowledgeDetails?knowledgeNo=' + no, { timeout: 10000 });
    const data = await res.json();
    return data.code === 200 ? data.data : null;
  } catch(e) { return null; }
}

async function classifyImage(imageUrl, title) {
  const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + DASHSCOPE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen-vl-plus',
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: imageUrl } },
        { type: 'text', text: `这是联想知识库教程中的一张图片，文章标题："${title}"。
请判断这张图片的类型，只返回以下4种类型之一，不要其他内容：

ui - 软件操作界面截图（如设置窗口、菜单、对话框、设备管理器等，用于说明操作步骤）
diagram - 流程图、连接示意图、网络拓扑图（用于说明操作流程或设备连接关系）
decorative - 营销插图、装饰图、产品外观图（无实质操作信息）
example - 与产品功能无关的示例素材，包括：演示用书本/课文内容、虚拟黑板上的示例文字、教学演示截图中展示的文档内容、2分屏中用于演示的书本页面。注意：如果图片主体是书本/课文/教材内容，即使画面边缘有软件工具栏，也应判定为 example

判定优先级：只要图片主体内容是"示例素材"，优先判 example，不要因为有工具栏就判 ui。

只返回 ui / diagram / decorative / example 四个词中的一个。` }
      ]}],
      max_tokens: 10
    }),
    timeout: 20000
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const raw = (data.choices[0].message.content || '').trim().toLowerCase();
  const type = ['ui', 'diagram', 'decorative', 'example'].find(t => raw.includes(t))
    || (raw.includes('示例') ? 'example' : 'decorative');
  return { type, tokens: data.usage.total_tokens };
}

async function ocrImage(imageUrl, title) {
  const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + DASHSCOPE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen-vl-plus',
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: imageUrl } },
        { type: 'text', text: `这是联想知识库教程截图，文章标题："${title}"。
请提取图片中与产品功能相关的文字内容，用 markdown 格式输出，保留层级结构：
- 用 ## 表示功能模块或章节标题
- 用 **步骤X** 或有序列表（1. 2. 3.）表示操作步骤
- 用普通文字表示说明性内容
- 界面元素（按钮名、菜单项）用【】标注
直接输出内容，不要加任何前言后语。

不要提取：
- 页码（如"第X页 共X页"）、页眉页脚、版权声明
- 目录索引行
- 与产品操作无关的内容

如果图片中没有与产品功能相关的文字，返回空字符串。` }
      ]}],
      max_tokens: 1000
    }),
    timeout: 30000
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const raw = data.choices[0].message.content || '';
  const text = raw
    .replace(/第\s*\d+\s*页\s*共\s*\d+\s*页/g, '')
    .replace(/^(Lenovo|联想)\s*$/gm, '')
    .replace(/^\d{4}\s*Lenovo\s+Internal.*$/gm, '')
    .replace(/^#{1,6}\s*示例(页面|文本|内容|素材).*/gm, '')
    .replace(/^[-*]\s*\*{0,2}(页面标题|示例文本|示例内容)\*{0,2}[：:].*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, tokens: data.usage.total_tokens };
}

(async () => {
  const docs = db.prepare(
    `SELECT id, title, source_url, content FROM knowledge_docs WHERE id IN (${TEST_IDS.join(',')})`
  ).all();

  let totalTokens = 0;

  for (const doc of docs) {
    const match = doc.source_url && doc.source_url.match(/\/detail\/(\d+)/);
    if (!match) continue;

    console.log(`\n=== [${doc.id}] ${doc.title} ===`);
    try {
      const detail = await fetchDetail(match[1]);

      // 提取产品名
      const fp = detail?.firstProductName;
      const sp = detail?.subProductName;
      const productParts = [];
      if (fp && sp && fp !== sp) productParts.push(`${fp} ${sp}`);
      else if (fp) productParts.push(fp);
      else if (sp) productParts.push(sp);
      const productLine = productParts.length ? `适用产品：${productParts.join('、')}` : '';
      if (productLine) console.log('  产品名:', productLine);

      const html = (detail && detail.content) || '';
      const $ = cheerio.load(html);
      const imgUrls = [];
      $('img').each(function(_, el) {
        const src = $(el).attr('src');
        if (src && src.startsWith('http')) imgUrls.push(src);
      });
      console.log(`  图片数: ${imgUrls.length}张`);

      const parts = [];
      for (let i = 0; i < imgUrls.length; i++) {
        const imgUrl = imgUrls[i];
        try {
          const { type, tokens: t1 } = await classifyImage(imgUrl, doc.title);
          totalTokens += t1;
          process.stdout.write(`  [${i+1}/${imgUrls.length}] ${type.padEnd(10)}`);

          if (type === 'ui' || type === 'diagram') {
            const { text, tokens: t2 } = await ocrImage(imgUrl, doc.title);
            totalTokens += t2;
            const trimmed = text?.trim() || '';
            if (trimmed.length > 20) {
              parts.push(trimmed);
              console.log(`→ OCR ${trimmed.length}字`);
            } else {
              console.log(`→ OCR 内容为空，跳过`);
            }
            await new Promise(r => setTimeout(r, 300));
          } else if (type === 'example') {
            parts.push(`![操作示意图](${imgUrl})`);
            console.log(`→ 保留图片链接`);
          } else {
            console.log(`→ 跳过`);
          }
          await new Promise(r => setTimeout(r, 200));
        } catch(e) {
          console.log(`  [${i+1}] 失败: ${e.message}`);
        }
      }

      if (parts.length > 0 || productLine) {
        const newContent = [doc.content, productLine, ...parts].filter(Boolean).join('\n\n');
        db.prepare('UPDATE knowledge_docs SET content = ?, updated_at = ? WHERE id = ?')
          .run(newContent, new Date().toISOString().replace('T',' ').substring(0,19), doc.id);
        const ocrCount = parts.filter(p => !p.startsWith('![')).length;
        const linkCount = parts.filter(p => p.startsWith('![')).length;
        console.log(`  ✓ 已更新 OCR:${ocrCount}张 链接:${linkCount}张`);
      }
    } catch(e) {
      console.log('  ✗ 失败:', e.message);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n=== 完成 | 总消耗: ${totalTokens} tokens ≈ ${(totalTokens * 0.000008).toFixed(4)} 元 ===`);
})().catch(e => console.error('Fatal:', e.message));
