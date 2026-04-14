/**
 * 联想新闻爬虫：抓取联想官方新闻 + 行业新闻
 * 来源：
 *   1. news.lenovo.com.cn — 联想新闻中心
 *   2. brand.lenovo.com.cn/new/ — 品牌新闻
 *   3. biz.lenovo.com.cn 活动/新闻页
 */
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { ingestText } = require('./ingest');

const DELAY = 800;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 联想新闻中心
const NEWS_SEEDS = [
  'https://news.lenovo.com.cn/',
  'https://news.lenovo.com.cn/products/',
  'https://news.lenovo.com.cn/company/',
  'https://news.lenovo.com.cn/csr/',
  'https://news.lenovo.com.cn/events/',
];

// 品牌新闻
const BRAND_NEWS_SEEDS = [
  'https://brand.lenovo.com.cn/new/brandnew.html',
  'https://brand.lenovo.com.cn/new/industrynew.html',
];

function extractLinks(html, domain) {
  const links = new Set();
  const $ = cheerio.load(html);
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const u = new URL(href, `https://${domain}`);
      if (u.hostname === domain && u.pathname.length > 3 && !u.pathname.includes('login')) {
        links.add(u.origin + u.pathname);
      }
    } catch {}
  });
  return [...links];
}

function extractArticle(html, url) {
  const $ = cheerio.load(html);

  // 标题
  let title = $('h1').first().text().trim()
    || $('title').text().replace(/[-_|].*$/, '').trim()
    || '';

  if (!title || title.length < 4) return null;

  // 正文
  const contentSelectors = [
    '.article-content', '.news-content', '.content-detail',
    '.post-content', '.main-content', 'article',
    '.text-content', '#content',
  ];

  let body = '';
  for (const sel of contentSelectors) {
    const el = $(sel);
    if (el.length && el.text().trim().length > 100) {
      body = el.text().trim();
      break;
    }
  }

  // fallback: 提取所有 p 标签
  if (!body || body.length < 100) {
    const paras = [];
    $('p').each((_, el) => {
      const t = $(el).text().trim();
      if (t.length > 20 && t.length < 2000) paras.push(t);
    });
    body = paras.join('\n');
  }

  if (!body || body.length < 50) return null;

  // 日期
  const dateM = html.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
  const date = dateM ? dateM[1] : '';

  // 清理
  body = body
    .replace(/\s+/g, ' ')
    .replace(/分享到[:：].*$/m, '')
    .replace(/相关推荐.*$/s, '')
    .slice(0, 5000);

  let text = `${title}\n`;
  if (date) text += `发布日期：${date}\n`;
  text += `\n${body}\n\n来源：${url}`;

  return { title, text, date };
}

async function crawlNews() {
  const visited = new Set();
  let ingested = 0, skipped = 0, failed = 0;

  console.log('[NewsCrawl] 开始联想新闻爬取...');

  // 1. 新闻中心
  for (const seed of NEWS_SEEDS) {
    try {
      const res = await fetch(seed, { timeout: 15000, headers: { 'User-Agent': UA } });
      const html = await res.text();
      const links = extractLinks(html, 'news.lenovo.com.cn');

      for (const link of links) {
        if (visited.has(link)) continue;
        visited.add(link);

        try {
          const r2 = await fetch(link, { timeout: 15000, headers: { 'User-Agent': UA } });
          const h2 = await r2.text();
          const article = extractArticle(h2, link);

          if (!article) { skipped++; continue; }

          const result = await ingestText(article.text, article.title, {
            source_type: 'url',
            source_url: link,
          });

          if (result.skipped) { skipped++; }
          else { ingested++; console.log(`[NewsCrawl] ✓ [${ingested}] ${article.title.slice(0, 50)}`); }
        } catch (e) { failed++; }

        await sleep(DELAY);
      }
    } catch (e) {
      console.log(`[NewsCrawl] 种子页失败 ${seed}: ${e.message}`);
    }
    await sleep(DELAY);
  }

  // 2. 品牌新闻
  for (const seed of BRAND_NEWS_SEEDS) {
    try {
      const res = await fetch(seed, { timeout: 15000, headers: { 'User-Agent': UA } });
      const html = await res.text();
      const links = extractLinks(html, 'brand.lenovo.com.cn')
        .filter(l => l.includes('/new/') || l.includes('/news/'));

      for (const link of links) {
        if (visited.has(link)) continue;
        visited.add(link);

        try {
          const r2 = await fetch(link, { timeout: 15000, headers: { 'User-Agent': UA } });
          const h2 = await r2.text();
          const article = extractArticle(h2, link);

          if (!article) { skipped++; continue; }

          const result = await ingestText(article.text, article.title, {
            source_type: 'url',
            source_url: link,
          });

          if (result.skipped) { skipped++; }
          else { ingested++; console.log(`[NewsCrawl] ✓ [${ingested}] ${article.title.slice(0, 50)}`); }
        } catch (e) { failed++; }

        await sleep(DELAY);
      }
    } catch (e) {
      console.log(`[NewsCrawl] 品牌新闻种子失败: ${e.message}`);
    }
    await sleep(DELAY);
  }

  console.log(`[NewsCrawl] 完成！入库 ${ingested}，跳过 ${skipped}，失败 ${failed}，访问 ${visited.size} 页`);
  return { ingested, skipped, failed, total: visited.size };
}

module.exports = { crawlNews };

if (require.main === module) {
  crawlNews().catch(e => console.error('FATAL:', e));
}
