'use strict';

/**
 * L1.4 信息密度优化模块
 * 对 RAG hits 做去重 + 清洗 + 截断，在注入 prompt 前减少冗余 token
 *
 * 1. 去重：内容重叠度 > 60% 的 chunk 只保留得分最高的一个
 * 2. 清洗：去掉低密度内容（版权声明、纯数字行、导航链接等）
 * 3. 截断：每个 chunk 最多保留前 600 字
 */

const OVERLAP_THRESHOLD = 0.6;  // 重叠度阈值
const MAX_CHUNK_CHARS = 600;    // 每个 chunk 最大字符数
const NGRAM_SIZE = 4;           // n-gram 大小

/**
 * 计算两段文本的字符 n-gram 重叠率
 * @param {string} a
 * @param {string} b
 * @returns {number} 0-1 的相似度
 */
function contentOverlap(a, b) {
  if (!a || !b) return 0;

  // 去掉空白后再算
  const cleanA = a.replace(/\s+/g, '');
  const cleanB = b.replace(/\s+/g, '');

  if (cleanA.length < NGRAM_SIZE || cleanB.length < NGRAM_SIZE) {
    // 太短，直接用包含关系判断
    const shorter = cleanA.length <= cleanB.length ? cleanA : cleanB;
    const longer  = cleanA.length <= cleanB.length ? cleanB : cleanA;
    return longer.includes(shorter) ? 1 : 0;
  }

  // 生成 n-gram 集合
  function ngrams(str) {
    const set = new Set();
    for (let i = 0; i <= str.length - NGRAM_SIZE; i++) {
      set.add(str.slice(i, i + NGRAM_SIZE));
    }
    return set;
  }

  const setA = ngrams(cleanA);
  const setB = ngrams(cleanB);

  let intersection = 0;
  for (const g of setA) {
    if (setB.has(g)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 清洗单个 chunk 的内容：去低密度行
 * @param {string} text
 * @returns {string}
 */
function cleanContent(text) {
  if (!text) return text;

  const lines = text.split('\n');
  const cleaned = [];
  let consecutiveLowDensity = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // 去掉版权/隐私/Cookie 相关行
    if (/版权所有|Copyright|隐私政策|Cookie|cookie/.test(line)) {
      consecutiveLowDensity++;
      continue;
    }

    // 去掉少于 5 个字的行（导航链接、空行等）
    if (line.length < 5) {
      consecutiveLowDensity++;
      continue;
    }

    // 去掉纯数字/符号行（如 "123"、"---"、"==="）
    if (/^[\d\s\-=_|*#·•◦▸▪\[\]()]+$/.test(line)) {
      consecutiveLowDensity++;
      continue;
    }

    // 连续3行以上低密度内容，把已计的都跳过（上面已 continue）
    // 这里只需重置计数
    consecutiveLowDensity = 0;
    cleaned.push(rawLine); // 保留原始缩进
  }

  return cleaned.join('\n').trim();
}

/**
 * 对 RAG hits 做信息密度优化
 * @param {Array<{chunk_id, content, score, ...}>} hits
 * @returns {Array} 处理后的 hits（至少保留1条）
 */
function deduplicateAndClean(hits) {
  if (!hits || hits.length === 0) return hits;

  // 步骤1：去重（按分数降序，贪心保留）
  // 先排序（得分高的优先保留）
  const sorted = [...hits].sort((a, b) => (b.score || 0) - (a.score || 0));
  const kept = [];

  for (const hit of sorted) {
    const content = hit.content || '';
    let isDup = false;

    for (const prev of kept) {
      const overlap = contentOverlap(content, prev.content || '');
      if (overlap > OVERLAP_THRESHOLD) {
        isDup = true;
        break;
      }
    }

    if (!isDup) {
      kept.push(hit);
    }
  }

  // 保证至少1条
  const deduped = kept.length > 0 ? kept : [sorted[0]];

  // 步骤2：清洗 + 截断，返回时按原始顺序（保持检索排序语义）
  // 建立 chunk_id → 处理后内容 的映射
  const processedMap = new Map();
  for (const hit of deduped) {
    const cleaned = cleanContent(hit.content || '');
    const truncated = cleaned.length > MAX_CHUNK_CHARS
      ? cleaned.slice(0, MAX_CHUNK_CHARS)
      : cleaned;
    processedMap.set(hit.chunk_id, truncated);
  }

  // 按原始 hits 顺序重组（deduped 已改变顺序，恢复原始顺序中被保留的）
  const dedupedIds = new Set(deduped.map(h => h.chunk_id));
  const result = hits
    .filter(h => dedupedIds.has(h.chunk_id))
    .map(h => ({
      ...h,
      content: processedMap.get(h.chunk_id) ?? h.content,
    }));

  return result.length > 0 ? result : [hits[0]];
}

module.exports = { deduplicateAndClean, contentOverlap, cleanContent };

// ── 自测（node knowledge/deduplicator.js 直接运行）──
if (require.main === module) {
  // 测试1：重叠度计算
  const s1 = 'ThinkPad X1 Carbon 是联想旗舰商务本，重量不足1.1kg';
  const s2 = 'ThinkPad X1 Carbon 是联想旗舰商务本，重量不足1.1kg，续航强劲';
  const s3 = '小米手机发布会宣布新品上市';
  console.log('重叠(高):', contentOverlap(s1, s2).toFixed(3), '期望 > 0.6');
  console.log('重叠(低):', contentOverlap(s1, s3).toFixed(3), '期望 < 0.2');

  // 测试2：去重
  const hits = [
    { chunk_id: 'a', content: s1, score: 0.9 },
    { chunk_id: 'b', content: s2, score: 0.7 },  // 与 a 高度重叠，应被去掉
    { chunk_id: 'c', content: s3, score: 0.5 },
  ];
  const result = deduplicateAndClean(hits);
  console.log('去重后数量:', result.length, '期望 2（a+c，b被去除）');
  console.log('保留的 ids:', result.map(h => h.chunk_id).join(','));

  // 测试3：清洗
  const dirty = `ThinkPad X1 Carbon 详情
版权所有 联想集团
123
这是一段正常的产品描述文字，包含有用信息。
隐私政策
ok`;
  const cleaned = cleanContent(dirty);
  console.log('清洗后:\n', cleaned);
  console.log('版权行已去除:', !cleaned.includes('版权所有'));
  console.log('短行已去除:', !cleaned.includes('\nok'));

  // 测试4：截断
  const longHit = [{ chunk_id: 'x', content: 'a'.repeat(1000), score: 1 }];
  const truncResult = deduplicateAndClean(longHit);
  console.log('截断后长度:', truncResult[0].content.length, '期望 600');
}
