const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { ingestText } = require('./ingest');

// Active crawl jobs: jobId -> { status, total, done, failed, logs, cancelled }
const jobs = {};

function createJob(jobId) {
  jobs[jobId] = { status: 'running', total: 0, done: 0, failed: 0, logs: [], cancelled: false };
  return jobs[jobId];
}

function getJob(jobId) {
  return jobs[jobId] || null;
}

function cancelJob(jobId) {
  if (jobs[jobId]) jobs[jobId].cancelled = true;
}

function log(job, msg) {
  job.logs.push({ time: new Date().toISOString(), msg });
  if (job.logs.length > 500) job.logs.shift();
}

function normalizeUrl(base, href) {
  try {
    const url = new URL(href, base);
    url.hash = '';
    // Remove trailing slash for dedup
    return url.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function isSameOrigin(root, url) {
  try {
    const r = new URL(root);
    const u = new URL(url);
    return u.hostname === r.hostname;
  } catch {
    return false;
  }
}

async function fetchPage(url) {
  const res = await fetch(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'LeAIBot/1.0 (knowledge crawler)',
      'Accept': 'text/html,application/xhtml+xml'
    }
  });
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return null;
  return res.text();
}

function extractLinks($, base) {
  const links = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    const url = normalizeUrl(base, href);
    if (url) links.add(url);
  });
  return [...links];
}

function extractText($, url) {
  $('script, style, nav, footer, header, aside, .nav, .footer, .header, .sidebar, .menu, .breadcrumb').remove();
  const title = $('title').text().trim() || $('h1').first().text().trim() || url;
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  return { title, text };
}

async function crawlSite(rootUrl, jobId, { maxPages = 0, concurrency = 3, sameOriginOnly = true } = {}) {
  // maxPages=0 means unlimited
  const job = createJob(jobId);
  log(job, `开始爬取: ${rootUrl}，${maxPages > 0 ? '最多 ' + maxPages + ' 页' : '不限页数'}`);

  const visited = new Set();
  const queue = [rootUrl];
  visited.add(normalizeUrl(rootUrl, rootUrl));

  async function processUrl(url) {
    if (job.cancelled) return;
    try {
      const html = await fetchPage(url);
      if (!html) { log(job, `跳过(非HTML): ${url}`); job.failed++; return; }

      const $ = cheerio.load(html);
      const { title, text } = extractText($, url);

      if (text.length > 50) {
        const result = await ingestText(text, title, { source_type: 'url', source_url: url });
        if (result.skipped) {
          log(job, `⏭️ 已入库跳过: ${title.slice(0, 50)}`);
        } else {
          job.done++;
          log(job, `✅ [${job.done}] ${title.slice(0, 50)}`);
        }
      } else {
        log(job, `跳过(内容太短): ${url}`);
        job.failed++;
      }

      // Extract and enqueue links
      const underLimit = maxPages <= 0 || visited.size < maxPages;
      if (underLimit) {
        const links = extractLinks($, url);
        for (const link of links) {
          if (visited.has(link)) continue;
          if (sameOriginOnly && !isSameOrigin(rootUrl, link)) continue;
          if (maxPages > 0 && visited.size >= maxPages) break;
          visited.add(link);
          queue.push(link);
          job.total = visited.size;
        }
      }
    } catch (err) {
      job.failed++;
      log(job, `❌ 失败: ${url} — ${err.message}`);
    }
  }

  job.total = 1;

  // Process queue with concurrency limit
  while (queue.length > 0 && !job.cancelled) {
    const batch = queue.splice(0, concurrency);
    await Promise.all(batch.map(processUrl));
    // Small throttle to avoid hammering the server
    await new Promise(r => setTimeout(r, 300));
  }

  job.status = job.cancelled ? 'cancelled' : 'done';
  log(job, `爬取完成：成功 ${job.done} 页，失败 ${job.failed} 页`);
}

module.exports = { crawlSite, getJob, cancelJob };
