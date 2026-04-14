// 从iknow知识库文档批量生成QA对（使用Claude API）
const fetch = require('node-fetch');
const db = require('better-sqlite3')('/root/lexiang/lexiang.db');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const API_URL = 'https://api.gptsapi.net/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';
const BATCH_SIZE = 5;  // 并发数
const DELAY_MS = 500;  // 批次间延迟

async function generateQA(doc) {
  const content = (doc.content || '').substring(0, 3000); // 限制长度控制成本
  if (content.length < 50) return null;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: 'user', content: `你是联想官方知识库助手。根据以下联想产品文档，生成用户可能提问的QA对。

文档标题：${doc.title}
文档内容：
${content}

要求：
1. 覆盖文档中【所有】知识点，不遗漏，条数不限
2. Q 必须具体，带上产品名称，不用"它/该设备/此功能"等模糊指代（不超过40字）
3. A 必须直接摘录原文，禁止改写或总结，保持原文措辞（不超过300字）
4. 每条标注 user_type：consumer / smb / enterprise / general
5. 严格按以下JSON格式输出，不要其他内容：

[
  {"q": "...", "a": "...", "user_type": "..."},
  ...
]` }]
    }),
    timeout: 120000
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

  const raw = data.content[0].text.trim();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('返回格式不对: ' + raw.substring(0, 100));

  const pairs = JSON.parse(match[0]);
  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;
  return { pairs, inputTokens, outputTokens };
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
  const insertQA = db.prepare(
    'INSERT INTO knowledge_qa (doc_id, question, answer, user_type) VALUES (?, ?, ?, ?)'
  );
  const deleteOld = db.prepare('DELETE FROM knowledge_qa WHERE doc_id = ?');

  // 获取所有还没生成QA的iknow文档
  const existingDocIds = new Set(
    db.prepare('SELECT DISTINCT doc_id FROM knowledge_qa').all().map(r => r.doc_id)
  );

  const allDocs = db.prepare(
    `SELECT id, title, source_url, content FROM knowledge_docs
     WHERE source_url LIKE '%iknow%' AND content IS NOT NULL AND content != ''
     ORDER BY id`
  ).all();

  const docs = allDocs.filter(d => !existingDocIds.has(d.id));
  console.log(`iknow文档总数: ${allDocs.length}, 已完成: ${existingDocIds.size}, 待处理: ${docs.length}`);

  let totalInput = 0, totalOutput = 0, totalQA = 0, errors = 0, skipped = 0;
  const startTime = Date.now();

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    const results = await processBatch(batch);

    for (const result of results) {
      const { value } = result;
      if (result.status === 'rejected' || !value) {
        errors++;
        continue;
      }
      if (value.skipped) { skipped++; continue; }
      if (value.error) {
        errors++;
        console.log(`  ✗ [${value.doc.id}] ${value.doc.title.substring(0, 30)}: ${value.error}`);
        continue;
      }

      const { doc, pairs, inputTokens, outputTokens } = value;
      totalInput += inputTokens;
      totalOutput += outputTokens;

      // 写数据库
      deleteOld.run(doc.id);
      const insertMany = db.transaction((items) => {
        for (const item of items) insertQA.run(doc.id, item.q, item.a, item.user_type || 'general');
      });
      insertMany(pairs);
      totalQA += pairs.length;
    }

    const done = Math.min(i + BATCH_SIZE, docs.length);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (done / elapsed * 60).toFixed(0);
    console.log(`[${elapsed}s] 进度: ${done}/${docs.length} (${(done/docs.length*100).toFixed(1)}%) | QA: ${totalQA} | 错误: ${errors} | 速度: ${rate}/min`);

    if (i + BATCH_SIZE < docs.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`
===== 完成 =====
处理文档: ${docs.length - skipped}
生成QA对: ${totalQA}
跳过(内容太短): ${skipped}
错误: ${errors}
输入tokens: ${totalInput.toLocaleString()}
输出tokens: ${totalOutput.toLocaleString()}
耗时: ${totalSec}秒
`);
})().catch(e => console.error('Fatal:', e.message));
