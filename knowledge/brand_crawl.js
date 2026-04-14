/**
 * 联想品牌站爬取：brand.lenovo.com.cn / esg.lenovo.com.cn / partner.lenovo.com.cn
 * 策略：已知种子页 + 自动发现同域链接，提取 title + meta + 段落文本
 */
const fetch = require('node-fetch');
const { ingestText } = require('./ingest');

const DELAY = 600;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// 种子 URL（已验证可访问）
const SEEDS = [
  // --- brand.lenovo.com.cn ---
  'https://brand.lenovo.com.cn/',
  'https://brand.lenovo.com.cn/about/indroduction.html',
  'https://brand.lenovo.com.cn/about/managementInfo.html',
  'https://brand.lenovo.com.cn/new/brandnew.html',
  'https://brand.lenovo.com.cn/successcase/business-case.html',
  // --- esg.lenovo.com.cn ---
  'https://esg.lenovo.com.cn/',
  'https://esg.lenovo.com.cn/E/Environmental.html',
  'https://esg.lenovo.com.cn/G/Governance.html',
  'https://esg.lenovo.com.cn/G/businessethicsandintegrity.html',
  'https://esg.lenovo.com.cn/S/social.html',
  'https://esg.lenovo.com.cn/SocialValue/index.html',
  'https://esg.lenovo.com.cn/reports/index.html',
  'https://esg.lenovo.com.cn/rate/rating.html',
  // --- partner.lenovo.com.cn ---
  'https://partner.lenovo.com.cn/',
];

// 允许爬取的域名
const ALLOWED_DOMAINS = [
  'brand.lenovo.com.cn',
  'esg.lenovo.com.cn',
  'partner.lenovo.com.cn',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractLinks(html, baseHost) {
  const links = new Set();
  const re = /href="(https?:\/\/[^"?#]+\.html)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const u = new URL(m[1]);
      if (ALLOWED_DOMAINS.includes(u.hostname)) links.add(m[1]);
    } catch {}
  }
  return [...links];
}

function extractContent(html, url) {
  // title
  const titleM = html.match(/<title>([^<]+)<\/title>/);
  let title = (titleM ? titleM[1] : url).replace(/-?联想官网$/, '').replace(/^\s+|\s+$/g, '');

  // meta description
  const descM = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
  const desc = descM ? descM[1].trim() : '';

  // meta keywords
  const kwM = html.match(/<meta\s+name="[Kk]eywords"\s+content="([^"]+)"/i);
  const keywords = kwM ? kwM[1].trim() : '';

  // 正文段落（过滤掉模板占位符、账号协议等噪声）
  const rawParas = [];
  const paraRe = /<(?:p|h[1-4]|li)[^>]*>([^<]{15,600})<\/(?:p|h[1-4]|li)>/g;
  let pm;
  while ((pm = paraRe.exec(html)) !== null) {
    const t = pm[1].trim();
    // 过滤：模板变量、协议文本、太短
    if (t.includes('contentList') || t.includes('联想账户') || t.includes('本协议')) continue;
    if (t.includes('登录') && t.length < 20) continue;
    rawParas.push(t);
  }
  // 去重 + 取前30段
  const paras = [...new Set(rawParas)].slice(0, 30);

  let text = title + '\n';
  if (desc) text += '简介：' + desc + '\n';
  if (keywords) text += '关键词：' + keywords + '\n';
  if (paras.length > 0) text += '\n' + paras.join('\n');
  text += '\n来源：' + url;

  return { title, text };
}

async function crawlBrandSites() {
  const visited = new Set();
  const queue = [...SEEDS];
  let done = 0, skipped = 0, failed = 0;

  console.log('[BrandCrawl] 开始，种子页数:', SEEDS.length);

  while (queue.length > 0) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      const res = await fetch(url, { timeout: 15000, headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
      const html = await res.text();

      if (html.length < 3000) { skipped++; continue; }

      // 发现新链接加入队列
      const newLinks = extractLinks(html);
      for (const link of newLinks) {
        if (!visited.has(link)) queue.push(link);
      }

      const { title, text } = extractContent(html, url);
      if (text.length < 50) { skipped++; continue; }

      const result = await ingestText(text, title, { source_type: 'url', source_url: url });
      if (result.skipped) { skipped++; }
      else {
        done++;
        console.log(`[BrandCrawl] ✓ [${done}] ${title.slice(0, 50)}`);
      }
    } catch (e) {
      failed++;
      console.log(`[BrandCrawl] ✗ ${url}: ${e.message}`);
    }

    await sleep(DELAY);
  }

  console.log(`[BrandCrawl] 完成！入库 ${done}，跳过 ${skipped}，失败 ${failed}，共访问 ${visited.size} 页`);
  return { done, skipped, failed, total: visited.size };
}

module.exports = { crawlBrandSites };

// 直接运行
if (require.main === module) {
  crawlBrandSites().catch(e => console.error('FATAL:', e));
}
