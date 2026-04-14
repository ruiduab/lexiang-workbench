#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
联想乐享WIKI批量生成脚本
生成产品页 + 知识文章页，并更新 index.html
"""

import openpyxl
import json
import os
import re
import html
import urllib.parse
from collections import defaultdict

LEAI_BASE = 'https://leai.lenovo.com.cn/?pmf_group=zwtg&pmf_medium=leaiwiki&pmf_source=Z00617767T000&input='

def leai_btn(input_text):
    url = LEAI_BASE + urllib.parse.quote(input_text, safe='')
    return f'<a class="leai-btn" href="{url}" target="_blank" rel="nofollow">在乐享AI咨询 →</a>'

# ─── 配置 ─────────────────────────────────────────────────────────────────────

EXCEL_PATH = '/root/downloads/agent_agent_item_profile_base_info_v2_20260319.xlsx'
WIKI_DIR   = '/var/www/leaibot/lenovo/wiki'
BASE_URL   = 'https://leaibot.cn/lenovo/wiki'
PUB_DATE   = '2026-03-20'

REPLACE_MAP = [
    ('ThinkPad', 'thinkpad'), ('ThinkStation', 'thinkstation'),
    ('YOGA', 'yoga'), ('Legion', 'legion'), ('IdeaPad', 'ideapad'),
    ('小新', 'xiaoxin'), ('拯救者', 'legion'), ('联想', 'lenovo'),
    ('昭阳', 'zhaoyang'), ('扬天', 'yangtian'), ('开天', 'kaitian'),
    ('英特尔', 'intel'), ('酷睿', ''), ('锐龙', 'amd'),
    ('版', ''), ('款', ''), ('英寸', ''), ('轻薄笔记本电脑', ''),
    ('笔记本电脑', ''), ('笔记本', ''), ('电脑', ''),
    ('高性能', ''), ('工程师本', ''), ('商务本', ''), ('游戏本', ''),
    ('深空灰', ''), ('钛晶灰', ''), ('月光银', ''), ('绒黑', ''),
    ('星云灰', ''), ('云帆白', ''), ('深海蓝', ''), ('摩卡棕', ''),
    ('标压', ''), ('低压', ''), ('旗舰', ''), ('创意本', ''),
    ('全能本', ''), ('超轻薄', ''), ('轻薄', ''),
]

CAT_THEMES = {
    'thinkpad':     {'tag': 'background:var(--blue-l);color:var(--blue)', 'intro': 'background:linear-gradient(135deg,#e8f0fb 0%,#c5d8f5 100%)', 'label': 'ThinkPad', 'nav_cat': 'ThinkPad', 'cat_key': 'thinkpad'},
    'lenovo':       {'tag': 'background:#fff7e6;color:#d46b08;border:1px solid #ffd591', 'intro': 'background:linear-gradient(135deg,#fff7e6 0%,#ffe7ba 100%)', 'label': '小新/YOGA', 'nav_cat': 'IdeaPad', 'cat_key': 'lenovo'},
    'legion':       {'tag': 'background:#f9f0ff;color:#722ed1;border:1px solid #d3adf7', 'intro': 'background:linear-gradient(135deg,#f9f0ff 0%,#efdbff 100%)', 'label': '拯救者', 'nav_cat': 'Legion 拯救者', 'cat_key': 'legion'},
    'thinkstation': {'tag': 'background:#f0f5ff;color:#2f54eb;border:1px solid #adc6ff', 'intro': 'background:linear-gradient(135deg,#f0f5ff 0%,#d6e4ff 100%)', 'label': 'ThinkStation', 'nav_cat': 'ThinkPad', 'cat_key': 'thinkpad'},
    'kaitian':      {'tag': 'background:#e6fffb;color:#08979c;border:1px solid #87e8de', 'intro': 'background:linear-gradient(135deg,#e6fffb 0%,#b5f5ec 100%)', 'label': '开天', 'nav_cat': 'ThinkPad', 'cat_key': 'thinkpad'},
    'zhaoyang':     {'tag': 'background:var(--blue-l);color:var(--blue)', 'intro': 'background:linear-gradient(135deg,#e8f0fb 0%,#c5d8f5 100%)', 'label': '昭阳', 'nav_cat': 'ThinkPad', 'cat_key': 'thinkpad'},
    'yangtian':     {'tag': 'background:#f6ffed;color:#389e0d;border:1px solid #b7eb8f', 'intro': 'background:linear-gradient(135deg,#f6ffed 0%,#d9f7be 100%)', 'label': '扬天', 'nav_cat': '联想软件', 'cat_key': 'thinkpad'},
    'moto':         {'tag': 'background:#fff0f6;color:#c41d7f;border:1px solid #ffadd2', 'intro': 'background:linear-gradient(135deg,#fff0f6 0%,#ffd6e7 100%)', 'label': 'Moto', 'nav_cat': 'IdeaPad', 'cat_key': 'lenovo'},
    'default':      {'tag': 'background:var(--blue-l);color:var(--blue)', 'intro': 'background:linear-gradient(135deg,#e8f0fb 0%,#c5d8f5 100%)', 'label': '联想', 'nav_cat': '精选商品', 'cat_key': 'lenovo'},
}

# ─── slug生成 ─────────────────────────────────────────────────────────────────

def make_slug(name, prod_id):
    s = name
    for zh, en in REPLACE_MAP:
        s = s.replace(zh, en)
    # 只保留英文/数字/空格/连字符
    s = re.sub(r'[^\w\s-]', ' ', s, flags=re.ASCII)
    s = s.lower().strip()
    s = re.sub(r'[\s_]+', '-', s)
    s = re.sub(r'-+', '-', s)
    s = s.strip('-')
    # 加ID后4位保证唯一
    suffix = str(prod_id)[-4:]
    if not s:
        s = 'lenovo-product'
    return f"{s}-{suffix}"


def get_theme(lvl2_cat):
    """根据lvl2分类名推断主题key"""
    c = (lvl2_cat or '').lower()
    if 'thinkstation' in c:
        return 'thinkstation'
    if 'thinkpad' in c or 'think' in c:
        return 'thinkpad'
    if 'legion' in c or '拯救者' in c:
        return 'legion'
    if '开天' in c:
        return 'kaitian'
    if '昭阳' in c:
        return 'zhaoyang'
    if '扬天' in c:
        return 'yangtian'
    if 'moto' in c:
        return 'moto'
    if 'lenovo' in c:
        return 'lenovo'
    return 'default'


def get_emoji(theme_key):
    m = {'thinkpad': '💼', 'thinkstation': '🖥️', 'legion': '🎮',
         'kaitian': '🖥️', 'zhaoyang': '💼', 'yangtian': '💻',
         'moto': '📱', 'lenovo': '💻', 'default': '💻'}
    return m.get(theme_key, '💻')


def js_escape(s):
    """转义JS字符串中的特殊字符"""
    return s.replace('\\', '\\\\').replace("'", "\\'").replace('\n', ' ').replace('\r', '')


def safe_str(v):
    if v is None:
        return ''
    return str(v).strip()


def parse_json_field(v):
    """解析JSON字段，返回列表"""
    if not v:
        return []
    s = safe_str(v)
    try:
        result = json.loads(s)
        if isinstance(result, list):
            return result
        return []
    except Exception:
        return []


def esc(s):
    """HTML转义"""
    return html.escape(safe_str(s))


def esc_attr(s):
    """HTML属性转义"""
    return html.escape(safe_str(s), quote=True)


def summary_sentences(summary_text, n=2):
    """取summary前n句话"""
    text = safe_str(summary_text)
    # 按句号/！/？分割
    parts = re.split(r'[。！？!?]', text)
    parts = [p.strip() for p in parts if p.strip()]
    return '。'.join(parts[:n]) + '。' if parts else text[:120]


def format_price(price_val):
    try:
        p = float(price_val)
        if p > 0:
            return p
    except Exception:
        pass
    return None


def spec_row(label, value):
    v = safe_str(value)
    if not v:
        return ''
    return f'<tr><th>{esc(label)}</th><td>{esc(v)}</td></tr>\n'


def build_faq_json(name, cpu, memory, disk, target_users, price):
    name_e = name.replace('"', '\\"')
    cpu_e = safe_str(cpu).replace('"', '\\"')
    mem_e = safe_str(memory).replace('"', '\\"')
    disk_e = safe_str(disk).replace('"', '\\"')
    users_str = '、'.join(target_users[:3]) if target_users else '商务办公和日常使用用户'
    price_str = f'¥{price:,.0f}' if price else '请参考官方最新报价'

    faq = [
        {
            "@type": "Question",
            "name": f"{name_e} 的核心配置参数是什么？",
            "acceptedAnswer": {
                "@type": "Answer",
                "text": f"{name_e} 搭载 {cpu_e} 处理器，内存 {mem_e}，存储 {disk_e}。详细规格请参考本页规格参数表。"
            }
        },
        {
            "@type": "Question",
            "name": f"{name_e} 适合哪类用户？",
            "acceptedAnswer": {
                "@type": "Answer",
                "text": f"{name_e} 主要面向{users_str}。无论是日常办公、出差携带还是专业创作，都能提供稳定可靠的性能表现。"
            }
        },
        {
            "@type": "Question",
            "name": f"{name_e} 的价格是多少，在哪里购买？",
            "acceptedAnswer": {
                "@type": "Answer",
                "text": f"{name_e} 官方参考价格为 {price_str}。建议通过联想官网、联想乐享商城或授权经销商购买，以获得完整保修服务。"
            }
        }
    ]
    return json.dumps(faq, ensure_ascii=False)


def generate_product_page(row, related_rows, theme_key, slug):
    """生成单个产品页HTML"""
    prod_id  = safe_str(row[0])
    name     = safe_str(row[1])
    gbrief   = safe_str(row[3])
    color    = safe_str(row[6])
    baseprice = format_price(row[8])
    init_price = format_price(row[18])
    price = baseprice or init_price
    poi_list    = parse_json_field(row[24])
    summary     = safe_str(row[25])
    target_users = parse_json_field(row[26])
    lvl2_cat    = safe_str(row[42])
    weight      = safe_str(row[49])
    warranty    = safe_str(row[50])
    os_val      = safe_str(row[55])
    memory      = safe_str(row[57])
    disk        = safe_str(row[62])
    cpu         = safe_str(row[68])
    gpu         = safe_str(row[79])
    screen_size = safe_str(row[85])
    screen_res  = safe_str(row[89])
    port        = safe_str(row[96])
    power       = safe_str(row[99])
    wireless    = safe_str(row[106])

    theme = CAT_THEMES.get(theme_key, CAT_THEMES['default'])
    tag_style   = theme['tag']
    intro_bg    = theme['intro']
    cat_label   = theme['label']
    cat_key     = theme['cat_key']
    nav_cat     = theme['nav_cat']
    emoji       = get_emoji(theme_key)

    # 描述
    desc = gbrief if gbrief else summary_sentences(summary, 2)
    desc_short = desc[:120]
    intro_text = gbrief if gbrief else summary_sentences(summary, 2)

    # 价格徽章
    price_badge = ''
    if price:
        price_badge = f'<span style="color:#d46b08;font-weight:700;">¥{price:,.0f}</span>'

    # 规格表
    spec_rows = ''
    spec_rows += spec_row('处理器', cpu)
    spec_rows += spec_row('内存', memory)
    spec_rows += spec_row('存储', disk)
    spec_rows += spec_row('显卡', gpu)
    spec_rows += spec_row('屏幕尺寸', screen_size)
    spec_rows += spec_row('屏幕分辨率', screen_res)
    spec_rows += spec_row('操作系统', os_val)
    spec_rows += spec_row('重量', weight)
    spec_rows += spec_row('电源适配器', power)
    spec_rows += spec_row('无线网卡', wireless)
    spec_rows += spec_row('接口', port)
    spec_rows += spec_row('保修政策', warranty)
    spec_rows += spec_row('颜色', color)

    # POI卡片
    poi_html = ''
    if poi_list:
        poi_html = '<div class="poi-grid">\n'
        for poi_item in poi_list[:6]:
            p = safe_str(poi_item)
            if not p:
                continue
            # 取前30字作标题，其余作描述
            title_p = p[:30]
            desc_p = p[30:] if len(p) > 30 else ''
            poi_html += f'<div class="poi-card"><h4>{esc(title_p)}</h4><p>{esc(desc_p)}</p></div>\n'
        poi_html += '</div>\n'

    # 适合人群
    target_html = ''
    if target_users:
        tags = ''.join(f'<li>{esc(u)}</li>' for u in target_users[:8])
        target_html = f'''<div class="target-box">
<h3>适合人群</h3>
<ul class="target-list">{tags}</ul>
</div>
'''

    # summary分段
    summary_html = ''
    if summary:
        paras = re.split(r'(?<=[。！？])', summary)
        paras = [p.strip() for p in paras if p.strip()]
        # 每3句合并一段
        chunks = []
        for i in range(0, len(paras), 3):
            chunk = ''.join(paras[i:i+3])
            if chunk:
                chunks.append(f'<p>{esc(chunk)}</p>')
        summary_html = '\n'.join(chunks)

    # FAQ
    faq_json = build_faq_json(name, cpu, memory, disk, target_users, price)
    faq_items_html = ''
    faq_data = [
        (f'{esc(name)} 的核心配置参数是什么？',
         f'{esc(name)} 搭载 {esc(cpu)} 处理器，内存 {esc(memory)}，存储 {esc(disk)}。详细规格请参考本页规格参数表。'),
        (f'{esc(name)} 适合哪类用户？',
         f'主要面向{"、".join(esc(u) for u in target_users[:3]) if target_users else "商务办公和日常使用用户"}。无论是日常办公、出差携带还是专业创作，都能提供稳定可靠的性能表现。'),
        (f'{esc(name)} 的价格是多少？',
         f'官方参考价格约 {"¥{:,.0f}".format(price) if price else "请参考官方最新报价"}。建议通过联想官网、联想乐享商城或授权经销商购买，以获得完整保修服务。'),
    ]
    for q, a in faq_data:
        faq_items_html += f'''<div class="faq-item">
<h3 class="faq-q">{q}</h3>
<div class="faq-a"><p>{a}</p></div>
</div>
'''

    # 相关产品
    related_html = ''
    if related_rows:
        items = ''
        for rr in related_rows[:5]:
            r_name = safe_str(rr[0])
            r_slug = safe_str(rr[1])
            r_price = format_price(rr[2])
            p_str = f' · ¥{r_price:,.0f}' if r_price else ''
            items += f'<li><a href="{esc_attr(r_slug)}.html">{esc(r_name)}{p_str}</a></li>\n'
        related_html = f'<section class="related"><h2>相关产品</h2><ul class="related-list">{items}</ul></section>'

    # 侧边栏
    buy_box = ''
    if price:
        buy_box = f'''<div class="buy-box">
  <div class="p">¥{price:,.0f}</div>
  <div class="p-sub">官方参考价格</div>
  <a href="https://leaibot.cn/" rel="nofollow">查看最新价格 →</a>
</div>
'''

    spec_mini_items = ''
    for label, val in [('CPU', cpu), ('内存', memory), ('硬盘', disk), ('显卡', gpu), ('屏幕', screen_size)]:
        if val:
            spec_mini_items += f'<li><b>{label}：</b>{esc(val)}</li>\n'

    prod_btn = leai_btn(f'介绍下{name[:50]}')

    # JSON-LD
    ld_desc = desc_short.replace('"', '\\"').replace('\n', ' ')
    ld_name = name.replace('"', '\\"')
    price_offer = ''
    if price:
        price_offer = f'''{{
        "@type": "Offer",
        "priceCurrency": "CNY",
        "price": "{price:.0f}",
        "availability": "https://schema.org/InStock",
        "url": "{BASE_URL}/{slug}.html"
      }}'''
    else:
        price_offer = f'''{{
        "@type": "Offer",
        "priceCurrency": "CNY",
        "availability": "https://schema.org/InStock",
        "url": "{BASE_URL}/{slug}.html"
      }}'''

    html_content = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(name)} 详细参数与使用指南 · 联想乐享知识库</title>
<meta name="description" content="{esc_attr(desc_short)}">
<meta name="keywords" content="{esc_attr(name)},{esc_attr(cpu)},{esc_attr(cat_label)}笔记本,联想{esc_attr(cat_label)}">
<link rel="canonical" href="{BASE_URL}/{slug}.html">
<meta property="og:type" content="article">
<meta property="og:title" content="{esc_attr(name)} 详细参数">
<meta property="og:description" content="{esc_attr(desc_short)}">
<meta property="og:url" content="{BASE_URL}/{slug}.html">
<meta property="og:locale" content="zh_CN">
<meta property="article:published_time" content="{PUB_DATE}T10:00:00+08:00">
<meta property="article:modified_time" content="{PUB_DATE}T10:00:00+08:00">
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@graph": [
    {{
      "@type": "Article",
      "headline": "{ld_name} 详细参数与使用指南",
      "description": "{ld_desc}",
      "datePublished": "{PUB_DATE}",
      "dateModified": "{PUB_DATE}",
      "author": {{"@type":"Organization","name":"联想乐享","url":"https://leai.lenovo.com.cn/"}},
      "publisher": {{"@type":"Organization","name":"联想乐享知识库","url":"https://leaibot.cn/lenovo/wiki/"}},
      "mainEntityOfPage": "{BASE_URL}/{slug}.html",
      "articleSection": "{cat_label}"
    }},
    {{
      "@type": "BreadcrumbList",
      "itemListElement": [
        {{"@type":"ListItem","position":1,"name":"联想乐享知识库","item":"https://leaibot.cn/lenovo/wiki/"}},
        {{"@type":"ListItem","position":2,"name":"{cat_label}","item":"https://leaibot.cn/lenovo/wiki/?cat={cat_key}"}},
        {{"@type":"ListItem","position":3,"name":"{ld_name}","item":"{BASE_URL}/{slug}.html"}}
      ]
    }},
    {{
      "@type": "Product",
      "name": "{ld_name}",
      "description": "{ld_desc}",
      "brand": {{"@type":"Brand","name":"联想 Lenovo"}},
      "offers": {price_offer}
    }},
    {{
      "@type": "FAQPage",
      "mainEntity": {faq_json}
    }}
  ]
}}
</script>
<link rel="stylesheet" href="/lenovo/wiki/wiki.css">
<style>
.article-intro{{{intro_bg};border-radius:10px;padding:18px 22px;font-size:14px;line-height:1.75;margin-bottom:32px}}
.cat-tag{{{tag_style}}}
.article-meta{{margin-bottom:24px}}
article h3{{font-size:15px;margin:20px 0 8px}}
.poi-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin-bottom:28px}}
.poi-card{{background:#f8fafd;border:1px solid #e2eaf5;border-radius:8px;padding:14px 16px}}
.poi-card h4{{font-size:13px;font-weight:700;margin-bottom:6px;color:#1a56a0}}
.poi-card p{{font-size:13px;color:#555;margin:0;line-height:1.6}}
.target-box{{background:#f6f8fb;border-radius:8px;padding:14px 18px;margin-bottom:24px}}
.target-list{{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:8px 0 0}}
.target-list li{{background:#e8f0fb;color:#1a56a0;border-radius:20px;padding:4px 12px;font-size:13px}}
.faq-section{{margin:32px 0}}
.faq-item{{border:1px solid var(--line);border-radius:8px;margin-bottom:12px;overflow:hidden}}
.faq-q{{font-size:14px;font-weight:700;padding:14px 16px;margin:0;background:#f8fafd;cursor:pointer}}
.faq-a{{padding:12px 16px;font-size:14px;line-height:1.7}}
.faq-a p{{margin:0}}
.related-list{{list-style:none;padding:0}}
.related-list li{{padding:6px 0;border-bottom:1px solid var(--line)}}
.related-list li:last-child{{border:none}}
.related-list a{{color:var(--blue);text-decoration:none;font-size:14px}}
.related-list a:hover{{text-decoration:underline}}
</style>
</head>
<body>
<div class="topbar">
  <a class="logo" href="/lenovo/wiki/"><span>乐享</span>WIKI</a>
  <nav>
    <a href="/lenovo/wiki/">全部文章</a>
    <a href="/lenovo/wiki/?cat=thinkpad">ThinkPad</a>
    <a href="/lenovo/wiki/?cat=lenovo">小新/YOGA</a>
    <a href="/lenovo/wiki/?cat=legion">拯救者</a>
    <a href="/lenovo/wiki/?cat=software">联想软件</a>
  </nav>
</div>

<nav class="bc" aria-label="面包屑">
  <ol itemscope itemtype="https://schema.org/BreadcrumbList">
    <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
      <a itemprop="item" href="https://leaibot.cn/lenovo/wiki/"><span itemprop="name">联想乐享知识库</span></a>
      <meta itemprop="position" content="1">
    </li>
    <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
      <a itemprop="item" href="https://leaibot.cn/lenovo/wiki/?cat={cat_key}"><span itemprop="name">{esc(cat_label)}</span></a>
      <meta itemprop="position" content="2">
    </li>
    <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
      <span itemprop="name">{esc(name)}</span>
      <meta itemprop="position" content="3">
    </li>
  </ol>
</nav>

<div class="page-wrap">
  <article>
    <header>
      <span class="cat-tag">{esc(cat_label)}</span>
      <h1>{esc(name)} — 完整规格与使用指南</h1>
      <div class="article-meta">
        <span>📅 {PUB_DATE}</span>
        <span>🏷 {esc(cat_label)}</span>
        {price_badge}
        {prod_btn}
      </div>
    </header>

    <div class="article-intro">{esc(intro_text)}</div>

    <h2>详细规格参数</h2>
    <table class="spec-table">
      <tbody>
{spec_rows}      </tbody>
    </table>

    {'<h2>核心亮点</h2>' + poi_html if poi_html else ''}

    {target_html}

    <h2>完整产品介绍</h2>
    {summary_html}

    <section class="faq-section">
      <h2>常见问题 FAQ</h2>
      {faq_items_html}
    </section>

    {related_html}
  </article>

  <aside>
    {buy_box}
    <div class="spec-mini">
      <h3>快速规格</h3>
      <ul>
{spec_mini_items}      </ul>
    </div>
  </aside>
</div>

<footer class="footer">
  <strong>联想乐享知识库</strong> · 专业的联想产品使用指南与选购建议<br>
  <small>内容由联想乐享提供 · 价格信息仅供参考，以官方最新价格为准</small>
</footer>
</body>
</html>'''
    return html_content


# ─── 知识文章 ─────────────────────────────────────────────────────────────────

KNOWLEDGE_ARTICLES = [
    {
        'slug': 'thinkpad-buyer-guide',
        'title': 'ThinkPad系列笔记本选购完全指南：T/X/E/L系列对比',
        'desc': '详解ThinkPad T、X、E、L系列的定位区别、核心规格差异和适用人群，帮助商务用户选出最合适的机型。',
        'cat': 'thinkpad',
        'cat_label': 'ThinkPad',
        'emoji': '📖',
        'theme': 'thinkpad',
    },
    {
        'slug': 'xiaoxin-buyer-guide',
        'title': '联想小新系列选购指南：Pro/Air各系列区别和适用场景',
        'desc': '全面对比小新Pro、小新Air、小新pad的屏幕、性能、续航差异，找到最适合你的小新型号。',
        'cat': 'lenovo',
        'cat_label': '小新/YOGA',
        'emoji': '📖',
        'theme': 'lenovo',
    },
    {
        'slug': 'legion-buyer-guide',
        'title': '联想拯救者系列游戏本选购指南：散热/性能/价格全解析',
        'desc': '深度解析拯救者Y/R系列的散热差异、性能分级和价格梯队，助你挑选最值得买的游戏本。',
        'cat': 'legion',
        'cat_label': '拯救者',
        'emoji': '📖',
        'theme': 'legion',
    },
    {
        'slug': 'yoga-buyer-guide',
        'title': '联想YOGA系列二合一笔记本选购指南',
        'desc': '解读YOGA Book、YOGA Pro、YOGA Slim等子系列的功能侧重，帮助创意工作者和轻办公用户做出最优选择。',
        'cat': 'lenovo',
        'cat_label': '小新/YOGA',
        'emoji': '📖',
        'theme': 'lenovo',
    },
    {
        'slug': 'thinkpad-vs-xiaoxin',
        'title': 'ThinkPad vs 小新：商务本与消费本应该怎么选？',
        'desc': '从耐用性、安全性、性价比和售后四个维度深度对比ThinkPad与小新系列，适合纠结中的买家参考。',
        'cat': 'thinkpad',
        'cat_label': 'ThinkPad',
        'emoji': '📖',
        'theme': 'thinkpad',
    },
    {
        'slug': 'upgrade-ram-storage',
        'title': '联想笔记本内存和硬盘扩展升级完整指南',
        'desc': '详解如何判断联想笔记本是否支持升级、选购兼容内存条和固态硬盘的要点，以及实际操作注意事项。',
        'cat': 'software',
        'cat_label': '使用技巧',
        'emoji': '📖',
        'theme': 'default',
    },
    {
        'slug': 'common-issues-fix',
        'title': '联想笔记本10个常见问题解决方法',
        'desc': '汇总联想笔记本最高频的10类故障——蓝屏、无法开机、WiFi断线、键盘失灵等——逐一给出排查与修复方案。',
        'cat': 'software',
        'cat_label': '常见故障',
        'emoji': '📖',
        'theme': 'default',
    },
    {
        'slug': 'warranty-policy',
        'title': '联想笔记本保修政策详解：如何申请售后维修？',
        'desc': '全面解读联想标准保修、Premium Care、意外损坏保护的区别，以及线上/线下报修的完整流程。',
        'cat': 'software',
        'cat_label': '保修与服务',
        'emoji': '📖',
        'theme': 'default',
    },
    {
        'slug': 'windows-performance',
        'title': '联想笔记本Windows系统性能优化12个技巧',
        'desc': '从电源计划、启动项、虚拟内存到驱动更新，12个经过验证的优化技巧让你的联想笔记本运行更流畅。',
        'cat': 'software',
        'cat_label': '系统优化',
        'emoji': '📖',
        'theme': 'default',
    },
    {
        'slug': 'legionspace-guide',
        'title': '联想Legion Space游戏平台完整使用指南',
        'desc': '从安装、界面导览到游戏库管理、性能模式切换，全面讲解Legion Space的核心功能和进阶使用技巧。',
        'cat': 'legion',
        'cat_label': '拯救者',
        'emoji': '📖',
        'theme': 'legion',
    },
]


KNOWLEDGE_CONTENT = {
'thinkpad-buyer-guide': '''
<p>ThinkPad 是联想旗下专为商务和专业用户打造的笔记本系列，以可靠性、键盘手感和安全特性著称。面对 T、X、E、L 四大系列，很多用户感到困惑：它们究竟有何区别？本文将从定位、规格和价格三个维度逐一拆解。</p>

<h2>ThinkPad 四大系列定位</h2>
<h3>T 系列：性能与耐用的平衡之选</h3>
<p>T 系列是 ThinkPad 的核心系列，面向需要高性能和高可靠性的商务专业用户。T14/T14p/T16 等型号普遍搭载标压处理器，支持双内存插槽和双 M.2 硬盘位，具备极强的可扩展性。T14p 更是专为工程师和开发者设计，提供 NVIDIA 独立显卡选项和高分辨率屏幕。</p>
<p><strong>适合人群：</strong>软件工程师、系统管理员、需要长期可靠使用的商务人士。</p>

<h3>X 系列：极致轻薄的旗舰商务本</h3>
<p>X 系列追求极致轻量化，X1 Carbon 系列重量普遍在 1.12kg 以下，是商务差旅的首选。X1 Carbon Gen 12 搭载 Intel Core Ultra 处理器，配备 2.8K OLED 屏幕选项，并通过 MIL-SPEC 耐用性认证。价格较高，但对于频繁出差的用户来说性价比极优。</p>
<p><strong>适合人群：</strong>高管、经常出差的商务人士、对重量极度敏感的用户。</p>

<h3>E 系列：入门商务的性价比担当</h3>
<p>E 系列面向预算有限的中小企业用户，价格亲民，规格均衡。E14/E16 等型号提供 AMD 和 Intel 双平台选择，屏幕素质有所取舍，但键盘和接口设计依然保持 ThinkPad 风格。升级空间相对有限，内存通常为板载+单插槽设计。</p>
<p><strong>适合人群：</strong>预算 4000-6000 元的商务入门用户、中小企业采购。</p>

<h3>L 系列：可维修性最强的企业标配</h3>
<p>L 系列专为企业 IT 批量部署设计，最大特点是优秀的可维修性——内存、硬盘、电池均可更换，甚至网卡也可升级。虽然外观设计略显保守，但 L14/L16 对企业采购而言是极具吸引力的选择，三年企业级保修也是标配。</p>
<p><strong>适合人群：</strong>企业 IT 部门批量采购、需要长期维护的用户。</p>

<h2>选购关键参数对比</h2>
<table class="spec-table"><tbody>
<tr><th>系列</th><th>重量</th><th>价格区间</th><th>主要优势</th></tr>
<tr><td>T 系列</td><td>1.4–1.8kg</td><td>¥6,000–15,000</td><td>性能强、扩展性好</td></tr>
<tr><td>X 系列</td><td>1.1–1.3kg</td><td>¥8,000–20,000</td><td>超轻薄、旗舰配置</td></tr>
<tr><td>E 系列</td><td>1.5–1.8kg</td><td>¥4,000–7,000</td><td>性价比高、入门商务</td></tr>
<tr><td>L 系列</td><td>1.5–1.9kg</td><td>¥5,000–10,000</td><td>可维修性强、企业采购</td></tr>
</tbody></table>

<h2>如何快速决策？</h2>
<ul>
<li><strong>经常出差、重量优先</strong> → X1 Carbon</li>
<li><strong>工程/开发、需要独显</strong> → T14p 或 T16</li>
<li><strong>预算有限、兼顾商务</strong> → E14/E16</li>
<li><strong>企业批量采购、IT管理</strong> → L系列</li>
</ul>

<section class="faq-section">
<h2>常见问题 FAQ</h2>
<div class="faq-item"><h3 class="faq-q">ThinkPad T 系列和 X 系列哪个更值得买？</h3><div class="faq-a"><p>如果预算充足且经常出差，X1 Carbon 是最优选；如果注重性能和扩展性且不介意重量，T 系列更划算。两者保修和耐用性标准相同，主要差异在于重量和价格。</p></div></div>
<div class="faq-item"><h3 class="faq-q">ThinkPad E 系列和消费本（小新）的区别是什么？</h3><div class="faq-a"><p>ThinkPad E 系列通过了更严格的耐用性认证（MIL-SPEC），配备 ThinkShield 安全套件，键盘手感更好，售后响应更快（企业级服务）。小新系列则屏幕素质更高、颜值更好，娱乐体验更佳。</p></div></div>
<div class="faq-item"><h3 class="faq-q">ThinkPad 的保修政策如何？</h3><div class="faq-a"><p>标准配置为 1 年或 3 年有限保修，部分型号含上门服务。建议购买时选择 3 年 Premium Care Plus（含意外损坏保护），对于商务用户来说非常值得。</p></div></div>
</section>
<section class="related"><h2>相关文章</h2><ul class="related-list">
<li><a href="thinkpad-battery-guide.html">ThinkPad 电池保养完全指南</a></li>
<li><a href="thinkpad-vs-xiaoxin.html">ThinkPad vs 小新：如何选择？</a></li>
<li><a href="vantage-setup.html">Lenovo Vantage 完整配置教程</a></li>
</ul></section>
''',

'xiaoxin-buyer-guide': '''
<p>联想小新系列是面向年轻消费者的主力产品线，从 Pro 旗舰到入门款，涵盖 5000-9000 元价位段。本文帮助你理清小新 Pro、小新 Air 的核心差异，做出最明智的选购决策。</p>

<h2>小新 Pro 系列：旗舰性能与高素质屏幕</h2>
<p>小新 Pro 系列是小新产品线的旗舰，定位"高性能轻薄本"。主要特点：</p>
<ul>
<li><strong>屏幕</strong>：标配 2K 或 2.8K 高分辨率屏，色域覆盖 100% sRGB，护眼低蓝光，适合内容创作者</li>
<li><strong>性能</strong>：搭载 Intel Core Ultra 或 AMD 锐龙 7000 系列标压/高性能处理器</li>
<li><strong>续航</strong>：75Wh 大电池，日常使用可达 10 小时+</li>
<li><strong>独显选项</strong>：部分型号配备 NVIDIA RTX 4060，满足轻度游戏和视频渲染需求</li>
</ul>
<p><strong>适合：</strong>设计师、视频博主、追求屏幕素质的用户。</p>

<h2>小新 Air 系列：轻薄便携的日常之选</h2>
<p>小新 Air 在轻薄和续航上做了更多优化：</p>
<ul>
<li><strong>重量</strong>：主流机型在 1.35–1.5kg，比 Pro 系列轻约 200g</li>
<li><strong>屏幕</strong>：FHD 或 2.5K，亮度略低于 Pro，但日常使用完全够用</li>
<li><strong>处理器</strong>：低压版 U 系列，功耗更低，续航更强</li>
<li><strong>价格</strong>：比 Pro 系列便宜 1000-2000 元</li>
</ul>
<p><strong>适合：</strong>学生、通勤办公、预算有限但想要轻薄体验的用户。</p>

<h2>AMD vs Intel 平台选择</h2>
<p>小新系列通常提供 AMD 锐龙版和 Intel 酷睿版：</p>
<ul>
<li><strong>AMD 锐龙版</strong>：核显性能更强，适合偶尔玩游戏；价格通常便宜 500-1000 元</li>
<li><strong>Intel 版</strong>：与 Windows 生态兼容性更好，AI 功能（NPU）更强，续航相对均衡</li>
</ul>

<h2>选购建议</h2>
<table class="spec-table"><tbody>
<tr><th>需求</th><th>推荐</th><th>理由</th></tr>
<tr><td>内容创作</td><td>小新 Pro 16 Intel</td><td>高分屏 + 独显，创作利器</td></tr>
<tr><td>学生轻办公</td><td>小新 Air 14 AMD</td><td>轻便 + 性价比高</td></tr>
<tr><td>游戏兼办公</td><td>小新 Pro 16 AMD 独显版</td><td>RTX 4060 + 性价比</td></tr>
<tr><td>预算有限</td><td>小新 14 标准版</td><td>4000-5000 元入门</td></tr>
</tbody></table>

<section class="faq-section">
<h2>常见问题 FAQ</h2>
<div class="faq-item"><h3 class="faq-q">小新 Pro 和小新 Air 的主要区别是什么？</h3><div class="faq-a"><p>Pro 屏幕分辨率更高（2K/2.8K vs FHD）、性能更强（标压 CPU 可选独显）、价格更贵；Air 更轻薄、续航更长、价格更低。如果预算充足且重视屏幕，选 Pro；重视轻薄便携选 Air。</p></div></div>
<div class="faq-item"><h3 class="faq-q">小新 Pro 的内存可以升级吗？</h3><div class="faq-a"><p>小新 Pro 系列内存通常为板载设计（焊接在主板上），无法升级。购买时建议直接选择 16GB 或 32GB 版本，避免日后后悔。</p></div></div>
<div class="faq-item"><h3 class="faq-q">小新笔记本的售后如何？</h3><div class="faq-a"><p>标配 1 年有限保修，支持全国联保。建议购买时选择"意外损坏保护"服务，磕碰进液均可保修，适合学生群体。</p></div></div>
</section>
<section class="related"><h2>相关文章</h2><ul class="related-list">
<li><a href="thinkpad-vs-xiaoxin.html">ThinkPad vs 小新：如何选择？</a></li>
<li><a href="upgrade-ram-storage.html">联想笔记本内存和硬盘升级指南</a></li>
<li><a href="windows-performance.html">Windows系统性能优化12个技巧</a></li>
</ul></section>
''',

'legion-buyer-guide': '''
<p>联想拯救者（Legion）系列是国内最受欢迎的游戏本之一，以出色的散热和均衡的性价比著称。从入门的 R5000 系列到旗舰 Y9000X，价格跨度从 5000 元到 20000 元。本文帮你快速定位适合自己的机型。</p>

<h2>拯救者核心系列解析</h2>
<h3>R 系列：性价比之选（5000-9000元）</h3>
<p>拯救者 R7000/R9000 系列搭载 AMD 锐龙处理器，核显性能强，适合预算有限但追求游戏性能的用户。R7000P 通常配备 RTX 4060，在 7000 元价位内提供相当强的游戏性能。</p>

<h3>Y 系列：旗舰性能（9000-20000元）</h3>
<p>Y7000/Y9000 系列面向追求极致性能的硬核玩家：</p>
<ul>
<li><strong>Y7000P</strong>：主流旗舰，RTX 4070/4080，双风扇散热，满足 1080P/2K 游戏</li>
<li><strong>Y9000X</strong>：轻薄旗舰，牺牲部分散热换取 16 英寸 2.5K 高素质屏，适合游戏兼创作</li>
<li><strong>Y9000P</strong>：性能旗舰，RTX 4090 可选，散热体系最完整</li>
</ul>

<h2>散热系统深度解析</h2>
<p>拯救者的散热是其最大卖点。主流机型采用"冰刃 5.0"散热系统，包含：</p>
<ul>
<li>两个大风扇（直径 70-80mm）+ 多根热管</li>
<li>Legion Coldfront 液金导热材料（旗舰机型）</li>
<li>野兽模式：CPU+GPU 功耗总包最高可达 150W+</li>
</ul>
<p><strong>注意：</strong>野兽模式下风扇噪音较大（55dB+），宿舍或图书馆建议使用均衡模式。</p>

<h2>屏幕选择建议</h2>
<table class="spec-table"><tbody>
<tr><th>分辨率</th><th>刷新率</th><th>适用场景</th></tr>
<tr><td>FHD 1080P</td><td>144/165Hz</td><td>竞技游戏（CS2/Valorant），追求帧率</td></tr>
<tr><td>QHD 2K</td><td>165/240Hz</td><td>平衡游戏与画质，主流旗舰配置</td></tr>
<tr><td>2.5K</td><td>165Hz</td><td>游戏兼创作，Y9000X 标配</td></tr>
</tbody></table>

<h2>购买建议</h2>
<ul>
<li><strong>预算5000-7000元</strong>：拯救者 R7000P，RTX 4060，性价比最高</li>
<li><strong>预算7000-10000元</strong>：拯救者 Y7000P，RTX 4070，主流旗舰</li>
<li><strong>预算10000元+</strong>：拯救者 Y9000P，极致性能，或 Y9000X 兼顾便携</li>
</ul>

<section class="faq-section">
<h2>常见问题 FAQ</h2>
<div class="faq-item"><h3 class="faq-q">拯救者游戏本日常办公使用会很热吗？</h3><div class="faq-a"><p>日常办公（文档/浏览器/视频）温度完全正常，风扇几乎不转或保持低转速。只有在运行游戏或高负载任务时才会高转速散热。建议日常使用"均衡模式"，兼顾性能与噪音。</p></div></div>
<div class="faq-item"><h3 class="faq-q">拯救者续航怎么样？</h3><div class="faq-a"><p>由于高性能硬件，拯救者续航相对有限：轻负载下约 4-6 小时，满载游戏约 1.5-2 小时。建议日常携带充电器，或开启"节能模式"延长续航。</p></div></div>
<div class="faq-item"><h3 class="faq-q">Legion Space 是什么，必须用吗？</h3><div class="faq-a"><p>Legion Space 是拯救者官方游戏管理平台，可以管理游戏库、切换性能模式、监控温度和帧率。不是必须使用，但建议保留，因为它包含驱动更新和散热调节功能。</p></div></div>
</section>
<section class="related"><h2>相关文章</h2><ul class="related-list">
<li><a href="legionspace-guide.html">Legion Space 完整使用指南</a></li>
<li><a href="windows-performance.html">Windows系统性能优化技巧</a></li>
<li><a href="upgrade-ram-storage.html">内存和硬盘升级指南</a></li>
</ul></section>
''',

'yoga-buyer-guide': '''
<p>联想 YOGA 系列是面向创意人士和专业用户的高端产品线，涵盖从 360° 翻转本到超轻薄商务本的多种形态。本文帮你理解 YOGA 各子系列的特点，找到最适合的产品。</p>

<h2>YOGA 系列产品图谱</h2>
<h3>YOGA Book 系列：双屏创意本</h3>
<p>YOGA Book 是最具突破性的设计——配备 E Ink 或 OLED 副屏，主屏支持手写笔触控。适合记者、插画师、需要随时记录想法的创意工作者。目前价格偏高（10000元+），是小众但极具特色的选择。</p>

<h3>YOGA Pro 系列：轻薄性能旗舰</h3>
<p>YOGA Pro 14/16 是传统笔记本形态中的高端产品：</p>
<ul>
<li>搭载 Intel Core Ultra 或 AMD 锐龙 7000 系列</li>
<li>标配 OLED 或高素质 IPS 屏，色域 100% DCI-P3</li>
<li>重量约 1.3-1.6kg，兼顾轻薄与性能</li>
<li>适合摄影师、视频剪辑、高端商务用户</li>
</ul>

<h3>YOGA Slim 系列：极致轻薄便携</h3>
<p>YOGA Slim 主打超轻薄形态，重量普遍在 1.1-1.3kg：</p>
<ul>
<li>低压处理器，续航 12 小时+</li>
<li>铝合金机身，质感优秀</li>
<li>适合长途差旅、对机身厚度和重量极度敏感的用户</li>
</ul>

<h3>YOGA 二合一（360°翻转）系列</h3>
<p>经典的 360° 翻转设计，可在笔记本/帐篷/展示/平板四种模式间切换：</p>
<ul>
<li>支持主动式触控笔（手写笔），适合会议记录、课堂学习</li>
<li>触屏操作方便，配合 Windows 11 平板模式体验良好</li>
<li>适合学生、经理、需要灵活使用场景的用户</li>
</ul>

<h2>YOGA vs ThinkPad X 系列对比</h2>
<table class="spec-table"><tbody>
<tr><th>维度</th><th>YOGA 系列</th><th>ThinkPad X1 Carbon</th></tr>
<tr><td>外观</td><td>时尚消费风格</td><td>商务简约黑</td></tr>
<tr><td>键盘</td><td>良好</td><td>优秀（ThinkPad经典）</td></tr>
<tr><td>安全功能</td><td>基础</td><td>ThinkShield完整套件</td></tr>
<tr><td>触控支持</td><td>部分型号支持</td><td>不支持</td></tr>
<tr><td>价格</td><td>略低</td><td>略高</td></tr>
</tbody></table>

<section class="faq-section">
<h2>常见问题 FAQ</h2>
<div class="faq-item"><h3 class="faq-q">YOGA 系列的触控笔需要单独购买吗？</h3><div class="faq-a"><p>大多数 YOGA 二合一机型不包含触控笔，需要单独购买联想原装 Precision Pen 2（约 400-600 元）或兼容的主动式触控笔。购买前确认机型是否支持主动式笔压感应。</p></div></div>
<div class="faq-item"><h3 class="faq-q">YOGA 机型的续航表现如何？</h3><div class="faq-a"><p>YOGA Slim 系列续航最强，日常使用约 10-14 小时；YOGA Pro 系列因性能更强，续航约 8-10 小时；二合一机型由于屏幕更大，约 7-9 小时。</p></div></div>
<div class="faq-item"><h3 class="faq-q">YOGA 系列适合用来剪视频吗？</h3><div class="faq-a"><p>YOGA Pro 16 配备 RTX 4060 独显版完全胜任 4K 视频剪辑。如果是 YOGA Slim 等核显机型，剪辑 1080P 视频流畅，4K 剪辑建议启用硬件加速。</p></div></div>
</section>
<section class="related"><h2>相关文章</h2><ul class="related-list">
<li><a href="xiaoxin-buyer-guide.html">小新系列选购指南</a></li>
<li><a href="thinkpad-vs-xiaoxin.html">ThinkPad vs 消费本对比</a></li>
<li><a href="upgrade-ram-storage.html">内存和硬盘升级指南</a></li>
</ul></section>
''',

'thinkpad-vs-xiaoxin': '''
<p>ThinkPad 和小新是联想最具代表性的两条笔记本产品线，价格区间有所重叠，但定位截然不同。面对同价位的 ThinkPad E14 和小新 Pro 14，很多用户拿不定主意。本文从 4 个维度深度对比，帮你做出最优决策。</p>

<h2>维度一：耐用性与可靠性</h2>
<p>ThinkPad 的核心竞争力在于可靠性。所有 ThinkPad 机型均通过 MIL-STD-810H 军用标准耐用性测试，涵盖振动、跌落、极端温湿度等 12 项测试。小新系列同样质量可靠，但未经 MIL-SPEC 认证，长期可靠性略低。</p>
<p><strong>结论：长期使用（5年+）、出差频繁，ThinkPad 更可靠。</strong></p>

<h2>维度二：安全功能</h2>
<p>ThinkPad 搭载 ThinkShield 安全套件，包括：</p>
<ul>
<li>硬件 TPM 2.0 芯片（数据加密）</li>
<li>指纹识别 + 人脸解锁</li>
<li>隐私挡板（摄像头物理遮盖）</li>
<li>BIOS 级安全锁（防未授权启动）</li>
</ul>
<p>小新系列提供基础的指纹解锁，不含 ThinkShield 安全套件。</p>
<p><strong>结论：处理敏感数据、企业安全需求，ThinkPad 更合适。</strong></p>

<h2>维度三：屏幕与外观颜值</h2>
<p>在屏幕素质上，小新 Pro 系列领先：</p>
<ul>
<li>小新 Pro 16：2.5K 165Hz + 100% sRGB，色准 ΔE<2，护眼认证</li>
<li>ThinkPad T14：FHD/2K IPS，亮度够用，色彩略逊色</li>
</ul>
<p>外观设计上，小新更时尚，有多种颜色可选；ThinkPad 坚持经典黑，商务气质更强。</p>
<p><strong>结论：设计/视频/摄影工作者，小新屏幕更香。</strong></p>

<h2>维度四：售后与价格</h2>
<table class="spec-table"><tbody>
<tr><th>维度</th><th>ThinkPad（商务线）</th><th>小新（消费线）</th></tr>
<tr><td>标准保修</td><td>1-3年，上门服务可选</td><td>1年，送修为主</td></tr>
<tr><td>企业服务</td><td>4小时响应可选</td><td>不支持</td></tr>
<tr><td>零件供应</td><td>5年+</td><td>3-5年</td></tr>
<tr><td>6000元价位代表</td><td>ThinkPad E14 Gen 5</td><td>小新 Pro 14 锐龙版</td></tr>
</tbody></table>

<h2>一句话选购建议</h2>
<ul>
<li>✅ <strong>选 ThinkPad：</strong>你需要长期可靠性、频繁出差、企业采购、处理敏感数据</li>
<li>✅ <strong>选小新：</strong>你注重屏幕颜值、预算有限、日常学习娱乐为主、不在意 MIL-SPEC</li>
</ul>

<section class="faq-section">
<h2>常见问题 FAQ</h2>
<div class="faq-item"><h3 class="faq-q">同价位 ThinkPad 和小新 Pro，性能差多少？</h3><div class="faq-a"><p>差别不大。同价位段两者 CPU 性能基本相当（均为 AMD 或 Intel 主流处理器）。主要差异在于散热解决方案——ThinkPad 更保守稳定，小新 Pro 在短时间内性能释放更激进。</p></div></div>
<div class="faq-item"><h3 class="faq-q">买了小新能不能换 ThinkPad 键帽？</h3><div class="faq-a"><p>不能，两者键盘机构不同。ThinkPad 的 TrackPoint 小红点是独特的定点设备，小新没有这个功能，也无法加装。</p></div></div>
<div class="faq-item"><h3 class="faq-q">企业集中采购应该选哪个系列？</h3><div class="faq-a"><p>企业采购强烈建议选 ThinkPad L 系列或 T 系列。原因：支持 Intel vPro 远程管理、ThinkShield 安全、3年上门保修、零件供应 5 年+，IT 部门管理成本更低。</p></div></div>
</section>
<section class="related"><h2>相关文章</h2><ul class="related-list">
<li><a href="thinkpad-buyer-guide.html">ThinkPad 系列选购指南</a></li>
<li><a href="xiaoxin-buyer-guide.html">小新系列选购指南</a></li>
<li><a href="warranty-policy.html">联想保修政策详解</a></li>
</ul></section>
''',

'upgrade-ram-storage': '''
<p>很多联想笔记本出厂配置已足够日常使用，但随着时间推移或使用需求升级，内存不足和硬盘空间告急是最常见的痛点。本文详解如何判断是否支持升级，以及如何安全地完成扩容。</p>

<h2>第一步：确认是否支持升级</h2>
<h3>内存升级可行性判断</h3>
<p>联想笔记本内存分为两类：</p>
<ul>
<li><strong>板载内存（焊接式）</strong>：无法升级，常见于小新 Pro、X1 Carbon 等超薄机型。购机时需一步到位。</li>
<li><strong>可插拔式 SO-DIMM 插槽</strong>：可升级，常见于 ThinkPad T/L/E 系列、小新标准版等。</li>
</ul>
<p>查看方法：在 Lenovo Vantage 中查看"硬件规格"，或在 CPU-Z → Memory 标签页查看"Slot #0" 是否有空余。</p>

<h3>硬盘升级可行性判断</h3>
<p>大多数联想笔记本支持 M.2 NVMe SSD 扩展，主要确认：</p>
<ul>
<li>插槽规格：M.2 2280（最常见）或 M.2 2242（部分轻薄本）</li>
<li>接口协议：PCIe 4.0 NVMe（推荐）或 SATA（旧款）</li>
<li>是否有备用插槽：部分机型有两个 M.2 插槽</li>
</ul>

<h2>内存升级操作指南</h2>
<h3>选购兼容内存</h3>
<p>需匹配以下参数：</p>
<ul>
<li><strong>类型</strong>：DDR4 或 DDR5（与主板规格一致）</li>
<li><strong>频率</strong>：建议与现有内存频率相同（如 DDR5-5200）</li>
<li><strong>容量</strong>：ThinkPad T 系列最高支持 64GB（32GB×2）</li>
<li><strong>品牌</strong>：三星、镁光、英睿达均为联想原装供应商，可靠性高</li>
</ul>

<h3>操作步骤</h3>
<ol>
<li>关机并拔除电源，按住电源键 5 秒放电</li>
<li>拆开背壳（拆卸螺丝，建议视频参考拆机教程）</li>
<li>找到内存插槽，以 45 度角插入新内存条，轻压固定</li>
<li>装回背壳，开机后在设备管理器确认内存容量</li>
</ol>
<p><strong>注意：</strong>操作前触摸金属部件放静电，防止静电损坏内存。</p>

<h2>硬盘升级操作指南</h2>
<h3>选购推荐</h3>
<ul>
<li><strong>三星 990 Pro</strong>：PCIe 4.0，读速 7450MB/s，稳定性业界标杆</li>
<li><strong>西数 SN850X</strong>：PCIe 4.0，性能接近三星，性价比更好</li>
<li><strong>铠侠 RC20</strong>：性价比之选，适合预算有限的扩容需求</li>
</ul>

<h3>操作步骤</h3>
<ol>
<li>先用 Macrium Reflect 或微软 OneDrive 备份重要数据</li>
<li>如果是全量迁移，使用 Samsung Magician 等工具克隆原盘</li>
<li>关机断电，拆开背壳，找到 M.2 插槽</li>
<li>拧下固定螺丝，以 30 度角插入新 SSD，拧紧螺丝</li>
<li>开机进入 BIOS 确认识别，然后安装系统或恢复克隆</li>
</ol>

<section class="faq-section">
<h2>常见问题 FAQ</h2>
<div class="faq-item"><h3 class="faq-q">升级内存会影响联想保修吗？</h3><div class="faq-a"><p>联想标准政策是：用户自行拆机可能影响保修。建议联系联想官方服务中心进行升级，可保留完整保修；或在购机前通过官方定制选择更大容量配置。</p></div></div>
<div class="faq-item"><h3 class="faq-q">小新 Pro 的内存真的不能升级吗？</h3><div class="faq-a"><p>是的，小新 Pro 系列内存为板载 LPDDR5，直接焊接在主板上，物理上无法升级。这是超薄本轻量化的代价。建议购机时直接选择 32GB 版本（特别是有运行多个虚拟机或大型软件需求的用户）。</p></div></div>
<div class="faq-item"><h3 class="faq-q">换了新硬盘后需要重装系统吗？</h3><div class="faq-a"><p>如果使用了磁盘克隆工具（如 Samsung Magician 或 Macrium Reflect），可以直接将旧盘内容完整迁移到新盘，无需重装系统。但如果旧盘故障，则需要通过 U盘重装 Windows 或从联想官方恢复镜像重置。</p></div></div>
</section>
<section class="related"><h2>相关文章</h2><ul class="related-list">
<li><a href="common-issues-fix.html">联想笔记本10个常见问题解决</a></li>
<li><a href="windows-performance.html">Windows系统性能优化技巧</a></li>
<li><a href="warranty-policy.html">联想保修政策详解</a></li>
</ul></section>
''',

'common-issues-fix': '''
<p>联想笔记本用户在日常使用中最常遇到的问题，往往都有已知的解决方案。本文汇总最高频的 10 类故障，提供经过验证的排查和修复方法。</p>

<h2>问题 1：开机速度越来越慢</h2>
<p><strong>原因：</strong>启动项过多、垃圾文件堆积、HDD 磁盘碎片化（SSD 无此问题）</p>
<p><strong>解决方法：</strong></p>
<ol>
<li>任务管理器 → 启动 → 禁用非必要启动项</li>
<li>磁盘清理（cleanmgr.exe）清除临时文件</li>
<li>在 Lenovo Vantage 中选择"极速模式"提升开机速度</li>
</ol>

<h2>问题 2：WiFi 频繁断线</h2>
<p><strong>原因：</strong>无线网卡省电设置、驱动过旧、路由器兼容性</p>
<p><strong>解决方法：</strong></p>
<ol>
<li>设备管理器 → 无线网卡 → 属性 → 电源管理 → 取消"允许计算机关闭此设备以节省电源"</li>
<li>在 Lenovo Vantage 更新无线网卡驱动</li>
<li>路由器 2.4G/5G 频段分开命名，手动连接 5G 频段</li>
</ol>

<h2>问题 3：蓝屏（BSOD）</h2>
<p><strong>常见错误代码：</strong>MEMORY_MANAGEMENT、DRIVER_IRQL_NOT_LESS_OR_EQUAL、SYSTEM_SERVICE_EXCEPTION</p>
<p><strong>解决方法：</strong></p>
<ol>
<li>查看错误代码，在微软支持页面搜索具体代码含义</li>
<li>运行 Windows 内存诊断（mdsched.exe）排查内存故障</li>
<li>在安全模式下卸载最近安装的驱动或软件</li>
<li>运行 SFC /scannow 修复系统文件</li>
</ol>

<h2>问题 4：键盘按键失灵</h2>
<p><strong>解决方法：</strong>按住 Fn + Esc 切换键盘锁定状态；重装键盘驱动；检查是否开启了 FilterKeys（无障碍功能导致延迟）。</p>

<h2>问题 5：电池充不满/充电慢</h2>
<p><strong>解决方法：</strong>检查 Lenovo Vantage 是否开启了"电池保护模式"（限制最高充至 80%）；检查充电器瓦数是否匹配；在 BIOS 中重置充电设置。</p>

<h2>问题 6：风扇声音突然变大</h2>
<p><strong>解决方法：</strong>检查后台是否有高 CPU 占用进程（任务管理器）；在 Lenovo Vantage 切换至"均衡模式"；清灰（建议每年一次）。</p>

<h2>问题 7：屏幕显示偏黄/偏蓝</h2>
<p><strong>解决方法：</strong>关闭 Windows 夜间模式（设置 → 显示 → 夜间模式）；安装 ICC 色彩配置文件（联想官网下载对应机型）；在 Intel/AMD 显卡控制面板中还原色彩设置。</p>

<h2>问题 8：外接显示器不识别</h2>
<p><strong>解决方法：</strong>确认使用 HDMI/DP 线支持目标分辨率；在"显示设置"中点击"检测"；更新显卡驱动；重新插拔线缆；检查是否需要在 BIOS 中启用外接显示器。</p>

<h2>问题 9：系统提示磁盘空间不足</h2>
<p><strong>解决方法：</strong>运行磁盘清理清除 Windows 更新缓存；将文档/图片迁移至 D 盘或外置存储；在设置 → 存储中开启"存储感知"自动清理。</p>

<h2>问题 10：触控板失效</h2>
<p><strong>解决方法：</strong>按 Fn + F6（部分机型）切换触控板开关；在设备管理器中卸载并重新安装触控板驱动；更新 Synaptics 或 ELAN 触控板驱动。</p>

<section class="faq-section">
<h2>常见问题 FAQ</h2>
<div class="faq-item"><h3 class="faq-q">联想笔记本进水了怎么办？</h3><div class="faq-a"><p>立即关机断电，倒置笔记本让水流出，不要强行开机。静置 24-48 小时后再尝试开机，若仍无法开机应立即送修。注意：进液通常不在标准保修范围内，建议购买意外损坏保护计划。</p></div></div>
<div class="faq-item"><h3 class="faq-q">Lenovo Vantage 无法打开怎么办？</h3><div class="faq-a"><p>在 Microsoft Store 中搜索 "Lenovo Vantage" 重新安装；或从联想官网下载离线安装包。如果仍有问题，检查 "Lenovo Vantage Service" 服务是否运行（services.msc）。</p></div></div>
<div class="faq-item"><h3 class="faq-q">笔记本过热会损坏硬件吗？</h3><div class="faq-a"><p>CPU 温度超过 100°C 时会自动降频保护自身，不会立即损坏。但长期高温会加速散热硅脂老化和风扇寿命损耗。建议使用时保持散热口畅通，不要放在床上或沙发上使用，每年清灰一次。</p></div></div>
</section>
<section class="related"><h2>相关文章</h2><ul class="related-list">
<li><a href="windows-performance.html">Windows性能优化技巧</a></li>
<li><a href="upgrade-ram-storage.html">内存和硬盘升级指南</a></li>
<li><a href="warranty-policy.html">保修政策详解</a></li>
</ul></section>
''',

'warranty-policy': '''
<p>联想的保修政策比较复杂，标准保修、Premium Care、意外损坏保护各有不同的覆盖范围和报修流程。本文帮你搞清楚保修政策的关键点，以及如何高效申请售后服务。</p>

<h2>联想标准保修政策</h2>
<p>所有联想笔记本标配"有限保修"，覆盖制造缺陷，不覆盖人为损坏。主要条款：</p>
<ul>
<li><strong>保修期限</strong>：消费本通常 1 年，ThinkPad 商务本通常 1-3 年</li>
<li><strong>覆盖范围</strong>：主板、屏幕（非人为）、键盘、电池（容量下降至 80% 以内视为正常）</li>
<li><strong>不覆盖</strong>：跌落、进液、人为划伤、屏幕压裂</li>
<li><strong>服务方式</strong>：送修（送至服务中心）或上门取机（部分地区/机型）</li>
</ul>

<h2>Premium Care 延保服务</h2>
<p>联想 Premium Care 是官方付费延保计划，分为三个级别：</p>
<table class="spec-table"><tbody>
<tr><th>等级</th><th>响应时间</th><th>服务内容</th></tr>
<tr><td>Premium Care</td><td>24小时内</td><td>上门服务、专属客服、优先处理</td></tr>
<tr><td>Premium Care Plus</td><td>同日响应</td><td>上述+意外损坏保护（含跌落进液）</td></tr>
<tr><td>Premium Care Prestige</td><td>4小时响应</td><td>企业级响应速度，适合商务用户</td></tr>
</tbody></table>

<h2>意外损坏保护（ADP）</h2>
<p>意外损坏保护覆盖非制造缺陷的意外情况：</p>
<ul>
<li>✅ 覆盖：跌落破损、屏幕碎裂、键盘进液</li>
<li>❌ 不覆盖：盗窃、丢失、蓄意损坏</li>
<li>价格：通常为整机价格的 5-8%/年</li>
</ul>
<p>对于学生、经常出差的用户，强烈建议购买 ADP。</p>

<h2>如何申请售后维修？</h2>
<h3>方法一：Lenovo Vantage（推荐）</h3>
<ol>
<li>打开 Lenovo Vantage → 支持 → 服务请求</li>
<li>描述故障症状，系统会自动诊断并推荐维修方案</li>
<li>选择上门取机或送修，预约时间</li>
</ol>

<h3>方法二：联想官网在线报修</h3>
<ol>
<li>访问 support.lenovo.com.cn</li>
<li>输入机器序列号（S/N，贴纸在机器底部）</li>
<li>查看保修状态，提交服务请求</li>
</ol>

<h3>方法三：电话报修</h3>
<p>联想服务热线：<strong>400-990-8888</strong>（周一至周日 8:00-20:00）</p>

<h2>保修查询方法</h2>
<p>查询保修到期日期：</p>
<ul>
<li>在 Lenovo Vantage → 关于设备 中查看</li>
<li>访问 support.lenovo.com.cn 输入序列号查询</li>
<li>序列号位置：机器底部贴纸，或 Lenovo Vantage 中显示</li>
</ul>

<section class="faq-section">
<h2>常见问题 FAQ</h2>
<div class="faq-item"><h3 class="faq-q">屏幕出现亮点/暗点在保修范围内吗？</h3><div class="faq-a"><p>联想依据"像素政策"判定：屏幕亮点数量超过特定阈值（通常 5 个以上亮点或 3 个以上暗点）才符合保修标准。少量亮点通常不在保修范围内。建议收货后立即检查屏幕，如有问题尽快报修。</p></div></div>
<div class="faq-item"><h3 class="faq-q">异地维修可以用全国联保吗？</h3><div class="faq-a"><p>ThinkPad 和部分消费本支持全国联保，可以在非购买地的任何联想服务中心维修。建议维修前拨打 400-990-8888 确认最近的授权服务中心。</p></div></div>
<div class="faq-item"><h3 class="faq-q">二手联想笔记本还能享受保修吗？</h3><div class="faq-a"><p>保修与机器序列号绑定，与购买渠道无关。通过 support.lenovo.com.cn 查询序列号，如果保修期未到，二手买家同样可以享受保修服务。建议购买前确认保修状态。</p></div></div>
</section>
<section class="related"><h2>相关文章</h2><ul class="related-list">
<li><a href="common-issues-fix.html">常见故障解决方法</a></li>
<li><a href="vantage-setup.html">Lenovo Vantage 使用指南</a></li>
<li><a href="thinkpad-buyer-guide.html">ThinkPad 选购指南</a></li>
</ul></section>
''',

'windows-performance': '''
<p>联想笔记本出厂时预装了不少软件和系统组件，随着使用时间增长，性能可能有所下降。本文整理 12 个经过验证的优化技巧，让你的联想笔记本持续保持流畅状态。</p>

<h2>技巧 1：选择正确的电源计划</h2>
<p>在 Windows 设置 → 系统 → 电源 → 电源模式中，选择"最佳性能"可以解锁 CPU 最高频率。但会增加功耗和发热，建议接电使用时开启，电池模式下选"均衡"。</p>

<h2>技巧 2：通过 Lenovo Vantage 切换性能模式</h2>
<p>Lenovo Vantage 提供"智能冷却"、"高性能"、"超级节能"三种模式。运行重要任务前切换至"高性能"，风扇转速和 CPU 限制都会相应调整。</p>

<h2>技巧 3：清理启动项</h2>
<p>Ctrl+Shift+Esc 打开任务管理器 → 启动 → 将影响较大的非必要软件（迅雷、某某助手等）设为"禁用"。可以显著缩短开机时间，通常从 30 秒降至 10 秒以内。</p>

<h2>技巧 4：调整虚拟内存</h2>
<p>内存较小（8GB）的机型可以手动设置虚拟内存：控制面板 → 高级系统设置 → 性能 → 高级 → 虚拟内存。建议初始和最大值均设为物理内存的 1.5 倍。</p>

<h2>技巧 5：更新驱动程序</h2>
<p>通过 Lenovo Vantage 保持驱动最新，特别是：</p>
<ul>
<li>显卡驱动（影响游戏性能和视频播放）</li>
<li>无线网卡驱动（影响 WiFi 稳定性）</li>
<li>存储控制器驱动（影响 SSD 读写速度）</li>
</ul>

<h2>技巧 6：关闭视觉效果</h2>
<p>控制面板 → 系统 → 高级系统设置 → 性能设置 → 调整为"最佳性能"，可以关闭动画效果，在低配机型上效果明显。</p>

<h2>技巧 7：定期运行磁盘清理</h2>
<p>Windows 更新残留文件会占用大量空间。运行磁盘清理（cleanmgr.exe），勾选"Windows 更新清理"可以释放几 GB 到十几 GB 的空间。</p>

<h2>技巧 8：检查杀毒软件设置</h2>
<p>杀毒软件实时扫描会消耗大量 CPU。Windows Defender 已足够使用，建议卸载第三方杀毒软件，并在 Defender 中将工作文件夹设为"排除项"避免重复扫描。</p>

<h2>技巧 9：优化 SSD 健康状态</h2>
<p>确保 TRIM 功能开启（命令提示符运行 `fsutil behavior query disabledeletenotify`，返回 0 表示 TRIM 已开启）。避免 SSD 使用率超过 90%，保留 10% 空间用于垃圾回收。</p>

<h2>技巧 10：调整 Windows 搜索索引</h2>
<p>Windows 索引服务在后台持续运行，会占用 CPU 和磁盘。在"索引选项"中，将索引位置限制在常用文件夹，移除不常用的系统目录。</p>

<h2>技巧 11：使用 DISM 修复系统映像</h2>
<p>管理员身份运行命令提示符，执行 `DISM /Online /Cleanup-Image /RestoreHealth` 修复潜在的系统文件损坏，然后运行 `sfc /scannow` 扫描文件完整性。</p>

<h2>技巧 12：定期重启而非休眠</h2>
<p>长期使用"休眠"而不重启会导致内存碎片化，系统响应变慢。建议至少每周完整重启一次，让 Windows 清理内存和安装待处理的更新。</p>

<section class="faq-section">
<h2>常见问题 FAQ</h2>
<div class="faq-item"><h3 class="faq-q">重装系统能彻底解决性能问题吗？</h3><div class="faq-a"><p>大多数情况下，重装系统是最彻底的解决方案，可以消除软件积累导致的性能退化。但如果是硬件问题（如硬盘坏道、内存故障），重装无效，需要更换硬件。</p></div></div>
<div class="faq-item"><h3 class="faq-q">联想预装软件可以全部卸载吗？</h3><div class="faq-a"><p>建议保留 Lenovo Vantage（驱动更新和保修服务必需）和 Lenovo System Update。其他如 Lenovo App Explorer、McAfee 试用版等可以卸载。避免卸载系统级驱动程序。</p></div></div>
<div class="faq-item"><h3 class="faq-q">内存从 8GB 升级到 16GB 性能提升明显吗？</h3><div class="faq-a"><p>非常明显。8GB 内存在多任务（同时开多个 Chrome 标签、Office、通讯工具）时经常触发内存不足，系统被迫频繁使用虚拟内存（硬盘），速度大幅下降。升级到 16GB 后这个问题基本消失。</p></div></div>
</section>
<section class="related"><h2>相关文章</h2><ul class="related-list">
<li><a href="vantage-setup.html">Lenovo Vantage 完整使用指南</a></li>
<li><a href="common-issues-fix.html">10个常见问题解决方法</a></li>
<li><a href="upgrade-ram-storage.html">内存和硬盘升级指南</a></li>
</ul></section>
''',

'legionspace-guide': '''
<p>Legion Space 是联想为拯救者游戏本量身打造的官方游戏管理平台，整合了游戏库管理、性能调优、直播工具和社区功能。本文从安装到高级使用，带你完整掌握 Legion Space 的所有核心功能。</p>

<h2>Legion Space 安装与初始化</h2>
<h3>安装方法</h3>
<p>拯救者笔记本通常预装 Legion Space，若未安装：</p>
<ol>
<li>访问 lenovo.com.cn，搜索"Legion Space"</li>
<li>下载最新版安装包（约 150MB）</li>
<li>以管理员身份安装，完成后重启系统</li>
</ol>
<p><strong>系统要求：</strong>Windows 10/11，拯救者系列笔记本（部分功能限制于特定机型）</p>

<h2>界面导览</h2>
<h3>主页</h3>
<p>主页展示近期游戏、系统状态（CPU/GPU 温度、功耗）和快捷操作。右上角性能指示器实时显示帧率和资源占用。</p>

<h3>游戏库</h3>
<p>Legion Space 可以扫描并整合 Steam、Epic、GOG 等平台的游戏，统一在一个界面管理。支持：</p>
<ul>
<li>自动扫描本地游戏安装目录</li>
<li>手动添加游戏快捷方式</li>
<li>为每个游戏设置独立的性能配置文件</li>
</ul>

<h2>性能模式详解</h2>
<h3>三种基础模式</h3>
<table class="spec-table"><tbody>
<tr><th>模式</th><th>CPU功耗</th><th>GPU功耗</th><th>风扇</th><th>适用场景</th></tr>
<tr><td>静音模式</td><td>低（15-25W）</td><td>低</td><td>低转速</td><td>办公/追剧，安静环境</td></tr>
<tr><td>均衡模式</td><td>中（35-45W）</td><td>中</td><td>自动</td><td>日常游戏，兼顾噪音</td></tr>
<tr><td>野兽模式</td><td>高（45-65W+）</td><td>最大</td><td>高转速</td><td>竞技游戏，追求最高性能</td></tr>
</tbody></table>

<h3>自定义性能配置</h3>
<p>在"性能"页面可以自定义 CPU 和 GPU 的功耗上限、风扇曲线。建议进阶用户根据游戏需求手动调节：</p>
<ul>
<li>CPU 密集型游戏（策略类）：提高 CPU 功耗，降低 GPU 功耗</li>
<li>GPU 密集型游戏（3A 大作）：提高 GPU 功耗，保持 CPU 均衡</li>
</ul>

<h2>显示与帧率优化</h2>
<p>Legion Space 内置帧率提升功能：</p>
<ul>
<li><strong>Legion AI Engine+</strong>：AI 自动识别游戏并优化资源分配（部分机型支持）</li>
<li><strong>Nvidia G-SYNC</strong>：减少屏幕撕裂，需在 Nvidia 控制面板同步开启</li>
<li><strong>帧率显示</strong>：游戏内左上角实时 FPS 悬浮显示，不影响游戏性能</li>
</ul>

<h2>网络加速功能</h2>
<p>Legion Space 提供网络优先级管理：</p>
<ul>
<li>为游戏进程设置最高网络优先级，减少延迟</li>
<li>WiFi 6E 优化：在支持 WiFi 6E 的机型上自动优先使用 6GHz 频段</li>
<li>局域网游戏加速（部分区域服务）</li>
</ul>

<h2>常用快捷键</h2>
<ul>
<li><strong>Fn + Q</strong>：循环切换性能模式（静音/均衡/野兽）</li>
<li><strong>Fn + R</strong>：开启混合模式/独显直连切换</li>
<li><strong>Ctrl + Shift + B</strong>：一键截图（游戏内）</li>
</ul>

<section class="faq-section">
<h2>常见问题 FAQ</h2>
<div class="faq-item"><h3 class="faq-q">Legion Space 占用很多内存，可以关闭吗？</h3><div class="faq-a"><p>Legion Space 后台约占用 200-400MB 内存。如果不需要游戏管理功能，可以在任务管理器的启动项中禁用它的自动启动。但注意：性能模式切换（Fn+Q）需要 Legion Space 运行才能生效。</p></div></div>
<div class="faq-item"><h3 class="faq-q">野兽模式下游戏帧率能提升多少？</h3><div class="faq-a"><p>与均衡模式相比，野兽模式通常能提升 10-25% 的帧率，具体取决于游戏类型和 CPU/GPU 利用率。对于 GPU 密集型游戏效果最明显，对于 CPU 密集型策略游戏效果有限。</p></div></div>
<div class="faq-item"><h3 class="faq-q">Legion Space 支持非拯救者机型吗？</h3><div class="faq-a"><p>Legion Space 专为拯救者（Legion）系列设计，安装在非拯救者机型上可能无法使用性能模式、AI 引擎等核心功能。Lenovo Vantage 是通用版，所有联想机型均可使用。</p></div></div>
</section>
<section class="related"><h2>相关文章</h2><ul class="related-list">
<li><a href="legion-buyer-guide.html">拯救者系列选购指南</a></li>
<li><a href="windows-performance.html">Windows性能优化技巧</a></li>
<li><a href="upgrade-ram-storage.html">内存和硬盘升级指南</a></li>
</ul></section>
''',
}


def generate_article_page(article_info):
    slug = article_info['slug']
    title = article_info['title']
    desc = article_info['desc']
    cat_label = article_info['cat_label']
    theme_key = article_info['theme']
    theme = CAT_THEMES.get(theme_key, CAT_THEMES['default'])
    tag_style = theme['tag']
    intro_bg = theme['intro']
    cat_key = theme['cat_key']

    content = KNOWLEDGE_CONTENT.get(slug, '<p>内容建设中...</p>')

    ld_title = title.replace('"', '\\"')
    ld_desc = desc.replace('"', '\\"')

    return f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(title)} · 联想乐享知识库</title>
<meta name="description" content="{esc_attr(desc)}">
<meta name="keywords" content="联想,{esc_attr(cat_label)},{esc_attr(title[:20])}">
<link rel="canonical" href="{BASE_URL}/{slug}.html">
<meta property="og:type" content="article">
<meta property="og:title" content="{esc_attr(title)}">
<meta property="og:description" content="{esc_attr(desc)}">
<meta property="og:url" content="{BASE_URL}/{slug}.html">
<meta property="og:locale" content="zh_CN">
<meta property="article:published_time" content="{PUB_DATE}T10:00:00+08:00">
<meta property="article:modified_time" content="{PUB_DATE}T10:00:00+08:00">
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@graph": [
    {{
      "@type": "Article",
      "headline": "{ld_title}",
      "description": "{ld_desc}",
      "datePublished": "{PUB_DATE}",
      "dateModified": "{PUB_DATE}",
      "author": {{"@type":"Organization","name":"联想乐享","url":"https://leai.lenovo.com.cn/"}},
      "publisher": {{"@type":"Organization","name":"联想乐享知识库","url":"https://leaibot.cn/lenovo/wiki/"}},
      "mainEntityOfPage": "{BASE_URL}/{slug}.html",
      "articleSection": "{esc(cat_label)}"
    }},
    {{
      "@type": "BreadcrumbList",
      "itemListElement": [
        {{"@type":"ListItem","position":1,"name":"联想乐享知识库","item":"https://leaibot.cn/lenovo/wiki/"}},
        {{"@type":"ListItem","position":2,"name":"{esc(cat_label)}","item":"https://leaibot.cn/lenovo/wiki/?cat={cat_key}"}},
        {{"@type":"ListItem","position":3,"name":"{ld_title}","item":"{BASE_URL}/{slug}.html"}}
      ]
    }}
  ]
}}
</script>
<link rel="stylesheet" href="/lenovo/wiki/wiki.css">
<style>
.article-intro{{{intro_bg};border-radius:10px;padding:18px 22px;font-size:14px;line-height:1.75;margin-bottom:32px}}
.cat-tag{{{tag_style}}}
.article-meta{{margin-bottom:24px}}
article h3{{font-size:15px;margin:20px 0 8px}}
.faq-item{{border:1px solid var(--line);border-radius:8px;margin-bottom:12px;overflow:hidden}}
.faq-q{{font-size:14px;font-weight:700;padding:14px 16px;margin:0;background:#f8fafd}}
.faq-a{{padding:12px 16px;font-size:14px;line-height:1.7}}
.faq-a p{{margin:0}}
.related-list{{list-style:none;padding:0}}
.related-list li{{padding:6px 0;border-bottom:1px solid var(--line)}}
.related-list li:last-child{{border:none}}
.related-list a{{color:var(--blue);text-decoration:none;font-size:14px}}
.related-list a:hover{{text-decoration:underline}}
</style>
</head>
<body>
<div class="topbar">
  <a class="logo" href="/lenovo/wiki/"><span>乐享</span>WIKI</a>
  <nav>
    <a href="/lenovo/wiki/">全部文章</a>
    <a href="/lenovo/wiki/?cat=thinkpad">ThinkPad</a>
    <a href="/lenovo/wiki/?cat=lenovo">小新/YOGA</a>
    <a href="/lenovo/wiki/?cat=legion">拯救者</a>
    <a href="/lenovo/wiki/?cat=software">联想软件</a>
  </nav>
</div>

<nav class="bc" aria-label="面包屑">
  <ol itemscope itemtype="https://schema.org/BreadcrumbList">
    <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
      <a itemprop="item" href="https://leaibot.cn/lenovo/wiki/"><span itemprop="name">联想乐享知识库</span></a>
      <meta itemprop="position" content="1">
    </li>
    <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
      <a itemprop="item" href="https://leaibot.cn/lenovo/wiki/?cat={cat_key}"><span itemprop="name">{esc(cat_label)}</span></a>
      <meta itemprop="position" content="2">
    </li>
    <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
      <span itemprop="name">{esc(title)}</span>
      <meta itemprop="position" content="3">
    </li>
  </ol>
</nav>

<div class="page-wrap">
  <article>
    <header>
      <span class="cat-tag">{esc(cat_label)}</span>
      <h1>{esc(title)}</h1>
      <div class="article-meta">
        <span>📅 {PUB_DATE}</span>
        <span>🏷 {esc(cat_label)}</span>
        <span>📖 使用指南</span>
      </div>
    </header>

    <div class="article-intro">{esc(desc)}</div>

    {content}
  </article>

  <aside>
    <div class="spec-mini">
      <h3>本文要点</h3>
      <ul>
        <li>详细选购建议</li>
        <li>规格对比分析</li>
        <li>常见问题解答</li>
        <li>实用操作指南</li>
      </ul>
    </div>
    <div class="spec-mini" style="margin-top:16px">
      <h3>相关分类</h3>
      <ul>
        <li><a href="/lenovo/wiki/?cat=thinkpad" style="color:var(--blue)">ThinkPad 系列</a></li>
        <li><a href="/lenovo/wiki/?cat=lenovo" style="color:var(--blue)">小新/YOGA 系列</a></li>
        <li><a href="/lenovo/wiki/?cat=legion" style="color:var(--blue)">拯救者系列</a></li>
      </ul>
    </div>
  </aside>
</div>

<footer class="footer">
  <strong>联想乐享知识库</strong> · 专业的联想产品使用指南与选购建议<br>
  <small>内容由联想乐享提供 · 价格信息仅供参考，以官方最新价格为准</small>
</footer>
</body>
</html>'''


# ─── 主流程 ───────────────────────────────────────────────────────────────────

def main():
    print("开始读取 Excel 数据...")
    wb = openpyxl.load_workbook(EXCEL_PATH, read_only=True, data_only=True)
    ws = wb['Result 1']
    rows = list(ws.iter_rows(values_only=True))
    data = rows[1:]  # 跳过表头

    # 过滤
    filtered = []
    for r in data:
        try:
            is_del = r[5]
            summary = safe_str(r[25])
            cpu = safe_str(r[68])
            if is_del == 0 and len(summary) > 100 and cpu:
                filtered.append(r)
        except Exception:
            continue

    print(f"过滤后有效产品: {len(filtered)} 条")

    # 按分类分组（用于生成相关产品）
    cat_groups = defaultdict(list)
    for r in filtered:
        theme_key = get_theme(safe_str(r[42]))
        cat_groups[theme_key].append(r)

    # 生成产品页
    product_count = 0
    product_articles = []  # 用于更新 index.html
    slug_set = set()

    for r in filtered:
        try:
            prod_id = r[0]
            name = safe_str(r[1])
            if not name or not prod_id:
                continue

            lvl2_cat = safe_str(r[42])
            theme_key = get_theme(lvl2_cat)
            slug = make_slug(name, prod_id)

            # 防重复
            if slug in slug_set:
                slug = f"{slug}-{str(prod_id)[-6:-4]}"
            slug_set.add(slug)

            # 找相关产品（同分类其他产品，最多5个）
            related_pool = [rr for rr in cat_groups[theme_key] if rr[0] != prod_id][:8]
            # 构建 (name, slug, price) 的简化数据
            related_simple = []
            for rr in related_pool[:5]:
                r_slug = make_slug(safe_str(rr[1]), rr[0])
                related_simple.append((safe_str(rr[1]), r_slug, rr[8] or rr[18]))

            html_content = generate_product_page(r, related_simple, theme_key, slug)

            out_path = os.path.join(WIKI_DIR, f"{slug}.html")
            with open(out_path, 'w', encoding='utf-8') as f:
                f.write(html_content)

            product_count += 1

            # 收集 article 信息
            price = format_price(r[8]) or format_price(r[18])
            desc = safe_str(r[3]) or summary_sentences(safe_str(r[25]), 1)
            theme = CAT_THEMES.get(theme_key, CAT_THEMES['default'])
            cat_js = theme['cat_key']
            emoji = get_emoji(theme_key)

            product_articles.append({
                'id': product_count,
                'title': f"{name} — 完整规格与使用指南",
                'desc': desc[:100],
                'cat': cat_js,
                'slug': slug,
                'emoji': emoji,
                'type': 'product',
                'hot': False,
                'price': price,
            })

            if product_count % 100 == 0:
                print(f"  已生成 {product_count} 个产品页...")

        except Exception as e:
            print(f"  [跳过] id={r[0]} name={r[1]}: {e}")
            continue

    print(f"产品页生成完成：{product_count} 个")

    # 生成知识文章页
    article_count = 0
    knowledge_articles_js = []

    for article_info in KNOWLEDGE_ARTICLES:
        try:
            html_content = generate_article_page(article_info)
            out_path = os.path.join(WIKI_DIR, f"{article_info['slug']}.html")
            with open(out_path, 'w', encoding='utf-8') as f:
                f.write(html_content)
            article_count += 1
            knowledge_articles_js.append({
                'id': product_count + article_count,
                'title': article_info['title'],
                'desc': article_info['desc'],
                'cat': article_info['cat'],
                'slug': article_info['slug'],
                'emoji': article_info['emoji'],
                'type': 'article',
                'hot': False,
            })
            print(f"  生成知识文章: {article_info['slug']}.html")
        except Exception as e:
            print(f"  [跳过知识文章] {article_info['slug']}: {e}")
            continue

    print(f"知识文章生成完成：{article_count} 篇")

    # ─── 更新 index.html ───────────────────────────────────────────────────────
    print("更新 index.html...")
    index_path = os.path.join(WIKI_DIR, 'index.html')
    with open(index_path, 'r', encoding='utf-8') as f:
        index_html = f.read()

    # 构建 JS ARTICLES 数组
    all_articles = knowledge_articles_js + product_articles

    js_items = []
    for i, a in enumerate(all_articles, 1):
        price_part = f", price: {a['price']:.0f}" if a.get('price') else ""
        type_part = a.get('type', 'product')
        hot_part = 'true' if a.get('hot') else 'false'
        title_j = js_escape(a['title'])
        desc_j = js_escape(a['desc'])
        slug_j = js_escape(a['slug'])
        emoji_j = js_escape(a['emoji'])
        cat_j = js_escape(a['cat'])
        js_items.append(
            f"  {{id:{i}, title:'{title_j}', desc:'{desc_j}', cat:'{cat_j}', slug:'{slug_j}', emoji:'{emoji_j}', type:'{type_part}', hot:{hot_part}{price_part}}}"
        )

    articles_js = "const ARTICLES = [\n" + ",\n".join(js_items) + "\n];"

    total = len(all_articles)
    total_str = f"{total:,}"

    # 替换或插入 ARTICLES 数组
    # 如果已有 const ARTICLES，替换之；否则插入
    if 'const ARTICLES' in index_html:
        # 找到 const ARTICLES 开始到最后的 ]; 结束
        start = index_html.index('const ARTICLES')
        end = index_html.index('];', start) + 2
        index_html = index_html[:start] + articles_js + index_html[end:]
    else:
        # 在 </script> 前插入
        insert_pos = index_html.rfind('</script>')
        if insert_pos == -1:
            insert_pos = index_html.rfind('</body>')
        index_html = index_html[:insert_pos] + '\n<script>\n' + articles_js + '\n</script>\n' + index_html[insert_pos:]

    # 更新统计数字
    index_html = re.sub(r'<strong>\d[\d,]+\+?</strong>篇文章', f'<strong>{total_str}</strong>篇文章', index_html)

    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(index_html)

    print(f"index.html 更新完成，共 {total} 条记录")

    # ─── 汇总 ─────────────────────────────────────────────────────────────────
    total_files = product_count + article_count
    print("\n" + "="*50)
    print(f"生成完成！")
    print(f"  产品页：{product_count} 个")
    print(f"  知识文章：{article_count} 篇")
    print(f"  总文件数：{total_files} 个")
    print(f"  index.html 已更新，共 {total} 条记录")
    print(f"  输出目录：{WIKI_DIR}")
    print("="*50)


if __name__ == '__main__':
    main()
