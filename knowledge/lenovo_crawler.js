const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { ingestText } = require('./ingest');

const BASE_URL = 'https://iknow.lenovo.com.cn/knowledgeapi/api';
const PAGE_SIZE = 10; // smaller batches = less memory pressure

const jobs = {};

function createJob(jobId) {
  jobs[jobId] = { status: 'running', total: 0, done: 0, failed: 0, skipped: 0, logs: [], cancelled: false };
  return jobs[jobId];
}

function getJob(jobId) { return jobs[jobId] || null; }
function cancelJob(jobId) { if (jobs[jobId]) jobs[jobId].cancelled = true; }

function log(job, msg) {
  job.logs.push({ time: new Date().toISOString(), msg });
  if (job.logs.length > 300) job.logs.shift();
}

function cleanText(text) {
  // 过滤页码页脚（"第X页 共X页"）
  text = text.replace(/第\s*\d+\s*页\s*共\s*\d+\s*页/g, '');
  // 过滤目录行（"... 1" 或 "……1" 等纯目录索引行）
  text = text.replace(/^.{1,40}[.·…]{3,}\s*\d+\s*$/gm, '');
  // 过滤OCR说明性文字
  text = text.replace(/\[图片内容识别\]/g, '');
  text = text.replace(/以下是图片中[^。\n]{0,30}[。\n]/g, '');
  text = text.replace(/以上是图片中[^。\n]{0,30}[。\n]/g, '');
  text = text.replace(/以上为图片中[^。\n]{0,30}[。\n]/g, '');
  text = text.replace(/图片中[的所有]*可见文字[^。\n]{0,30}[：:\n]/g, '');
  text = text.replace(/图片中的文字如下[：:]/g, '');
  text = text.replace(/图片中所有可见文字总结[：:]?/g, '');
  // 清理多余空行
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

function htmlToText(html) {
  if (!html) return '';
  const $ = cheerio.load(html);

  // 将 <a> 标签转为 markdown 链接格式（保留下载链接）
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (href && text && /\.(pdf|doc|docx|xls|xlsx|zip|rar|exe|msi)(\?|$)/i.test(href)) {
      $(el).replaceWith(` [${text}](${href}) `);
    }
  });

  // 将 <img> 标签转为 markdown 图片格式
  const imgs = [];
  $('img').each((_, el) => {
    const src = $(el).attr('src');
    const alt = ($(el).attr('alt') || '').trim().replace(/\.(jpg|jpeg|png|gif|webp|bmp)$/i, '').trim();
    if (src) {
      const desc = alt.length > 1 ? alt : '图片';
      imgs.push(`![${desc}](${src})`);
      $(el).replaceWith(` ![${desc}](${src}) `);
    } else if (alt.length > 1) {
      imgs.push(`[图片: ${alt}]`);
    }
  });

  const raw = $.text().replace(/\s+/g, ' ').trim();
  const text = cleanText(raw);
  return text;
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

async function fetchPage(keyword, pageNo) {
  const url = `${BASE_URL}/knowledge/searchknowledgeList?keyword=${encodeURIComponent(keyword)}&pageNo=${pageNo}&pageSize=${PAGE_SIZE}`;
  const res = await fetch(url, { timeout: 15000, headers: { 'Accept': 'application/json' } });
  return res.json();
}

async function crawlLenovo(jobId, { keyword = ' ', maxArticles = 0 } = {}) {
  const job = createJob(jobId);
  log(job, `开始抓取联想知识库，关键词: "${keyword}"，${maxArticles > 0 ? '最多 ' + maxArticles + ' 篇' : '不限数量'}`);

  try {
    // First request to get total count
    const first = await fetchPage(keyword, 1);
    if (first.code !== 200) throw new Error('API返回错误: ' + first.msg);

    const total = parseInt(first.data.totalCount) || 0;
    const pageCount = parseInt(first.data.pageCount) || 0;
    const limit = maxArticles > 0 ? Math.min(maxArticles, total) : total;
    job.total = limit;
    log(job, `共找到 ${total} 篇文章，本次抓取 ${limit} 篇，共 ${pageCount} 页`);

    // Process first page
    await processArticles(job, first.data.knowledgeDTO || [], limit);

    // Process remaining pages
    const maxPage = maxArticles > 0 ? Math.ceil(maxArticles / PAGE_SIZE) : pageCount;
    for (let page = 2; page <= maxPage; page++) {
      if (job.cancelled) break;
      if (job.done + job.skipped >= limit) break;

      try {
        const data = await fetchPage(keyword, page);
        if (data.code !== 200) { log(job, `第${page}页请求失败`); continue; }
        await processArticles(job, data.data.knowledgeDTO || [], limit);
      } catch (err) {
        log(job, `❌ 第${page}页失败: ${err.message}`);
        job.failed++;
      }

      // Delay between pages to avoid rate limiting
      await new Promise(r => setTimeout(r, 1500));
    }
  } catch (err) {
    log(job, `❌ 致命错误: ${err.message}`);
  }

  job.status = job.cancelled ? 'cancelled' : 'done';
  log(job, `完成：入库 ${job.done} 篇，跳过(已有) ${job.skipped} 篇，失败 ${job.failed} 篇`);
}

