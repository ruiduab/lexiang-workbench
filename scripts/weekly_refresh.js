#!/usr/bin/env node
/**
 * 知识库每周自动刷新脚本
 * 重跑联想各站点爬虫 + 新闻爬虫 + 增量向量化 + 自动重新生成wiki
 * cron: 0 3 * * 0 (每周日凌晨3点)
 */
const path = require('path');
const { execSync } = require('child_process');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const LOG = s => console.log(`[${new Date().toISOString()}] ${s}`);

async function run() {
  LOG('=== 联想知识库每周刷新开始 ===');

  // 1. iknow 知识库
  LOG('Step 1/6: 爬取 iknow.lenovo.com.cn...');
  try {
    const { crawlLenovo } = require('../knowledge/lenovo_crawler');
    const jobId = 'weekly_iknow_' + Date.now();
    await crawlLenovo(jobId, { keyword: ' ', maxArticles: 0 });
    LOG('iknow 完成');
  } catch (e) { LOG('iknow 爬虫失败: ' + e.message); }

  // 2. 企业/政教站
  LOG('Step 2/6: 爬取 biz.lenovo.com.cn...');
  try {
    const { crawlBizLenovo } = require('../knowledge/biz_lenovo_crawler');
    const jobId = 'weekly_biz_' + Date.now();
    await crawlBizLenovo(jobId);
    LOG('biz 完成');
  } catch (e) { LOG('biz 爬虫失败: ' + e.message); }

  // 3. 品牌/ESG/合作伙伴
  LOG('Step 3/6: 爬取 brand/esg/partner.lenovo.com.cn...');
  try {
    const { crawlBrandSites } = require('../knowledge/brand_crawl');
    const r = await crawlBrandSites();
    LOG(`brand 完成：入库 ${r.done || r.ingested || 0}`);
  } catch (e) { LOG('brand 爬虫失败: ' + e.message); }

  // 4. 新闻爬虫（新增）
  LOG('Step 4/6: 爬取联想新闻...');
  try {
    const { crawlNews } = require('../knowledge/news_crawler');
    const r = await crawlNews();
    LOG(`新闻 完成：入库 ${r.ingested}，跳过 ${r.skipped}`);
  } catch (e) { LOG('新闻爬虫失败: ' + e.message); }

  // 5. 增量向量化
  LOG('Step 5/6: 增量向量化...');
  try {
    const { buildVectors } = require('../knowledge/build_vectors');
    const r = await buildVectors();
    LOG(`向量化完成：成功 ${r.done}，失败 ${r.failed}`);
  } catch (e) { LOG('向量化失败: ' + e.message); }

  // 6. 重新生成 wiki 页面
  LOG('Step 6/6: 重新生成 wiki 页面...');
  try {
    execSync('python3 /root/lexiang/scripts/gen_wiki_full.py 2>&1', {
      timeout: 600000,
      encoding: 'utf-8',
      cwd: '/root/lexiang',
    });
    LOG('wiki 生成完成');
  } catch (e) {
    LOG('wiki 生成失败: ' + (e.stderr || e.message).slice(0, 200));
  }

  LOG('=== 刷新完成 ===');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
