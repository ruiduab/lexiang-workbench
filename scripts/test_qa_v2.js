// 测试QA v2 prompt效果
const fetch = require('node-fetch');
const db = require('better-sqlite3')('/root/lexiang/lexiang.db');
const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY;

// 从gen_qa_v2.js复制分类和prompt构建
function classifyDoc(doc) {
  const title = (doc.title || '').toLowerCase();
  const content = (doc.content || '');
  if (content.length < 80) return 'skip';
  const metaRatio = (content.match(/分类[:：]|关键词[:：]|版本[:：]|uploadArr|fileSrc|fileType/g) || []).length;
  if (metaRatio >= 3 && content.length < 300) return 'skip';
  if (title.includes('安全') && (title.includes('公告') || title.includes('漏洞') || content.includes('CVE-'))) return 'security';
  if (/产品介绍|参数|规格|配置/.test(title) || /屏幕[：:].*分辨率|处理器[：:]|内存[：:]/.test(content)) return 'product_spec';
  if (/用户指南|用户手册|设置指南|操作手册/.test(title)) return 'user_guide';
  return 'howto';
}

function buildPrompt(doc, docType) {
  const title = doc.title;
  const content = (doc.content || '').substring(0, 4000);
  const commonRules = `
严格规则：
- Q 必须具体，带上产品名称，不用模糊指代
- Q 只问一件事
- A 必须从原文抽取关键信息，不能只给文档标题
- A 脱离Q后仍可独立理解
- A 禁止出现 uploadArr/fileSrc/fileType 等内部字段
- A 禁止出现"分类:xxx"等元数据标签
- 多型号共用答案时合并为一条Q
输出：严格JSON数组 [{"q":"...","a":"...","user_type":"consumer|smb|enterprise|general"}]`;

  if (docType === 'howto') {
    return `你是联想官方知识库助手。根据以下文档生成QA对。

文档标题：${title}
文档内容：
${content}

类型：操作/故障解决类
Q模板：1.问题现象型 2.操作步骤型 3.原因型
A要求：必须含原因+具体步骤+注意事项，事实类50-150字，步骤类150-500字
${commonRules}`;
  }
  if (docType === 'user_guide') {
    return `你是联想官方知识库助手。根据以下用户指南文档生成QA对。

文档标题：${title}
文档内容：
${content}

类型：用户指南/手册类
Q模板：1.功能使用型 2.规格查询型 3.操作前提型
A要求：规格类给完整列表，操作类含前提和注意事项
${commonRules}`;
  }
  if (docType === 'product_spec') {
    return `你是联想官方知识库助手。根据以下产品文档生成QA对。

文档标题：${title}
文档内容：
${content}

类型：产品参数/特性类
Q模板：1.参数查询型 2.功能特性型 3.适配查询型
A要求：参数含数值+单位+说明，适配类明确说支持/不支持
${commonRules}`;
  }
  if (docType === 'security') {
    return `你是联想官方知识库助手。根据以下安全公告生成QA对。

文档标题：${title}
文档内容：
${content}

类型：安全公告类
Q模板：1.影响范围型 2.修复方案型 3.风险说明型
A要求：必须含受影响版本+修复版本号+更新方式
${commonRules}`;
  }
  return null;
}

(async () => {
  // 每种类型取一篇测试
  const types = ['howto', 'user_guide', 'product_spec', 'security'];
  const allDocs = db.prepare(`SELECT id, title, content FROM knowledge_docs
    WHERE source_url LIKE '%iknow%' AND content IS NOT NULL AND LENGTH(content) > 300 ORDER BY RANDOM()`).all();

  for (const targetType of types) {
    const doc = allDocs.find(d => classifyDoc(d) === targetType);
    if (!doc) { console.log(`\n跳过 ${targetType}: 无匹配文档`); continue; }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`类型: ${targetType} | 文档: [${doc.id}] ${doc.title}`);
    console.log(`内容长度: ${doc.content.length}`);

    const prompt = buildPrompt(doc, targetType);
    const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + DASHSCOPE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'qwen-plus', messages: [{ role: 'user', content: prompt }], max_tokens: 4000 }),
      timeout: 60000
    });
    const data = await res.json();
    if (data.error) { console.log('API错误:', data.error); continue; }

    const raw = data.choices[0].message.content.trim();
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) { console.log('格式不对:', raw.substring(0, 100)); continue; }

    const pairs = JSON.parse(match[0]);
    console.log(`生成 ${pairs.length} 条QA (${data.usage.total_tokens} tokens):`);
    pairs.forEach((p, i) => {
      console.log(`  Q${i+1}: ${p.q}`);
      console.log(`  A${i+1}: ${p.a.substring(0, 150)}${p.a.length > 150 ? '...' : ''}`);
    });
  }
})();
