// Skill: 网络搜索（联想实时资讯）
// 优先使用 Bing Search API，若无 key 则降级到 DuckDuckGo

const https = require('https');

function bingSearch(query) {
  return new Promise((resolve) => {
    const key = process.env.BING_SEARCH_KEY;
    if (!key) return resolve(null); // 无 key，降级
    const req = https.request({
      hostname: 'api.bing.microsoft.com',
      path: '/v7.0/search?q=' + encodeURIComponent(query) + '&mkt=zh-CN&count=5&freshness=Month',
      method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': key }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const results = (j.webPages?.value || []).slice(0, 5).map(r => ({
            title: r.name,
            snippet: r.snippet,
            url: r.url
          }));
          resolve(results.length > 0 ? results : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function ddgSearch(query) {
  return new Promise((resolve) => {
    const postData = `q=${encodeURIComponent(query)}`;
    const req = https.request({
      hostname: 'html.duckduckgo.com',
      path: '/html/',
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const results = [];
          // 按 result 块切分，逐块提取
          const blocks = data.split(/class="result\s/g).slice(1); // 跳过第一段非结果内容
          for (const block of blocks) {
            if (results.length >= 5) break;
            // 提取URL
            const urlM = block.match(/class="result__a"[^>]*href="([^"]*)"/);
            if (!urlM) continue;
            let url = urlM[1];
            const uddgM = url.match(/uddg=(https?[^&]*)/);
            if (uddgM) url = decodeURIComponent(uddgM[1]);
            if (url.includes('bing.com/aclick')) continue;
            // 提取标题
            const titleM = block.match(/class="result__a"[^>]*>([^<]*)</);
            const title = titleM ? titleM[1].trim() : '';
            // 提取摘要
            const snippetM = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
            const snippet = snippetM ? snippetM[1].replace(/<[^>]*>/g, '').trim() : '';
            if (title && url) results.push({ title, snippet, url });
          }
          resolve(results);
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(10000, () => { req.destroy(); resolve([]); });
    req.write(postData);
    req.end();
  });
}

module.exports = {
  name: 'web_search',
  description: '搜索互联网获取联想相关的最新新闻、公告、产品发布等实时信息。仅在知识库无法回答且需要最新信息时使用。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词，建议加"联想"前缀' }
    },
    required: ['query']
  },
  execute: async ({ query }) => {
    // 优先 Bing，降级 DuckDuckGo
    const bingResults = await bingSearch(query);
    if (bingResults) return { found: true, results: bingResults, source: 'bing' };

    const ddgResults = await ddgSearch(query);
    if (ddgResults.length > 0) return { found: true, results: ddgResults, source: 'duckduckgo', note: '数据来自DuckDuckGo，仅供参考' };

    return { found: false, message: '搜索暂时不可用' };
  }
};
