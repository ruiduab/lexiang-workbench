#!/usr/bin/env python3
"""全量爬取 brand.lenovo.com.cn 文章：API列表 + SSR正文提取"""
import json, re, sqlite3, html, sys, time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

DB_PATH = '/root/lexiang/lexiang.db'
API_URL = 'https://s.lenovo.com.cn/search/brand?id=85&type=brand&curPage={page}&pageSize=48'
WORKERS = 10

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

def fetch_article_list():
    """通过API拉全量文章列表"""
    all_items = []
    page = 1
    while True:
        url = API_URL.format(page=page)
        req = urllib.request.Request(url, headers=HEADERS)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode('utf-8'))
        except Exception as e:
            print(f'  API第{page}页失败: {e}')
            break

        items = data.get('items', [])
        if not items:
            break

        all_items.extend(items)
        print(f'  API第{page}页: {len(items)}篇 (累计{len(all_items)})')
        page += 1
        time.sleep(0.3)

    return all_items


def extract_body(raw_html):
    """从HTML提取正文"""
    for pat in [
        r'class="center-content"[^>]*>([\s\S]*?)</div>\s*</div>\s*</div>',
        r'class="pcContent"[^>]*>([\s\S]*?)</div>\s*</div>',
        r'class="detail-content"[^>]*>([\s\S]*?)</div>\s*</div>',
    ]:
        m = re.search(pat, raw_html)
        if m:
            body = re.sub(r'<[^>]+>', '\n', m.group(1))
            body = re.sub(r'\n{3,}', '\n\n', body).strip()
            body = html.unescape(body)
            return body
    return ''


def fetch_article_content(item):
    """拉取单篇文章正文"""
    code = item.get('code', '')
    pc_url = item.get('pcUrl', '')
    if pc_url.startswith('//'):
        pc_url = 'https:' + pc_url
    title = item.get('title', '')
    intro = item.get('introduction', '')

    try:
        req = urllib.request.Request(pc_url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode('utf-8', errors='replace')
    except Exception as e:
        return {
            'code': code, 'title': title, 'url': pc_url,
            'content': f"{title}\n\n{intro}" if intro else title,
            'error': str(e)
        }

    body = extract_body(raw)

    parts = [title]
    if intro and intro != title:
        parts.append(intro)
    if body:
        parts.append(body)
    content = '\n\n'.join(parts)

    return {
        'code': code, 'title': title, 'url': pc_url,
        'content': content, 'body_len': len(body)
    }


def main():
    print('=== 全量爬取 brand.lenovo.com.cn ===\n')

    # 1. 拉API列表
    print('步骤1: 拉取文章列表...')
    items = fetch_article_list()
    print(f'共获取 {len(items)} 篇文章\n')

    if not items:
        print('没有获取到文章，退出')
        return

    # 2. 查已有
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    existing = {}
    for row in cur.execute("SELECT id, source_url, length(content) FROM knowledge_docs WHERE source_url LIKE '%brand.lenovo%'"):
        existing[row[1]] = (row[0], row[2])
        # 也存https版本
        url_https = row[1] if row[1].startswith('https:') else 'https:' + row[1].lstrip('https:')
        existing[url_https] = (row[0], row[2])

    print(f'数据库已有 {len(existing)//2} 条brand记录\n')

    # 3. 并发拉正文
    print('步骤2: 拉取正文...')
    results = []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(fetch_article_content, item): item for item in items}
        done = 0
        for fut in as_completed(futures):
            result = fut.result()
            results.append(result)
            done += 1
            if done % 100 == 0:
                print(f'  进度: {done}/{len(items)}')

    print(f'  完成: {len(results)}篇\n')

    # 4. 入库
    print('步骤3: 写入数据库...')
    new_count = 0
    update_count = 0
    skip_count = 0

    for r in results:
        url = r['url']
        title = r['title']
        content = r['content']
        code = r['code']

        if len(content.strip()) < 20:
            skip_count += 1
            continue

        # 检查是否已存在
        ex = existing.get(url)
        if ex:
            doc_id, old_len = ex
            # 只在新内容明显更长时更新
            if len(content) > old_len * 1.5:
                cur.execute("UPDATE knowledge_docs SET content = ?, title = ? WHERE id = ?",
                            (content, title, doc_id))
                update_count += 1
        else:
            cur.execute(
                "INSERT INTO knowledge_docs (title, filename, source_type, source_url, content) VALUES (?, ?, ?, ?, ?)",
                (title, f'brand-{code}', 'brand_news', url, content)
            )
            new_count += 1

    conn.commit()
    conn.close()

    # 统计正文长度分布
    body_lens = [r.get('body_len', 0) for r in results]
    has_body = sum(1 for b in body_lens if b > 100)
    errors = sum(1 for r in results if r.get('error'))

    print(f'\n=== 完成 ===')
    print(f'API总数: {len(items)}')
    print(f'新增: {new_count}')
    print(f'更新(正文变长): {update_count}')
    print(f'跳过(内容太短): {skip_count}')
    print(f'有正文(>100字): {has_body}')
    print(f'拉取出错: {errors}')


if __name__ == '__main__':
    main()
