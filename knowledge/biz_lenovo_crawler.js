const fetch = require('node-fetch');
const { ingestText } = require('./ingest');

const SEED_URLS = [
  'https://biz.lenovo.com.cn/product/0120203040806.html', // 产品页（含全导航）
  'https://biz.lenovo.com.cn/industries/education/smartclassroom.html', // 方案页
];

const DOMAIN = 'biz.lenovo.com.cn';
const DELAY = 500; // ms between requests

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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 从 HTML 提取所有 biz.lenovo.com.cn 的内部链接
function extractLinks(html) {
  const links = new Set();
  const re = /href="(https?:\/\/biz\.lenovo\.com\.cn\/[^"?#]+\.html)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1];
    // 只要产品页、方案/行业页、活动页，排除登录/购物车等
    if (/\/(product|industries|solution|activity|czxt)\//.test(url)) {
      links.add(url);
    }
  }
  return [...links];
}

// 从页面提取内容
function extractContent(html, url) {
  // title
  const titleM = html.match(/<title>([^<]+)<\/title>/);
  const title = titleM ? titleM[1].replace(/_联想政教及大企业官网$/, '').replace(/_价格_资料$/, '').trim() : url;

  // meta description
  const descM = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
  const desc = descM ? descM[1].trim() : '';

  // meta keywords
  const kwM = html.match(/<meta\s+name="[Kk]eywords"\s+content="([^"]+)"/i);
  const keywords = kwM ? kwM[1].trim() : '';

  // 从 SEO JSON 数据提取（biz.lenovo 有嵌入的 JSON）
  const seoM = html.match(/"seoDescriptions":"([^"]+)"/);
  const seoDesc = seoM ? seoM[1] : '';

  const categoryM = html.match(/"categoryName":"([^"]+)"/);
  const categoryName = categoryM ? categoryM[1] : '';

  // 组合成文本内容
  let text = `${title}\n`;
  if (categoryName && categoryName !== title) text += `产品/方案名称：${categoryName}\n`;
  if (desc) text += `简介：${desc}\n`;
  if (seoDesc && seoDesc !== desc) text += `详情：${seoDesc}\n`;
  if (keywords) text += `关键词：${keywords}\n`;
  text += `来源：${url}`;

  return { title, text };
}

async function crawlBizLenovo(jobId, { maxPages = 0 } = {}) {
  const job = createJob(jobId);
  log(job, `开始收集 biz.lenovo.com.cn 页面链接...`);

  try {
    // Step 1: 从种子页面收集所有链接
    const allLinks = new Set();
    for (const seed of SEED_URLS) {
      try {
        const res = await fetch(seed, {
          timeout: 20000,
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }
        });
        const html = await res.text();
        const links = extractLinks(html);
        links.forEach(l => allLinks.add(l));
        log(job, `种子页 ${seed} 找到 ${links.length} 个链接`);
      } catch (e) {
        log(job, `种子页获取失败: ${e.message}`);
      }
      await sleep(DELAY);
    }

    let urls = [...allLinks];
    if (maxPages > 0) urls = urls.slice(0, maxPages);
    job.total = urls.length;
    log(job, `共收集到 ${urls.length} 个页面，开始抓取内容...`);

    // Step 2: 抓取每个页面
    for (let i = 0; i < urls.length; i++) {
      if (job.cancelled) {
        log(job, '已取消');
        break;
      }

      const url = urls[i];
      try {
        const res = await fetch(url, {
          timeout: 15000,
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }
        });
        const html = await res.text();

        if (html.length < 5000) {
          job.skipped++;
          continue;
        }

        const { title, text } = extractContent(html, url);

        if (!text || text.length < 30) {
          job.skipped++;
          continue;
        }

        const result = await ingestText(text, title, { source_type: 'url', source_url: url });
        if (result.skipped) {
          job.skipped++;
        } else {
          job.done++;
          if (job.done % 50 === 0) log(job, `进度: ${i + 1}/${urls.length}，入库 ${job.done}`);
        }
      } catch (e) {
        job.failed++;
        if (job.failed % 20 === 0) log(job, `失败 ${job.failed} 次，最后错误: ${e.message}`);
      }

      await sleep(DELAY);
    }

    job.status = 'done';
    log(job, `完成！入库 ${job.done}，跳过 ${job.skipped}，失败 ${job.failed}`);
  } catch (e) {
    job.status = 'error';
    log(job, `严重错误: ${e.message}`);
  }
}

module.exports = { crawlBizLenovo, getJob, cancelJob };
