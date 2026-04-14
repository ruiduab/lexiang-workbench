// QA生成v2 - 按文档类型分类生成，严格质量控制
// 全量重新生成模式：先清空knowledge_qa表，然后逐篇生成
const fetch = require('node-fetch');
const db = require('better-sqlite3')('/root/lexiang/lexiang.db');

const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY;
const BATCH_SIZE = 15;
const DELAY_MS = 300;

// ===== 文档类型判定 =====
function classifyDoc(doc) {
  const title = (doc.title || '').toLowerCase();
  const content = (doc.content || '');

  // 元数据/目录文档 → 不生成
  if (content.length < 80) return 'skip';
  // 纯元数据标签列表
  const metaRatio = (content.match(/分类[:：]|关键词[:：]|版本[:：]|uploadArr|fileSrc|fileType/g) || []).length;
  if (metaRatio >= 3 && content.length < 300) return 'skip';

  // 安全公告
  if (title.includes('安全') && (title.includes('公告') || title.includes('漏洞') || content.includes('CVE-'))) return 'security';
  // 产品参数/特性
  if (/产品介绍|参数|规格|配置/.test(title) || /屏幕[：:].*分辨率|处理器[：:]|内存[：:]/.test(content)) return 'product_spec';
  // 用户指南/手册
  if (/用户指南|用户手册|设置指南|操作手册/.test(title)) return 'user_guide';
  // 操作/故障解决（最常见）
  return 'howto';
}

// ===== 各类型的prompt =====
function buildPrompt(doc, docType) {
  const title = doc.title;
  const content = (doc.content || '').substring(0, 4000);

  const commonRules = `
严格规则（违反任何一条则该QA对作废）：
- Q 必须具体，带上产品名称，不用"它/该设备/此功能"等模糊指代
- Q 只问一件事，不要复合问题
- A 必须从原文抽取关键信息，不能只给文档标题或分类标签
- A 脱离Q后仍然语义完整、可独立理解
- A 中禁止出现 uploadArr、fileSrc、fileType 等内部技术字段
- A 中禁止出现"分类:xxx"、"问题:xxx"、"版本:xxx"等元数据标签
- 不要为同一个答案生成多个只改了产品型号的重复Q
- 如果多个型号共用同一个答案，合并为一条Q（如"小新Pro 14系列"）
- 如果原文包含下载链接（如 [文件名](URL) 格式），A 中必须保留完整的下载链接，格式为 [文件名](URL)
- 如果原文包含图片链接（如 ![描述](URL) 格式），A 中视情况保留图片链接

输出格式：严格JSON数组，不要其他内容
[{"q": "...", "a": "...", "user_type": "consumer|smb|enterprise|general"}]`;

  if (docType === 'howto') {
    return `你是联想官方知识库助手。根据以下文档生成用户可能提问的QA对。

文档标题：${title}
文档内容：
${content}

文档类型：操作/故障解决类

Question模板（按优先级）：
1. 问题现象型：「产品名 + 症状 + 怎么办」（最高优先级）
2. 操作步骤型：「产品名 + 如何 + 操作名」
3. 原因型：「产品名 + 为什么/什么原因 + 现象」

Answer要求：
- 必须包含：原因 + 具体解决步骤 + 注意事项（如有）
- 操作类答案要有完整步骤，不能只说"请参考文档"或只给文档标题
- 事实类50-150字，步骤类150-500字
${commonRules}`;
  }

  if (docType === 'user_guide') {
    return `你是联想官方知识库助手。根据以下用户指南/手册文档生成QA对。

文档标题：${title}
文档内容：
${content}

文档类型：用户指南/手册类

Question模板：
1. 功能使用型：「产品型号 + 如何/怎么 + 功能名」
2. 规格查询型：「产品型号 + 支持/具备 + 规格项」
3. 操作前提型：「产品 + 操作前需要 + 什么条件」

Answer要求：
- 规格类 → 给出完整列表，不遗漏
- 操作类 → 步骤完整，包含前提条件和注意事项
- 如果指南适用多个型号，在Answer中列出全部适用型号
- 如果文档内容包含PDF下载链接（[文件名](URL)格式），必须生成一条"如何获取/下载用户指南"的QA，Answer中保留完整下载链接
- 如果文档只有下载链接没有其他实质内容，生成1-2条QA即可，不要硬凑
${commonRules}`;
  }

  if (docType === 'product_spec') {
    return `你是联想官方知识库助手。根据以下产品参数/特性文档生成QA对。

文档标题：${title}
文档内容：
${content}

文档类型：产品参数/特性类

Question模板：
1. 参数查询型：「产品名 + 屏幕/电池/重量等参数是多少」
2. 功能特性型：「产品名 + 有哪些特色功能/亮点」
3. 适配查询型：「产品名 + 支持/兼容哪些 + 设备/接口」

Answer要求：
- 参数类 → 数值 + 单位 + 说明，缺一不可
- 功能类 → 给出具体数值或对比（如"延迟降低54.8%"）
- 适配类 → 明确说支持/不支持，给出范围
${commonRules}`;
  }

  if (docType === 'security') {
    return `你是联想官方知识库助手。根据以下安全公告文档生成QA对。

文档标题：${title}
文档内容：
${content}

文档类型：安全公告类

Question模板：
1. 影响范围型：「产品/组件 + 哪些版本受影响」（最高优先级）
2. 修复方案型：「产品 + 如何修复/更新到哪个版本」
3. 风险说明型：「CVE编号 + 会造成什么影响」

Answer要求：
- 必须包含：受影响的版本范围 + 修复版本号 + 更新方式
- CVE编号要保留原文
${commonRules}`;
  }

  // fallback
  return null;
}

