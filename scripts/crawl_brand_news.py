#!/usr/bin/env python3
"""扫描 brand.lenovo.com.cn/brand/ppnXXXXX.html 编号范围，拉取新闻入库"""
import json, re, sqlite3, html, sys, os
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

DB_PATH = '/root/lexiang/lexiang.db'
START = 1
END = 3740
WORKERS = 20

def fetch_page(code_num):
    code = f'ppn{code_num:05d}'
    url = f'https://brand.lenovo.com.cn/brand/{code}.html'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.getcode() != 200:
                return None
            raw = resp.read().decode('utf-8', errors='replace')
    except:
        return None

    # title
    m = re.search(r'<title>([^<]*)</title>', raw)
    title = html.unescape(m.group(1).replace('-联想官网', '').strip()) if m else ''
    if not title:
        return None

    # og:description
    m = re.search(r'<meta\s+(?:property="og:description"|name="description")\s+content="([^"]*)"', raw)
    og_desc = html.unescape(m.group(1)) if m else ''

    # 正文提取
    body = ''
    for pat in [r'class="detail-content"[^>]*>([\s\S]*?)</div>\s*</div>',
                r'class="article-content"[^>]*>([\s\S]*?)</div>',
                r'class="con-wapper"[^>]*>([\s\S]*?)</div>',
                r'class="news-detail"[^>]*>([\s\S]*?)</div>']:
        m = re.search(pat, raw)
        if m:
            body = m.group(1)
            break
    body = re.sub(r'<[^>]+>', '\n', body)
    body = re.sub(r'\n{3,}', '\n\n', body).strip()
    body = html.unescape(body)

    # 合成
    parts = [title]
    if og_desc and og_desc != title:
        parts.append(og_desc)
    if body:
        parts.append(body)
    content = '\n\n'.join(parts)

    if len(content.strip()) < 20:
        return None

    return {
        'title': title,
        'filename': f'brand-PPN{code_num:05d}',
        'source_url': url,
        'content': content,
    }

def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    existing = set()
    for row in cur.execute("SELECT source_url FROM knowledge_docs WHERE source_url LIKE '%brand.lenovo%'"):
        existing.add(row[0])
    # 也检查小写变体
    for row in cur.execute("SELECT source_url FROM knowledge_docs WHERE source_url LIKE '%brand.lenovo%'"):
        existing.add(row[0].lower())
    print(f'已有 {len(existing)} 条 brand URL')

    total_new = 0
    found = 0

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {}
        for num in range(START, END + 1):
            futures[pool.submit(fetch_page, num)] = num

        batch = []
        for fut in as_completed(futures):
            result = fut.result()
            if result is None:
                continue
            found += 1
            if result['source_url'].lower() in existing:
                continue
            batch.append(result)
            total_new += 1

            if total_new % 50 == 0:
                print(f'  扫描中… 发现 {found} 篇，新增 {total_new} 篇')

    # 批量写入
    for item in batch:
        cur.execute(
            "INSERT INTO knowledge_docs (title, filename, source_type, source_url, content) VALUES (?, ?, ?, ?, ?)",
            (item['title'], item['filename'], 'brand_news', item['source_url'], item['content'])
        )

    conn.commit()
    conn.close()
    print(f'\n完成：扫描 {START}-{END}，发现 {found} 篇有效页面，新增 {total_new} 篇')

if __name__ == '__main__':
    main()