async function processArticles(job, articles, limit) {
  for (const article of articles) {
    if (job.cancelled) break;
    if (job.done + job.skipped >= limit) break;

    try {
      const title = article.title || '无标题';
      const sourceUrl = `https://iknow.lenovo.com.cn/detail/${article.knowledgeNo}`;

      // 用详情接口获取完整内容（含图片alt文字）
      const detail = await fetchDetail(article.knowledgeNo);
      const contentHtml = (detail && detail.content) || article.content || article.digest || '';
      const text = htmlToText(contentHtml);
      // 补充关键词
      const keywords = detail?.keyWords?.length ? `关键词：${detail.keyWords.join('、')}` : '';

      // 提取产品名（优先用详情接口返回的字段）
      const productParts = [];
      const fp = detail?.firstProductName || article.firstProductName;
      const sp = detail?.subProductName || article.subProductName;
      if (fp && sp && fp !== sp) productParts.push(`${fp} ${sp}`);
      else if (fp) productParts.push(fp);
      else if (sp) productParts.push(sp);
      const productLine = productParts.length ? `适用产品：${productParts.join('、')}` : '';

      // Add metadata to text for better search
      const fullText = [
        title,
        productLine,
        article.lineCategoryName ? `分类：${article.lineCategoryName}` : '',
        article.questionCategoryName ? `问题类型：${article.questionCategoryName}` : '',
        keywords,
        text
      ].filter(Boolean).join('\n');

      if (fullText.length < 10) { job.failed++; return; }

      const result = await ingestText(fullText, title, { source_type: 'url', source_url: sourceUrl });
      if (result.skipped) {
        job.skipped++;
        if (job.skipped % 50 === 0) log(job, `⏭️ 已跳过 ${job.skipped} 篇(已入库)`);
      } else {
        job.done++;
        if (job.done % 50 === 0) log(job, `✅ 已入库 ${job.done} 篇...`);
      }
    } catch (err) {
      job.failed++;
      log(job, `❌ 文章处理失败: ${err.message}`);
    }
  }
}

// 修复存量短内容文档：对 content 长度 < threshold 的文档重新拉详情接口更新
async function fixShortDocs(jobId, { threshold = 200, limit = 0 } = {}) {
  const db = require('../db/schema');
  const job = createJob(jobId);

  const where = limit > 0 ? `WHERE length(content) < ? ORDER BY id LIMIT ?` : `WHERE length(content) < ? ORDER BY id`;
  const params = limit > 0 ? [threshold, limit] : [threshold];
  const docs = db.prepare(`SELECT id, title, source_url, content FROM knowledge_docs ${where}`).all(...params);

  job.total = docs.length;
  log(job, `找到 ${docs.length} 篇短内容文档（<${threshold}字），开始补充...`);

  for (const doc of docs) {
    if (job.cancelled) break;
    try {
      // 从 source_url 提取 knowledgeNo
      const match = doc.source_url?.match(/\/detail\/(\d+)/);
      if (!match) { job.skipped++; continue; }
      const knowledgeNo = match[1];

      const detail = await fetchDetail(knowledgeNo);
      if (!detail || !detail.content) { job.skipped++; continue; }

      const newText = htmlToText(detail.content);
      const keywords = detail.keyWords?.length ? `关键词：${detail.keyWords.join('、')}` : '';
      const productParts = [];
      const fp = detail.firstProductName;
      const sp = detail.subProductName;
      if (fp && sp && fp !== sp) productParts.push(`${fp} ${sp}`);
      else if (fp) productParts.push(fp);
      else if (sp) productParts.push(sp);
      const productLine = productParts.length ? `适用产品：${productParts.join('、')}` : '';
      // 保留原有首行（标题+分类），替换正文
      const lines = doc.content.split('\n');
      const meta = lines.slice(0, 3).join('\n'); // 保留标题/分类/问题类型行
      const newContent = [meta, productLine, keywords, newText].filter(Boolean).join('\n');

      if (newContent.length <= doc.content.length + 20) { job.skipped++; continue; } // 没有提升就跳过

      db.prepare('UPDATE knowledge_docs SET content = ?, updated_at = ? WHERE id = ?')
        .run(newContent, new Date().toISOString().replace('T', ' ').substring(0, 19), doc.id);

      job.done++;
      if (job.done % 50 === 0) log(job, `✅ 已补充 ${job.done} 篇...`);
    } catch (err) {
      job.failed++;
      log(job, `❌ 处理失败 id=${doc.id}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 300)); // 限速
  }

  job.status = job.cancelled ? 'cancelled' : 'done';
  log(job, `完成：补充 ${job.done} 篇，无变化跳过 ${job.skipped} 篇，失败 ${job.failed} 篇`);
}

module.exports = { crawlLenovo, fixShortDocs, getJob: (id) => jobs[id] || null, cancelJob };
