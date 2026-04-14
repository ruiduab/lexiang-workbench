#!/usr/bin/env node
// 重新生成用户指南/手册类文档的QA对
// 仅处理已回填了下载链接的文档 + 原本answer质量差的文档
// 用法: node scripts/regen_qa_guides.js [--dry-run] [--limit N]

const fetch = require('node-fetch');
const db = require('better-sqlite3')('/root/lexiang/lexiang.db');

const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY;
const BATCH_SIZE = 10;
const DELAY_MS = 500;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const maxLimit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 0;

if (!DASHSCOPE_KEY) {
  // 从 .env 读取
  try {
    const envContent = require('fs').readFileSync('/root/lexiang/.env', 'utf8');
    const match = envContent.match(/DASHSCOPE_API_KEY=(.+)/);
    if (match) process.env.DASHSCOPE_API_KEY = match[1].trim();
  } catch (_) {}
}

const API_KEY = process.env.DASHSCOPE_API_KEY || DASHSCOPE_KEY;
if (!API_KEY) { console.error('需要 DASHSCOPE_API_KEY'); process.exit(1); }

function buildPrompt(doc) {
  const title = doc.title;
  const content = (doc.content || '').substring(0, 4000);
  const hasLink = /\[.*?\]\(http/.test(content);

  return `你是联想官方知识库助手。根据以下用户指南/手册文档生成QA对。

文档标题：${title}
文档内容：
${content}

文档类型：用户指南/手册类

Question模板：
1. 获取/下载型：「产品型号 + 如何获取/下载用户指南/手册」（${hasLink ? '必须生成此类型' : '可选'}）
2. 功能使用型：「产品型号 + 如何/怎么 + 功能名」
3. 规格查询型：「产品型号 + 支持/具备 + 规格项」
4. 操作前提型：「产品 + 操作前需要 + 什么条件」

Answer要求：
- 规格类 → 给出完整列表，不遗漏
- 操作类 → 步骤完整，包含前提条件和注意事项
- 如果指南适用多个型号，在Answer中列出全部适用型号
${hasLink ? '- 文档包含下载链接，Answer中必须保留完整的 [文件名](URL) 格式下载链接' : ''}
- 如果文档主要是下载链接没有其他实质内容，生成1-2条QA即可，不要硬凑

严格规则：
- Q 必须具体，带上产品名称
- Q 只问一件事
- A 必须从原文抽取关键信息，不能只给文档标题或分类标签
- A 脱离Q后仍然语义完整
- A 中禁止出现 uploadArr、fileSrc、fileType 等内部技术字段
- A 中禁止出现"分类:xxx"、"版本:xxx"等元数据标签
- 如果原文包含下载链接 [文件名](URL)，A 中必须原样保留完整链接
- 如果多个型号共用同一个答案，合并为一条Q

输出格式：严格JSON数组
[{"q": "...", "a": "...", "user_type": "consumer|smb|enterprise|general"}]`;
}

async function generateQA(doc) {
  const prompt = buildPrompt(doc);
  const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen-plus',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000
    })
  });
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';

  // 提取JSON
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const pairs = JSON.parse(jsonMatch[0]);
    return pairs.filter(p => {
      const q = p.q || '';
      const a = p.a || '';
      if (a.length < 15) return false;
      if (/uploadArr|fileSrc|fileType/.test(a)) return false;
      if (/^分类[:：]/.test(a) || /^版本[:：]/.test(a)) return false;
      return true;
    });
  } catch (_) {
    return [];
  }
}

async function main() {
  // 找出需要重新生成QA的文档：
  // 1. 用户指南/手册类
  // 2. 现有QA的answer质量差（只有文件名/标题信息，没有实质内容或链接）
  const condition = `
    (d.title LIKE '%用户指南%' OR d.title LIKE '%用户手册%' OR d.title LIKE '%使用说明%'
     OR d.title LIKE '%操作手册%' OR d.title LIKE '%设置指南%')
  `;
  const limitClause = maxLimit > 0 ? ` LIMIT ${maxLimit}` : '';

  // 查找：有现有QA但answer里没有链接，或者answer只是文档标题复读
  const docs = db.prepare(`
    SELECT DISTINCT d.id, d.title, d.content, d.source_url
    FROM knowledge_docs d
    LEFT JOIN knowledge_qa q ON q.doc_id = d.id
    WHERE ${condition}
      AND (
        -- 文档content现在包含链接但QA里没有
        (d.content LIKE '%](http%' AND (q.id IS NULL OR q.answer NOT LIKE '%](http%'))
        -- 或者QA answer质量差（只有文件名，没有实质内容）
        OR (q.answer LIKE '%文件名%' AND q.answer LIKE '%.pdf%' AND LENGTH(q.answer) < 200)
        -- 或者根本没有QA
        OR q.id IS NULL
      )
    ORDER BY d.id
    ${limitClause}
  `).all();

  console.log(`找到 ${docs.length} 篇需要重新生成QA的文档${dryRun ? '（dry-run模式）' : ''}`);

  let total = 0, generated = 0, failed = 0;
  const insertStmt = db.prepare('INSERT INTO knowledge_qa (doc_id, question, answer, user_type, source) VALUES (?, ?, ?, ?, ?)');
  const deleteStmt = db.prepare('DELETE FROM knowledge_qa WHERE doc_id = ?');

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (doc) => {
      try {
        const pairs = await generateQA(doc);
        if (pairs.length === 0) { failed++; return; }

        if (dryRun) {
          console.log(`\n--- [${doc.id}] ${doc.title} → ${pairs.length} 条QA ---`);
          pairs.forEach(p => {
            console.log(`  Q: ${p.q}`);
            console.log(`  A: ${p.a.substring(0, 120)}...`);
            const links = p.a.match(/\[.*?\]\(http[^)]+\)/g) || [];
            if (links.length) links.forEach(l => console.log(`  📎 ${l}`));
          });
        } else {
          // 删除旧QA，插入新QA
          deleteStmt.run(doc.id);
          for (const p of pairs) {
            insertStmt.run(doc.id, p.q, p.a, p.user_type || 'consumer', 'gen_qa_v2_links');
          }
        }

        total += pairs.length;
        generated++;
      } catch (err) {
        failed++;
        console.error(`❌ id=${doc.id}: ${err.message}`);
      }
    });

    await Promise.all(promises);
    console.log(`进度: ${Math.min(i + BATCH_SIZE, docs.length)}/${docs.length}, 已生成 ${total} 条QA`);
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`\n完成：处理 ${generated} 篇文档，生成 ${total} 条QA，失败 ${failed} 篇`);

  // 重建FTS索引
  if (!dryRun && generated > 0) {
    console.log('重建FTS索引...');
    try {
      db.exec('DELETE FROM knowledge_qa_fts');
      db.exec("INSERT INTO knowledge_qa_fts(rowid, question, answer) SELECT id, question, answer FROM knowledge_qa");
      console.log('FTS索引重建完成');
    } catch (e) {
      console.error('FTS重建失败:', e.message);
    }
  }

  db.close();
}

main().catch(console.error);
