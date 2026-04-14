#!/usr/bin/env node
/**
 * biz.lenovo.com.cn 内容爬虫 (Playwright版)
 * 动态页面需要浏览器渲染后提取内容
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_FILE = path.join(__dirname, process.argv[2] || 'biz_urls_clean.txt');
const OUT_FILE = path.join(__dirname, process.argv[3] || 'biz_content.json');
const BATCH_SIZE = 2;
const PAGE_TIMEOUT = 30000;

async function extractPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
    // 等待内容加载
    await page.waitForTimeout(2000);

    const data = await page.evaluate((pageUrl) => {
      // 提取title
      let title = document.title.replace(/[-_|].*联想.*$/, '').replace(/[-_|].*Lenovo.*/i, '').trim();

      // 提取meta description
      const descEl = document.querySelector('meta[name="description"]');
      const metaDesc = descEl ? descEl.getAttribute('content') || '' : '';

      // 提取正文 - 优先使用精确选择器
      const contentSelectors = [
        '.content-outer-box',   // 案例页正文
        '.center-content',      // 案例页含标题+正文
        '.industry-resolveplan-20230919', // 行业页方案区
        '.card-wrap',           // 行业页卡片区
        '.card-inner-wrap',     // 行业页内容
        '#RichText',            // 品牌页富文本
        '.RichTextWrap',        // 品牌页富文本包裹
        '.left-txt-wb',         // 方案页概述文字
        '.info-box',            // 方案页标题+概述
        '.area1600',            // 方案页内容区域
        '.detail-content',      // 详情页
        '.article-content',     // 文章页
        '.main-content',        // 通用
      ];

      let content = '';
      for (const sel of contentSelectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText && el.innerText.trim().length > 50) {
          content = el.innerText.trim();
          break;
        }
      }

      // 纯图片营销页兜底：用meta信息代替
      if (!content || content.length < 50) {
        const keywords = document.querySelector('meta[name="keywords"]');
        const kw = keywords ? keywords.getAttribute('content') || '' : '';
        const parts = [title, metaDesc, kw ? '关键词：' + kw : ''].filter(Boolean);
        content = parts.join('\n\n');
      }

      // 清理格式
      content = content
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        .trim();

      // 去掉常见页脚/页头噪音（不用[\s\S]*，只删这一行）
      const noisePatterns = [
        /看完视频才发现，原来你是这样的联想！/g,
        /联想回归初心，从梦开始的地方，构筑更美好、更智慧的世界。/g,
        /2019年1月1日 10万\+/g,
        /联想集团.*版权所有.*/g,
        /京ICP备.*/g,
        /跨年钜惠.*大礼/g,
      ];
      for (const p of noisePatterns) {
        content = content.replace(p, '').trim();
      }

      // PDF链接
      const pdfLinks = [];
      document.querySelectorAll('a[href*=".pdf"], [data-href*=".pdf"]').forEach(el => {
        pdfLinks.push(el.href || el.getAttribute('data-href'));
      });
      // 也从innerHTML找
      const htmlPdfs = document.body.innerHTML.match(/https?:\/\/[^"'\s]+\.pdf/g) || [];
      pdfLinks.push(...htmlPdfs);

      return { title, metaDesc, content: content.substring(0, 8000), pdfLinks: [...new Set(pdfLinks)] };
    }, url);

    if (!data.content || data.content.length < 30) return null;

    // 分类
    let category = 'biz-other';
    if (url.includes('/case/khal')) category = 'biz-case';
    else if (url.includes('/industries/')) category = 'biz-industry';
    else if (url.includes('/solution/') || url.includes('/sol/')) category = 'biz-solution';
    else if (url.includes('/activity/')) category = 'biz-activity';
    else if (url.includes('/brand/')) category = 'biz-brand';
    else if (url.includes('/isg/') || url.includes('/zh/ProductandServices/')) category = 'biz-solution';

    // 行业标签
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
      title: data.title,
      desc: data.metaDesc || data.content.substring(0, 150),
      content: data.content,
      category,
      industry,
      pdfLinks: data.pdfLinks,
    };
  } catch (e) {
    console.error(`  ✗ ${url}: ${e.message.substring(0, 60)}`);
    return null;
  }
}

async function main() {
  const urls = fs.readFileSync(URL_FILE, 'utf8')
    .split('\n').map(l => l.trim()).filter(l => l.startsWith('https://'));

  console.log(`共 ${urls.length} 个URL待抓取 (Playwright)`);

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const results = [];
  let done = 0, errors = 0;

  // 用多个page并行
  const pages = await Promise.all(
    Array.from({ length: BATCH_SIZE }, () => browser.newPage())
  );

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (url, j) => {
      const pg = pages[j % pages.length];
      const data = await extractPage(pg, url);
      if (data) results.push(data);
      else errors++;
    });
    await Promise.all(promises);
    done += batch.length;
    if (done % 30 === 0 || done === urls.length) {
      console.log(`[${new Date().toTimeString().slice(0,8)}] 进度: ${done}/${urls.length} | 成功: ${results.length} | 错误: ${errors}`);
    }
  }

  await browser.close();

  // 统计
  const stats = {};
  for (const r of results) stats[r.category] = (stats[r.category] || 0) + 1;
  console.log('\n=== 抓取完成 ===');
  console.log('分类统计:', stats);
  console.log('总计:', results.length, '篇');

  // 内容质量统计
  const lens = results.map(r => r.content.length);
  console.log(`内容长度: min=${Math.min(...lens)} avg=${Math.round(lens.reduce((a,b)=>a+b,0)/lens.length)} max=${Math.max(...lens)}`);

  fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2), 'utf8');
  console.log(`输出: ${OUT_FILE} (${(fs.statSync(OUT_FILE).size/1024/1024).toFixed(1)} MB)`);
}

main().catch(console.error);
