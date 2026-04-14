// 从知识库文档生成QA对，输出JSON文件
const fetch = require('node-fetch');
const fs = require('fs');
const db = require('better-sqlite3')('/root/lexiang/lexiang.db');

const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY;
const TEST_IDS = [5735, 12097, 16002];
const OUTPUT_DIR = '/var/www/leaibot/files';

async function generateQA(doc) {
  const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + DASHSCOPE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen-plus',
      messages: [{ role: 'user', content: `你是联想官方知识库助手。根据以下联想产品文档，生成用户可能提问的QA对。

文档标题：${doc.title}
文档内容：
${doc.content}

要求：
1. 覆盖文档中【所有】知识点，不遗漏，条数不限
2. Q 必须具体，带上产品名称，不用"它/该设备/此功能"等模糊指代，反映用户真实场景提问（不超过40字）
3. A 必须直接摘录原文，禁止改写或总结，保持原文措辞，可以是原文的一句话或连续几句话，不超过300字
4. 每条标注 user_type：consumer（普通消费者）/ smb（中小企业）/ enterprise（政企）/ general（通用）
5. 严格按以下JSON格式输出，不要其他内容：

[
  {"q": "...", "a": "...", "user_type": "..."},
  ...
]` }],
      max_tokens: 4000
    }),
    timeout: 60000
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const raw = data.choices[0].message.content.trim();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('返回格式不对: ' + raw.substring(0, 100));
  return { pairs: JSON.parse(match[0]), tokens: data.usage.total_tokens };
}

(async () => {
  const insertQA = db.prepare(
    'INSERT INTO knowledge_qa (doc_id, question, answer, user_type) VALUES (?, ?, ?, ?)'
  );
  const deleteOld = db.prepare('DELETE FROM knowledge_qa WHERE doc_id = ?');

  const docs = db.prepare(
    `SELECT id, title, source_url, content FROM knowledge_docs WHERE id IN (${TEST_IDS.join(',')})`
  ).all();

  let totalTokens = 0;

  for (const doc of docs) {
    console.log(`\n=== [${doc.id}] ${doc.title} ===`);
    try {
      const { pairs, tokens } = await generateQA(doc);
      totalTokens += tokens;

      // 写数据库
      deleteOld.run(doc.id);
      const insertMany = db.transaction((items) => {
        for (const item of items) insertQA.run(doc.id, item.q, item.a, item.user_type || 'general');
      });
      insertMany(pairs);

      // 输出JSON文件
      const output = {
        doc_id: doc.id,
        title: doc.title,
        source_url: doc.source_url,
        generated_at: new Date().toISOString(),
        qa: pairs
      };
      const outPath = `${OUTPUT_DIR}/qa_${doc.id}.json`;
      fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

      console.log(`  生成 ${pairs.length} 条QA，消耗 ${tokens} tokens → qa_${doc.id}.json`);
      pairs.forEach(p => {
        console.log(`  [${p.user_type}] Q: ${p.q}`);
        console.log(`         A: ${p.a.substring(0, 80)}${p.a.length > 80 ? '...' : ''}`);
      });
    } catch(e) {
      console.log('  ✗ 失败:', e.message);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n=== 完成 | 总消耗: ${totalTokens} tokens ≈ ${(totalTokens * 0.000004).toFixed(4)} 元 ===`);
})().catch(e => console.error('Fatal:', e.message));
