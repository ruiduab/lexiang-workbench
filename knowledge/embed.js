/**
 * DashScope text-embedding-v3 API wrapper
 * 512维向量，批量请求（最多25条/次）
 */
const https = require('https');

const API_KEY = process.env.DASHSCOPE_API_KEY || '';
const DIMENSION = 512;
const BATCH_SIZE = 10; // DashScope text-embedding-v3 单次最多10条

function callEmbedAPI(texts) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'text-embedding-v3',
      input: { texts },
      parameters: { dimension: DIMENSION }
    });
    const req = https.request({
      hostname: 'dashscope.aliyuncs.com',
      path: '/api/v1/services/embeddings/text-embedding/text-embedding',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.output && j.output.embeddings) {
            resolve(j.output.embeddings.map(e => e.embedding));
          } else {
            reject(new Error('API error: ' + JSON.stringify(j)));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * 对文本数组批量生成向量，自动分批
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function embedTexts(texts) {
  const results = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const vecs = await callEmbedAPI(batch);
    results.push(...vecs);
  }
  return results;
}

/**
 * 对单条文本生成向量
 */
async function embedOne(text) {
  const vecs = await callEmbedAPI([text]);
  return vecs[0];
}

module.exports = { embedTexts, embedOne, DIMENSION };
