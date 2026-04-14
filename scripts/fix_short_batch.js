// 方案B：批量修复短内容文档，直接用详情接口
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const db = require('../db/schema');

const THRESHOLD = 200;
const DELAY = 300;

async function fetchDetail(no) {
  try {
    const res = await fetch('https://iknow.lenovo.com.cn/knowledgeapi/api/knowledge/knowledgeDetails?knowledgeNo=' + no, { timeout: 10000 });
    const data = await res.json();
    return data.code === 200 ? data.data : null;
  } catch(e) { return null; }
}

function htmlToText(html) {
  if (!html) return '';
  const $ = cheerio.load(html);
  const alts = [];
  $('img').each(function(_, el) {
    const alt = $(el).attr('alt');
    if (alt && alt.trim()) {
      const desc = alt.trim().replace(/\.(jpg|jpeg|png|gif|webp|bmp)$/i, '').trim();
      if (desc.length > 1) alts.push('[图片: ' + desc + ']');
    }
  });
  return $.text().replace(/\s+/g, ' ').trim() + (alts.length ? '\n' + alts.join('\n') : '');
}

(async () => {
  const docs = db.prepare(
    "SELECT id, title, source_url, content FROM knowledge_docs WHERE length(content) < ? AND source_url LIKE '%iknow%' ORDER BY id"
  ).all(THRESHOLD);

  console.log('开始处理', docs.length, '篇文档...');
  let done = 0, improved = 0, skipped = 0, failed = 0;

  for (const doc of docs) {
    const match = doc.source_url && doc.source_url.match(/\/detail\/(\d+)/);
    if (!match) { skipped++; continue; }

    try {
      const detail = await fetchDetail(match[1]);
      if (!detail || !detail.content) { skipped++; continue; }

      const newText = htmlToText(detail.content);
      const keywords = detail.keyWords && detail.keyWords.length ? '关键词：' + detail.keyWords.join('、') : '';
      const lines = doc.content.split('\n').slice(0, 3).join('\n');
      const newContent = [lines, keywords, newText].filter(Boolean).join('\n');

      if (newContent.length > doc.content.length + 20) {
        db.prepare('UPDATE knowledge_docs SET content = ?, updated_at = ? WHERE id = ?')
          .run(newContent, new Date().toISOString().replace('T',' ').substring(0,19), doc.id);
        improved++;
      } else {
        skipped++;
      }
    } catch(e) {
      failed++;
    }

    done++;
    if (done % 100 === 0) {
      console.log('进度:', done + '/' + docs.length, '| 已提升:', improved, '| 跳过:', skipped, '| 失败:', failed);
    }
    await new Promise(r => setTimeout(r, DELAY));
  }

  console.log('\n完成！总计:', docs.length, '篇');
  console.log('内容提升:', improved, '篇');
  console.log('无变化跳过:', skipped, '篇');
  console.log('失败:', failed, '篇');
})().catch(e => console.error('Fatal:', e.message));