// ===== QA质量后过滤 =====
function filterQA(pairs) {
  return pairs.filter(p => {
    const q = p.q || '';
    const a = p.a || '';
    // 过滤元数据复读
    if (/^分类[:：]/.test(a) || /^关键词[:：]/.test(a) || /^版本[:：]/.test(a)) return false;
    if (/uploadArr|fileSrc|fileType|htmlZip/.test(a)) return false;
    if (/^问题[:：]/.test(a)) return false;
    // 过滤极短answer
    if (a.length < 15) return false;
    // 过滤Q=A（答非所问/复读）
    if (q.replace(/？|\?/g, '') === a.replace(/。/g, '')) return false;
    // 过滤answer就是文档标题
    if (a.length < 40 && !a.includes('。') && !a.includes('，')) return false;
    return true;
  });
}

async function generateQA(doc) {
  const docType = classifyDoc(doc);
  if (docType === 'skip') return null;

  const prompt = buildPrompt(doc, docType);
  if (!prompt) return null;

  const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + DASHSCOPE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen-plus',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000
    }),
    timeout: 90000
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

  const raw = data.choices[0].message.content.trim();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('返回格式不对: ' + raw.substring(0, 100));

  let pairs = JSON.parse(match[0]);
  // 后过滤
  pairs = filterQA(pairs);
  if (pairs.length === 0) return null;

  return { pairs, tokens: data.usage.total_tokens, docType };
}

async function processBatch(docs) {
  return Promise.allSettled(docs.map(async (doc) => {
    try {
      const result = await generateQA(doc);
      if (!result) return { doc, skipped: true };
      return { doc, ...result };
    } catch (e) {
      return { doc, error: e.message };
    }
  }));
}

(async () => {
  const mode = process.argv[2] || 'full'; // full=全量重新生成, incremental=增量

  const insertQA = db.prepare(
    'INSERT INTO knowledge_qa (doc_id, question, answer, user_type) VALUES (?, ?, ?, ?)'
  );
  const deleteByDoc = db.prepare('DELETE FROM knowledge_qa WHERE doc_id = ?');

  if (mode === 'full') {
    console.log('⚠️  全量模式：清空 knowledge_qa 表...');
    const { changes } = db.prepare('DELETE FROM knowledge_qa').run();
    console.log(`已删除 ${changes} 条旧QA`);
    // 清空FTS索引
    try { db.prepare('DELETE FROM knowledge_qa_fts').run(); } catch(e) {}
  }

  // 获取已完成的doc_id（增量模式用）
  const existingDocIds = mode === 'full' ? new Set() : new Set(
    db.prepare('SELECT DISTINCT doc_id FROM knowledge_qa').all().map(r => r.doc_id)
  );

  // 取所有iknow文档
  const allDocs = db.prepare(
    `SELECT id, title, source_url, content FROM knowledge_docs
     WHERE source_url LIKE '%iknow%' AND content IS NOT NULL AND content != ''
     ORDER BY id`
  ).all();

  const docs = mode === 'full' ? allDocs : allDocs.filter(d => !existingDocIds.has(d.id));
  console.log(`iknow文档总数: ${allDocs.length}, 待处理: ${docs.length}`);

  // 统计文档类型分布
  const typeCounts = {};
  docs.forEach(d => {
    const t = classifyDoc(d);
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });
  console.log('文档类型分布:', typeCounts);

  let totalTokens = 0, totalQA = 0, errors = 0, skipped = 0;
  const typeQA = {};
  const startTime = Date.now();

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    const results = await processBatch(batch);

    for (const result of results) {
      const { value } = result;
      if (result.status === 'rejected' || !value) { errors++; continue; }
      if (value.skipped) { skipped++; continue; }
      if (value.error) {
        errors++;
        if (errors <= 20) console.log(`  ✗ [${value.doc.id}] ${value.doc.title.substring(0, 30)}: ${value.error.substring(0, 60)}`);
        continue;
      }

      const { doc, pairs, tokens, docType } = value;
      totalTokens += tokens;
      typeQA[docType] = (typeQA[docType] || 0) + pairs.length;

      deleteByDoc.run(doc.id);
      const insertMany = db.transaction((items) => {
        for (const item of items) insertQA.run(doc.id, item.q, item.a, item.user_type || 'general');
      });
      insertMany(pairs);
      totalQA += pairs.length;
    }

    const done = Math.min(i + BATCH_SIZE, docs.length);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = done > 0 ? (done / elapsed * 60).toFixed(0) : '0';
    if (done % 100 === 0 || done === docs.length) {
      console.log(`[${elapsed}s] 进度: ${done}/${docs.length} (${(done/docs.length*100).toFixed(1)}%) | QA: ${totalQA} | 跳过: ${skipped} | 错误: ${errors} | 速度: ${rate}篇/min`);
    }

    if (i + BATCH_SIZE < docs.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  // 重建FTS索引
  console.log('\n重建FTS索引...');
  try {
    db.prepare('DELETE FROM knowledge_qa_fts').run();
    db.prepare(`INSERT INTO knowledge_qa_fts (qa_id, question, answer)
      SELECT id, question, answer FROM knowledge_qa`).run();
    console.log('FTS索引重建完成');
  } catch(e) {
    console.log('FTS索引重建失败:', e.message);
  }

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(0);
  const costYuan = (totalTokens * 0.000004).toFixed(2);
  console.log(`
===== 完成 =====
处理文档: ${docs.length - skipped}
跳过(元数据/太短): ${skipped}
生成QA对: ${totalQA}
各类型QA: ${JSON.stringify(typeQA)}
错误: ${errors}
总tokens: ${totalTokens.toLocaleString()}
预估费用: ¥${costYuan}
耗时: ${totalSec}秒
`);
})().catch(e => console.error('Fatal:', e.message));
