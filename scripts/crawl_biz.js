#!/usr/bin/env node
/**
 * biz.lenovo.com.cn 内容爬虫
 * 抓取客户案例、行业解决方案、通用方案等页面内容
 * 输出JSON供gen_wiki_full.py使用
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const URL_FILE = path.join(__dirname, 'biz_urls_clean.txt');
const OUT_FILE = path.join(__dirname, 'biz_content.json');
const CONCURRENCY = 5;
const DELAY = 200; // ms between batches

function fetch(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    }, timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // follow redirect
        const loc = res.headers.location.startsWith('http') ? res.headers.location : `https://biz.lenovo.com.cn${res.headers.location}`;
        fetch(loc).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function extractContent(html, url) {
  if (!html) return null;

  // 提取title
  const titleM = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  let title = titleM ? titleM[1].replace(/[-_|].*联想.*$/, '').replace(/[-_|].*Lenovo.*$/i, '').trim() : '';

  // 提取meta description
  const descM = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i) ||
                html.match(/<meta\s+content="([^"]+)"\s+name="description"/i);
  const metaDesc = descM ? descM[1].trim() : '';

  // 提取正文内容 - 多种策略
  let content = '';

  // 1. 尝试提取主要内容区域
  const contentPatterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<(?:div|footer|script)/i,
    /<div[^>]*class="[^"]*main[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<(?:div|footer|script)/i,
    /<div[^>]*class="[^"]*detail[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<(?:div|footer|script)/i,
  ];

  for (const pat of contentPatterns) {
    const m = html.match(pat);
    if (m && m[1].length > 100) {
      content = m[1];
      break;
    }
  }

  // 2. 如果没有匹配到，提取body中的所有文本
  if (!content) {
    const bodyM = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    content = bodyM ? bodyM[1] : html;
  }

  // 清理HTML标签，保留文本
  content = content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, '[$1]')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(h[1-6]|p|div|li|tr|td|th|section)[^>]*>/gi, '\n')
    .replace(/<\/?(ul|ol|table|thead|tbody)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  // 去掉常见的导航/页脚文本
  const removePatterns = [
    /惠采商城[\s\S]*?资料中心/g,
    /关于联想[\s\S]*?备案号/g,
    /京ICP备[\s\S]*$/g,
    /联想集团.*版权所有/g,
    /产品及方案.*直播/g,
  ];
  for (const p of removePatterns) {
    content = content.replace(p, '');
  }
  content = content.trim();

  // 内容太短跳过
  if (content.length < 50) return null;

  // 提取PDF下载链接
  const pdfLinks = html.match(/https?:\/\/[^"'\s]+\.pdf/g) || [];

  // 分类
  let category = 'biz-other';
  if (url.includes('/case/khal')) category = 'biz-case';
  else if (url.includes('/industries/')) category = 'biz-industry';
  else if (url.includes('/solution/')) category = 'biz-solution';
  else if (url.includes('/sol/')) category = 'biz-solution';
  else if (url.includes('/activity/')) category = 'biz-activity';
  else if (url.includes('/brand/')) category = 'biz-brand';
  else if (url.includes('/isg/')) category = 'biz-solution';
  else if (url.includes('/zh/ProductandServices/')) category = 'biz-solution';

  // 提取行业标签
  let industry = '';
  const indM = url.match(/\/industries\/(\w+)/);
  if (indM) {
    const indMap = {
      manufacturing: '制造业', education: '教育', government: '政务',
      medical: '医疗', finance: '金融', energy: '能源',
      traffic: '交通', service: '服务',
    };
    industry = indMap[indM[1]] || indM[1];
  }

  return {
    url,
    title: title || content.substring(0, 50),
    desc: metaDesc || content.substring(0, 150),
    content: content.substring(0, 5000), // 限制长度
    category,
    industry,
    pdfLinks: [...new Set(pdfLinks)],
  };
}

async function main() {
  const urls = fs.readFileSync(URL_FILE, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('https://'));

  console.log(`共 ${urls.length} 个URL待抓取`);

  const results = [];
  let done = 0;
  let errors = 0;

  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (url) => {
      try {
        const html = await fetch(url);
        if (!html) { errors++; return; }
        const data = extractContent(html, url);
        if (data) results.push(data);
        else errors++;
      } catch (e) {
        errors++;
      }
    });
    await Promise.all(promises);
    done += batch.length;
    if (done % 50 === 0 || done === urls.length) {
      console.log(`[${new Date().toTimeString().slice(0,8)}] 进度: ${done}/${urls.length} | 成功: ${results.length} | 错误: ${errors}`);
    }
    if (i + CONCURRENCY < urls.length) {
      await new Promise(r => setTimeout(r, DELAY));
    }
  }

  // 按分类统计
  const stats = {};
  for (const r of results) {
    stats[r.category] = (stats[r.category] || 0) + 1;
  }
  console.log('\n=== 抓取完成 ===');
  console.log('分类统计:', stats);
  console.log('总计:', results.length, '篇');

  fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2), 'utf8');
  console.log(`输出: ${OUT_FILE} (${(fs.statSync(OUT_FILE).size/1024/1024).toFixed(1)} MB)`);
}

main().catch(console.error);
