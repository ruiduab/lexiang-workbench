#!/usr/bin/env node
// 回填下载链接 + 图片URL
// 针对用户指南/手册类短内容文档，重新fetch原始HTML，用新的htmlToText保留链接
// 用法: node scripts/backfill_links.js [--dry-run] [--limit N] [--all]
//   --all: 处理所有短内容文档（不限于用户指南类）
//   --dry-run: 只打印不更新
//   --limit N: 最多处理N篇

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const db = require('better-sqlite3')('/root/lexiang/lexiang.db');

const BASE_URL = 'https://iknow.lenovo.com.cn/knowledgeapi/api';
const DELAY_MS = 300;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const processAll = args.includes('--all');
const limitIdx = args.indexOf('--limit');
const maxLimit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 0;

// 复制自 lenovo_crawler.js 的 cleanText
function cleanText(text) {
  text = text.replace(/第\s*\d+\s*页\s*共\s*\d+\s*页/g, '');
  text = text.replace(/^.{1,40}[.·…]{3,}\s*\d+\s*$/gm, '');
  text = text.replace(/\[图片内容识别\]/g, '');
  text = text.replace(/以下是图片中[^。\n]{0,30}[。\n]/g, '');
  text = text.replace(/以上是图片中[^。\n]{0,30}[。\n]/g, '');
  text = text.replace(/以上为图片中[^。\n]{0,30}[。\n]/g, '');
  text = text.replace(/图片中[的所有]*可见文字[^。\n]{0,30}[：:\n]/g, '');
  text = text.replace(/图片中的文字如下[：:]/g, '');
  text = text.replace(/图片中所有可见文字总结[：:]?/g, '');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

// 新版 htmlToText，保留 <a> 和 <img> 的链接
function htmlToText(html) {
  if (!html) return '';
  const $ = cheerio.load(html);

  // 将 <a> 标签转为 markdown 链接格式（保留下载链接）
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (href && text && /\.(pdf|doc|docx|xls|xlsx|zip|rar|exe|msi)(\?|&|$)/i.test(href)) {
      $(el).replaceWith(` [${text}](${href}) `);
    }
  });

  // 将 <img> 标签转为 markdown 图片格式
  $('img').each((_, el) => {
    const src = $(el).attr('src');
    const alt = ($(el).attr('alt') || '').trim().replace(/\.(jpg|jpeg|png|gif|webp|bmp)$/i, '').trim();
    if (src) {
      const desc = alt.length > 1 ? alt : '图片';
      $(el).replaceWith(` ![${desc}](${src}) `);
    }
  });

  const raw = $.text().replace(/\s+/g, ' ').trim();
  return cleanText(raw);
}

async function fetchDetail(knowledgeNo) {
  const url = `${BASE_URL}/knowledge/knowledgeDetails?knowledgeNo=${knowledgeNo}`;
  try {
    const res = await fetch(url, { timeout: 10000, headers: { 'Accept': 'application/json' } });
    const data = await res.json();
    if (data.code === 200 && data.data) return data.data;
  } catch (_) {}
  return null;
}

async function main() {
  // 查找需要回填的文档
  let condition;
  if (processAll) {
    condition = `LENGTH(content) < 500`;
  } else {
    condition = `(title LIKE '%用户指南%' OR title LIKE '%用户手册%' OR title LIKE '%使用说明%' OR title LIKE '%操作手册%' OR title LIKE '%设置指南%') AND LENGTH(content) < 500`;
  }
  const limitClause = maxLimit > 0 ? ` LIMIT ${maxLimit}` : '';
  const docs = db.prepare(`SELECT id, title, source_url, content FROM knowledge_docs WHERE ${condition} ORDER BY id${limitClause}`).all();

  console.log(`找到 ${docs.length} 篇待回填文档${dryRun ? '（dry-run模式）' : ''}`);

  let updated = 0, skipped = 0, failed = 0, linkFound = 0;

  for (const doc of docs) {
    try {
      const match = doc.source_url?.match(/\/detail\/(\d+)/);
      if (!match) { skipped++; continue; }

      const detail = await fetchDetail(match[1]);
      if (!detail || !detail.content) { skipped++; continue; }

      const newText = htmlToText(detail.content);
      const hasLink = /\[.*?\]\(http/.test(newText);

      // 组装新content
      const lines = doc.content.split('\n');
      const meta = lines.slice(0, 4).join('\n'); // 保留标题/分类/问题类型/关键词行
      const keywords = detail.keyWords?.length ? `关键词：${detail.keyWords.join('、')}` : '';
      const newContent = [meta, keywords, newText].filter(Boolean).join('\n');

      // 去重：如果新内容没有增加有意义的信息就跳过
      if (!hasLink && newContent.length <= doc.content.length + 30) { skipped++; continue; }

      if (hasLink) linkFound++;

      if (dryRun) {
        console.log(`\n--- [${doc.id}] ${doc.title} ---`);
        console.log(`  原长度: ${doc.content.length}, 新长度: ${newContent.length}, 含链接: ${hasLink}`);
        if (hasLink) {
          const links = newText.match(/\[.*?\]\(http[^)]+\)/g) || [];
          links.forEach(l => console.log(`  链接: ${l}`));
        }
      } else {
        db.prepare('UPDATE knowledge_docs SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(newContent, doc.id);
      }
      updated++;

      if (updated % 100 === 0) console.log(`进度: ${updated}/${docs.length}`);
    } catch (err) {
      failed++;
      console.error(`❌ id=${doc.id} ${doc.title}: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`\n完成：更新 ${updated} 篇，含下载链接 ${linkFound} 篇，跳过 ${skipped} 篇，失败 ${failed} 篇`);
  db.close();
}

main().catch(console.error);
