#!/usr/bin/env python3
"""用 curl/SSR 批量提取 brand.lenovo.com.cn 文章完整正文，更新 knowledge_docs"""
import sqlite3, re, html, sys, time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

DB_PATH = '/root/lexiang/lexiang.db'
WORKERS = 10
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}


def clean_body(text):
    """清洗正文：去掉重复标题、日期、浏览/分享等页面元数据"""
    lines = text.split('\n')
    cleaned = []
    for line in lines:
        s = line.strip()
        if not s:
            if cleaned and cleaned[-1] != '':
                cleaned.append('')
            continue
        if re.match(r'^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$', s):
            continue
        if s in ('浏览', '分享', '0', '分享到微信朋友圈'):
            continue
        if re.match(r'^浏览\s*\d*$', s) or re.match(r'^分享\s*\d*$', s):
            continue
        cleaned.append(s)
    text = '\n'.join(cleaned).strip()
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text


def extract_body(raw_html, title=''):
    """从HTML提取正文"""
    for pat in [
        r'class="center-content"[^>]*>([\s\S]*?)</div>\s*</div>\s*</div>',
        r'class="pcContent"[^>]*>([\s\S]*?)</div>\s*</div>',
        r'class="detail-content"[^>]*>([\s\S]*?)</div>\s*</div>',
    ]:
        m = re.search(pat, raw_html)
        if m:
            frag = m.group(1)
            frag = re.sub(r'<br\s*/?\s*>', '\n', frag, flags=re.IGNORECASE)
            frag = re.sub(r'</(p|div|h[1-6]|li|tr|blockquote|section|article|header|footer)>', '\n', frag, flags=re.IGNORECASE)
            frag = re.sub(r'<(p|div|h[1-6]|li|tr|blockquote|section|article|header|footer)\b[^>]*>', '\n', frag, flags=re.IGNORECASE)
            frag = re.sub(r'<[^>]+>', '', frag)
            body = re.sub(r'\n{3,}', '\n\n', frag).strip()
            body = html.unescape(body)
            body = clean_body(body)
            if title:
                while body.startswith(title):
                    body = body[len(title):].lstrip('\n').strip()
            return body
    return ''


def fetch_and_extract(row):
    """拉取单篇文章正文"""
    doc_id, title, source_url, old_len = row
    try:
        req = urllib.request.Request(source_url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode('utf-8', errors='replace')
    except Exception as e:
        return doc_id, None, str(e)

    m = re.search(r'<title>([^<]*)</title>', raw)
    page_title = html.unescape(m.group(1).replace('-联想官网', '').strip()) if m else title

    body = extract_body(raw, title=page_title or title)
    if len(body) < 50:
        return doc_id, None, 'body_too_short'

    new_content = f"{page_title}\n\n{body}" if page_title else body
    return doc_id, new_content, None


def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    rows = cur.execute("""
        SELECT id, title, source_url, length(content) as clen
        FROM knowledge_docs
        WHERE source_url LIKE '%brand.lenovo%'
        ORDER BY id
    """).fetchall()

    print(f'需要补充正文: {len(rows)} 篇')
    if not rows:
        print('没有需要补充的文章')
        conn.close()
        return

    updated = 0
    errors = 0
    short = 0

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(fetch_and_extract, row): row for row in rows}
        done = 0
        for fut in as_completed(futures):
            doc_id, new_content, err = fut.result()
            done += 1

            if err:
                if err == 'body_too_short':
                    short += 1
                else:
                    errors += 1
                if done % 100 == 0:
                    print(f'  进度: {done}/{len(rows)} | 更新:{updated} 短:{short} 错:{errors}')
                continue

            cur.execute("UPDATE knowledge_docs SET content = ? WHERE id = ?",
                        (new_content, doc_id))
            updated += 1

            if done % 100 == 0:
                conn.commit()
                print(f'  进度: {done}/{len(rows)} | 更新:{updated} 短:{short} 错:{errors}')

    conn.commit()
    conn.close()
    print(f'\n完成: 共{len(rows)}篇, 更新{updated}篇, 正文太短{short}篇, 出错{errors}篇')


if __name__ == '__main__':
    main()
