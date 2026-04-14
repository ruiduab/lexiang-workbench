/**
 * 联想官网真实API代理
 *
 * 代理以下联想公网API到后台使用:
 * - newsupport.lenovo.com.cn — 售后文章/驱动搜索 (无需认证)
 * - papi.lenovo.com.cn — 商品/库存/价格 (无需认证)
 * - i.lenovo.com.cn — 订单/会员/设备 (需Passport Cookie)
 */
const express = require('express');
const router = express.Router();
const https = require('https');

function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': `https://${urlObj.hostname}/`,
        ...(options.headers || {})
      }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ _raw: data, _status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function fetchRaw(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': `https://${urlObj.hostname}/`,
        ...(options.headers || {})
      }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ data, status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ====== 售后支持 (newsupport, 无需认证) ======

// GET /api/lenovo/support/articles — 最新售后文章
router.get('/support/articles', async (req, res) => {
  try {
    const data = await fetchJSON('https://newsupport.lenovo.com.cn/api/node/getnewarticles');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lenovo/support/drivers?keyword=ThinkPad — 驱动搜索
router.get('/support/drivers', async (req, res) => {
  const keyword = req.query.keyword || '';
  if (!keyword) return res.status(400).json({ error: 'keyword 参数必填' });
  try {
    const data = await fetchJSON(`https://newsupport.lenovo.com.cn/api/drive/drive_query?keyword=${encodeURIComponent(keyword)}`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lenovo/support/machine?categoryid=1 — 机型信息
router.get('/support/machine', async (req, res) => {
  const categoryid = req.query.categoryid || '';
  try {
    const data = await fetchJSON(`https://newsupport.lenovo.com.cn/api/node/getmachineinfo?categoryid=${encodeURIComponent(categoryid)}`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ====== 商品/价格/库存 (papi, 无需认证) ======

// GET /api/lenovo/product/:code — 商品详情+价格
router.get('/product/:code', async (req, res) => {
  try {
    const data = await fetchJSON(`https://papi.lenovo.com.cn/cache/detail?code=${encodeURIComponent(req.params.code)}`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/lenovo/stock — 库存查询
router.post('/stock', async (req, res) => {
  const { productCodes, address } = req.body;
  if (!productCodes || !productCodes.length) return res.status(400).json({ error: 'productCodes 必填' });
  try {
    const proInfos = productCodes.map(code => ({ activityType: 0, productCode: String(code), personalMake: false }));
    let url = 'https://papi.lenovo.com.cn/stock/getStockInfo.jhtm?ss=' + Date.now();
    let body = `proInfos=${encodeURIComponent(JSON.stringify(proInfos))}`;
    if (address) {
      url = 'https://papi.lenovo.com.cn/stock/getStockNew.jhtm?ss=' + Date.now();
      body += `&addrinfo=${encodeURIComponent(JSON.stringify(address))}`;
    }
    const data = await fetchJSON(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ====== 用户中心 (i.lenovo.com.cn, 需Passport Cookie) ======

// 通用代理: GET /api/lenovo/user/order/list — 代理到 i.lenovo.com.cn/api/order/list
// 需要在请求头或系统配置中提供 Lenovo Passport Cookie
router.get('/user/:a/:b', async (req, res) => {
  const path = req.params.a + '/' + req.params.b;
  const cookie = req.headers['x-lenovo-cookie'] || process.env.LENOVO_PASSPORT_COOKIE || '';
  if (!cookie) return res.status(401).json({ error: '需要联想Passport Cookie。在系统设置中配置或通过X-Lenovo-Cookie请求头传入。' });
  try {
    const result = await fetchRaw(`https://i.lenovo.com.cn/api/${path}`, {
      headers: { Cookie: cookie }
    });
    // 检查是否被重定向到登录页
    if (result.status === 302 || (result.data && result.data.includes('reg.lenovo.com.cn'))) {
      return res.status(401).json({ error: 'Cookie已过期，需要重新登录联想账号' });
    }
    try {
      res.json(JSON.parse(result.data));
    } catch {
      res.json({ _raw: result.data.slice(0, 500), _status: result.status });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
