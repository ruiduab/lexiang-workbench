#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
联想乐享WIKI全量页面生成器
生成知识文章页（33678篇）+ 商品页（5193篇）
"""

import sqlite3
import html
import re
import json
import os
import sys
import urllib.parse
from datetime import datetime

# ===== 配置 =====
WIKI_DIR = '/var/www/leaibot/wiki'
DB_PATH = '/root/lexiang/lexiang.db'
XLSX_PATH = '/root/downloads/agent_agent_item_profile_base_info_v2_20260319.xlsx'
TODAY = '2026-03-31'

# 受保护文件（不覆盖）
PROTECTED = {
    'index.html', 'wiki-proposal.html', 'wiki.css',
    'thinkpad-battery-guide.html', 'vantage-setup.html',
    'thinkpad-x1-carbon-review.html', 'common-issues-fix.html',
}

# 存在的文件集合（加速跳过判断）
existing_files = set(os.listdir(WIKI_DIR))

# 计数器
stats = {'new_know': 0, 'new_product': 0, 'skipped': 0, 'total': 0}

# articles.json 数据
all_articles = []

# ===== 分类工具 =====
CAT_LABELS = {
    'brand_news': '品牌/新闻',
    'notebook': '笔记本',
    'desktop': '台式机',
    'monitor': '显示器',
    'tablet_phone': '平板/手机',
    'accessory': '配件/办公',
    'smart_device': '智能设备',
    'server': '服务器',
    'workstation': '工作站',
    'solution': '解决方案',
    'service': '服务产品',
    'knowledge': '技术支持',
    'biz-case': '客户案例',
    'biz-industry': '行业方案',
    'biz-solution': '解决方案',
    'biz-activity': '活动专题',
    'biz-brand': '品牌专区',
    'biz-other': '商用资讯',
}

def get_know_cat(title, content, source_url=''):
    """知识文章分类：按来源和内容归到对应分类。"""
    src = (source_url or '').lower()
    t = (title or '').lower()
    # 品牌/新闻/ESG来源 → brand_news
    if any(k in src for k in ('brand.lenovo', 'esg.lenovo', 'news.lenovo', 'partner.lenovo')):
        return 'brand_news'
    if any(k in t for k in ('品牌纪事', 'esg', '社会价值', '可持续发展', '品牌故事')):
        return 'brand_news'
    # biz.lenovo 商用内容：按URL路径和标题细分
    if 'biz.lenovo' in src:
        # 解决方案类
        if '/industries/' in src or '解决方案' in t:
            return 'solution'
        # 服务器/工作站产品页
        if '/server' in src or '/workstation' in src:
            return 'server'
        return 'solution'  # biz默认归解决方案
    # 标题含服务器/工作站关键词（非iknow技术支持文章）
    if 'iknow.lenovo' not in src and 'support.lenovo' not in src:
        if any(k in t for k in ('服务器', 'thinksystem', 'thinkagile')):
            return 'server'
        if any(k in t for k in ('工作站', 'thinkstation')):
            return 'workstation'
    return 'knowledge'

# ===== 新分类体系（2026-04-09 重构）=====
# 12子项：品牌/新闻, 笔记本, 台式机, 显示器, 平板/手机, 配件/办公, 智能设备, 服务器, 工作站, 解决方案, 服务产品, 技术支持

# parent_category (AE列) → 分类key
PARENT_CAT_MAP = {
    # 笔记本
    '笔记本电脑': 'notebook',
    # 台式机
    '台式机': 'desktop',
    # 显示器
    '显示器': 'monitor',
    '会议平板': 'accessory',
    '会议相关设备': 'accessory',
    '投影设备': 'smart_device',
    # 手机/平板
    '手机': 'tablet_phone',
    '平板电脑': 'tablet_phone',
    '手表': 'tablet_phone',
    # 配件/办公
    '键鼠相关': 'accessory',
    '电脑外设与配件': 'accessory',
    '手机外设与配件': 'accessory',
    '平板外设与配件': 'accessory',
    '充电设备': 'accessory',
    '耳机': 'accessory',
    '音频设备': 'accessory',
    '包袋': 'accessory',
    '支架': 'accessory',
    '打印机及配件': 'accessory',
    'U盘': 'accessory',
    '硬盘': 'accessory',
    '硬盘配件': 'accessory',
    '内存条': 'accessory',
    '显卡': 'accessory',
    '光驱': 'accessory',
    '网线网卡网络': 'accessory',
    '转换器': 'accessory',
    '电源与电池': 'accessory',
    '摄像监控': 'accessory',
    '办公与文具': 'accessory',
    '个人云': 'smart_device',
    '磁盘阵列': 'server',
    '存储': 'server',
    '数码相机': 'accessory',
    '中央处理器': 'accessory',
    '游戏': 'accessory',
    # 智能设备
    '智能家居设备': 'smart_device',
    '仪器仪表工业用品': 'smart_device',
    # 工作站（独立分类）
    '工作站': 'workstation',
    # 服务器
    '服务器': 'server',
    '工控机': 'smart_device',
    # 解决方案
    '解决方案': 'solution',
    '企业与商业活动': 'solution',
    # 服务产品（仅延保/上门服务等）
    '服务产品': 'service',
    # 虚拟品（券/卡/会员/流量/软件）统一归配件
    '优惠卡券': 'accessory',
    '通信服务': 'accessory',
    '软件': 'accessory',
    # 生活/其他 → 归配件
    '礼品类产品': 'accessory',
    '居家好物': 'accessory',
    '衣服类': 'accessory',
    '个护健康': 'accessory',
    '运动用品': 'accessory',
    '按摩器具': 'accessory',
    '玩具': 'accessory',
    '食物饮品': 'accessory',
    '旅行用品': 'accessory',
    '清洁用品': 'accessory',
    '桌椅': 'accessory',
    '灯具': 'accessory',
    '汽车用品': 'accessory',
    '户外用品': 'accessory',
    '收纳': 'accessory',
    '宠物用品': 'accessory',
}

# brand字段 → (显示标签, 品牌key) — 用于识别品牌归属
BRAND_MAP = {
    # 消费笔记本
    '拯救者':       ('拯救者',       'legion'),
    '小新':         ('小新',         'xiaoxin'),
    'yoga':         ('YOGA',         'yoga'),
    'ideapad':      ('IdeaPad',      'ideapad'),
    '来酷':         ('来酷',         'lecoo'),
    'lecoo':        ('来酷',         'lecoo'),
    # 企业购笔记本
    'thinkpad':     ('ThinkPad',     'thinkpad'),
    'thinkbook':    ('ThinkBook',    'thinkbook'),
    '扬天':         ('扬天',         'yangtian'),
    '瑞天':         ('瑞天',         'ruitian'),
    # 商用笔记本
    '昭阳':         ('昭阳',         'zhaoyang'),
    '慧天':         ('慧天',         'huitian'),
    '开天':         ('开天',         'kaitian'),
    # 台式机
    'thinkcentre':  ('ThinkCentre',  'thinkcentre'),
    'thinkstation': ('ThinkStation', 'thinkstation'),
    '天逸':         ('天逸',         'tianyi'),
    '启天':         ('启天',         'qitian'),
    'geekpro':      ('GeekPro',      'geekpro'),
    '异能者':       ('异能者',       'yinenghze'),
    # 手机/平板
    'moto':         ('Moto',         'moto'),
    # 显示器/配件
    'thinkvision':  ('ThinkVision',  'thinkvision'),
    'thinkplus':    ('ThinkPlus',    'thinkplus'),
    '问天':         ('问天',         'wentian'),
    '百应':         ('百应',         'baiying'),
    # 通用
    '联想':         ('联想',         'lenovo'),
}

# 分类key → 首页显示名（新12子项）
CAT_LABELS_MAP = {
    'brand_news':    '品牌/新闻',
    'notebook':      '笔记本',
    'desktop':       '台式机',
    'monitor':       '显示器',
    'tablet_phone':  '平板/手机',
    'accessory':     '配件/办公',
    'smart_device':  '智能设备',
    'server':        '服务器',
    'workstation':   '工作站',
    'solution':      '解决方案',
    'service':       '服务产品',
    'knowledge':     '技术支持',
}

# 品牌key → 子站归属 (c=消费, b=SMB/企业购, biz=政企)
BRAND_BU_MAP = {
    # 笔记本
    'legion': 'c', 'xiaoxin': 'c', 'yoga': 'c', 'ideapad': 'c', 'lecoo': 'c',
    'thinkpad': 'b', 'thinkbook': 'b', 'yangtian': 'b', 'ruitian': 'b',
    'zhaoyang': 'biz', 'huitian': 'biz', 'kaitian': 'biz',
    # 台式机 — ThinkCentre P/S→b, M→biz，需要在代码中按系列判断
    'thinkcentre': 'b',   # 默认b，M系列在代码里覆盖为biz
    'thinkstation': 'biz',
    'tianyi': 'c', 'geekpro': 'c', 'yinenghze': 'c', 'qitian': 'biz',
    # 显示器
    'thinkvision': 'biz',
    # 手机
    'moto': 'c',
    # 配件
    'thinkplus': 'b',
    # 其他
    'wentian': 'biz', 'baiying': 'b', 'lenovo': 'c',
}

# 品类+品牌 → 子站覆盖（某些品牌在不同品类归不同站）
# 格式: (cat_key, brand_key) → bu
BRAND_CAT_BU_OVERRIDE = {
    # ThinkCentre M系列 → biz（默认是b）
    # 这个在_get_bu里通过name关键词判断
}

CAT_THEMES = {k: {'label': v[0], 'cat_key': v[1], 'emoji': '💻'} for k, v in BRAND_MAP.items()}
CAT_THEMES['default'] = {'label': '联想', 'cat_key': 'notebook', 'emoji': '💻'}

def _identify_brand(brand, name):
    """识别品牌key，返回 (display_label, brand_key) 或 None"""
    b = (brand or '').strip().lower()
    name_l = (name or '').lower()

    # brand字段精确匹配
    for key, (label, bkey) in BRAND_MAP.items():
        if b == key.lower():
            return (label, bkey)

    # name关键词兜底
    _NAME_PATTERNS = [
        ('拯救者', '拯救者', 'legion'), ('legion', '拯救者', 'legion'),
        ('y9000', '拯救者', 'legion'), ('y7000', '拯救者', 'legion'), ('r9000', '拯救者', 'legion'),
        ('thinkpad', 'ThinkPad', 'thinkpad'), ('thinkbook', 'ThinkBook', 'thinkbook'),
        ('thinkcentre', 'ThinkCentre', 'thinkcentre'), ('thinkstation', 'ThinkStation', 'thinkstation'),
        ('thinkvision', 'ThinkVision', 'thinkvision'), ('thinkplus', 'ThinkPlus', 'thinkplus'),
        ('小新', '小新', 'xiaoxin'), ('yoga', 'YOGA', 'yoga'), ('ideapad', 'IdeaPad', 'ideapad'),
        ('昭阳', '昭阳', 'zhaoyang'), ('扬天', '扬天', 'yangtian'), ('瑞天', '瑞天', 'ruitian'),
        ('开天', '开天', 'kaitian'), ('启天', '启天', 'qitian'), ('慧天', '慧天', 'huitian'),
        ('天逸', '天逸', 'tianyi'), ('来酷', '来酷', 'lecoo'), ('lecoo', '来酷', 'lecoo'),
        ('geekpro', 'GeekPro', 'geekpro'), ('异能者', '异能者', 'yinenghze'),
        ('moto', 'Moto', 'moto'),
    ]
    for kw, label, bkey in _NAME_PATTERNS:
        if kw in name_l:
            return (label, bkey)

    return None

def get_product_theme(brand, name='', parent_cat='', cpu='', **_kw):
    """返回 (label_str, cat_key_str, brand_key_str)
    分类优先级：parent_category (AE列) → brand识别 → 兜底
    新体系：cat_key 是10子项之一，brand_key 用于子站归属判断
    """
    b = (brand or '').strip().lower()
    name_l = (name or '').lower()
    pc = (parent_cat or '').strip()

    # ── 第零步A：虚拟品关键词 → 配件（券/卡/会员/流量/云盘/订阅）──
    _virtual_kw = ['流量券', '笔记本券', '优惠券', '会员卡', 'wps', '云盘', '存储空间',
                   '订阅', '音乐会员', '视频会员', '爱奇艺', '腾讯视频', '网易云', '酷狗',
                   '碰一下', '立减金', '充值卡', '点卡', '礼品卡', '流量卡']
    if any(k in name_l for k in _virtual_kw):
        brand_info = _identify_brand(brand, name)
        return ((brand_info[0] if brand_info else '联想'), 'accessory', (brand_info[1] if brand_info else 'lenovo'))
    # name 含"TB/GB" + "月/天/年" 组合（存储/流量时长套餐）
    if re.search(r'(?:\d+\s*(?:TB|GB))\s*[/每]?\s*(?:月|天|年|日)', name, re.IGNORECASE):
        brand_info = _identify_brand(brand, name)
        return ((brand_info[0] if brand_info else '联想'), 'accessory', (brand_info[1] if brand_info else 'lenovo'))
    # "累计/尊享 1TB" 类
    if re.search(r'(?:累计|尊享|畅享)\s*\d+\s*(?:TB|GB)', name, re.IGNORECASE):
        brand_info = _identify_brand(brand, name)
        return ((brand_info[0] if brand_info else '联想'), 'accessory', (brand_info[1] if brand_info else 'lenovo'))

    # ── 第零步B：来酷（Lecoo）分类强制覆盖 ──
    if 'lecoo' in name_l or '来酷' in name:
        # 配件关键词仍走配件逻辑（不抢占），这里先看是否配件词
        _lecoo_is_accessory = any(k in name for k in ['鼠标', '键盘', '耳机', '音箱', '扩展坞', '适配器', '充电', '背包', '保护壳', '贴膜', '支架', '散热器', '散热台', '散热垫', '保护膜', '钢化膜', '屏幕膜', '数据线', '电脑包', '清洁']) or '键盘膜' in name
        if not _lecoo_is_accessory:
            # B0: 显示器关键词 → monitor（优先判断，避免被斗战者系列误识别）
            if ('显示器' in name) or ('显示屏' in name) or re.search(r'\d{2}英寸\s*[2-4]K', name) or '曲面屏' in name:
                return ('来酷', 'monitor', 'lecoo')
            # B1: 平板 → tablet_phone
            if '平板' in name and '笔记本' not in name:
                return ('来酷', 'tablet_phone', 'lecoo')
            # B2: 台式/一体/AIO/分体 → desktop
            if ('一体' in name) or ('aio' in name_l) or ('分体台式' in name) or ('台式机' in name) or ('台式计算机' in name):
                return ('来酷', 'desktop', 'lecoo')
            # B3: 笔记本/斗战者/战7000/小新 → notebook（排除组合套餐）
            if '组合' not in name and '套餐' not in name:
                if any(k in name_l for k in ['笔记本', '斗战者', 'air', 'pro', '战7000', '战9000', 'n14', 'n15', 'n16', '小新']):
                    return ('来酷', 'notebook', 'lecoo')

    # ── 第零步C：整机类型强制识别（优先于配件/品牌，避免整机被规格词或品牌词误判） ──
    # 判断是否"主机+显示器"套机（套机归desktop）
    _is_bundle = ('主机' in name or '台式机' in name or '套机' in name) and '显示器' in name
    # 工作站（含 ThinkStation P 系列型号，如 P2/P3/P348/P360/P520/P620）
    _is_ts_model = (bool(re.search(r'(?<![a-z])p\s*[2-7](?:\d{1,2}\b|\b)', name_l))
                    and bool(re.search(r'i[3579]|ultra|至强|xeon|ryzen', name_l))
                    and 'thinkcentre' not in name_l)
    _is_t100c = 't100c' in name_l
    if any(k in name_l for k in ['工作站', 'thinkstation', 'workstation']) or _is_ts_model or _is_t100c:
        brand_info = _identify_brand(brand, name)
        label = brand_info[0] if brand_info else '联想'
        bkey = brand_info[1] if brand_info else 'thinkstation'
        return (label, 'workstation', bkey)
    # 服务器：SR/ST/HR 后 2-3位数字 + 服务器规格特征
    _is_server_model = bool(re.search(r'\b(?:sr|st|hr|sn|sd|sn550)\d{2,3}\b', name_l))
    if ('服务器' in name or 'thinksystem' in name_l or 'thinkserver' in name_l or
        (_is_server_model and re.search(r'至强|xeon|e-?\d{4}|ecc|sas|raid', name_l))):
        # 排除配件（硬盘/内存/电源等散件）
        if not any(k in name for k in ['适配', '内存条', '电源适配', '托架', '风扇', '线缆', '钢化']):
            brand_info = _identify_brand(brand, name)
            label = brand_info[0] if brand_info else '联想'
            bkey = brand_info[1] if brand_info else 'lenovo'
            return (label, 'server', bkey)
    # 显示器（不在套机里的独立显示器）
    if not _is_bundle and ('显示器' in name or '显示屏' in name):
        # 排除显示器配件
        if not any(k in name for k in ['支架', '保护罩', '清洁', '贴膜', '投屏器', '延保', '服务', '键盘套', '鼠标']):
            brand_info = _identify_brand(brand, name)
            label = brand_info[0] if brand_info else '联想'
            bkey = brand_info[1] if brand_info else 'lenovo'
            return (label, 'monitor', bkey)
    # 平板（独立平板，不含笔记本词）
    if '平板' in name and '笔记本' not in name and '组合' not in name and '套餐' not in name:
        # 排除平板配件
        if not any(k in name for k in ['保护壳', '保护套', '保护膜', '贴膜', '支架', '键盘套', '充电', '延保']):
            brand_info = _identify_brand(brand, name)
            label = brand_info[0] if brand_info else '联想'
            bkey = brand_info[1] if brand_info else 'lenovo'
            return (label, 'tablet_phone', bkey)
    # 手机/Moto（独立手机）
    if ('moto ' in name_l or 'moto edge' in name_l or 'moto razr' in name_l or
        re.search(r'联想\s*moto\b', name_l) or
        (re.search(r'\b手机\b', name) and '配件' not in name)):
        if not any(k in name for k in ['保护壳', '保护套', '保护膜', '贴膜', '支架', '充电线', '延保', '服务', '一年', '两年', '三年', '屏碎', '换新']):
            brand_info = _identify_brand(brand, name)
            label = brand_info[0] if brand_info else '联想'
            bkey = brand_info[1] if brand_info else 'moto'
            return (label, 'tablet_phone', bkey)

    # 整机品牌 + CPU/内存规格 → 笔记本/台式（避免被 SSD/硬盘 等配件词误判）
    _pc_brand_kw = ['thinkpad', 'thinkbook', 'thinkcentre', 'thinkedge', 'ideapad', 'ideacentre',
                    'yoga', 'legion', '拯救者', '小新', '昭阳', '扬天', '启天', '开天', '天逸',
                    '慧天', '瑞天', 'thinkvision pc']
    _pc_brand_hit = any(k in name_l for k in _pc_brand_kw)
    _has_cpu_spec = bool(re.search(r'i[3579][\- ]?\d{3,5}[a-z]*|ultra\s*[3579]|锐龙|ryzen\s*[3579]|至强|xeon|r[3579][\- ]?\d{4}', name_l))
    _has_mem_spec = bool(re.search(r'\d{1,3}\s*g(?:b)?(?:\s|ddr|内存|$|/|\*|（)', name_l))
    _is_service = any(k in name for k in ['延保', '上门服务', '保修服务', '服务包', '年服务', '屏碎保'])
    _is_bag_etc = any(k in name for k in ['背包', '双肩包', '电脑包', '保护壳', '保护套', '贴膜', '键盘膜', '鼠标', '键盘', '支架', '适配器', '充电器'])
    if _pc_brand_hit and _has_cpu_spec and _has_mem_spec and not _is_service and not _is_bag_etc:
        brand_info = _identify_brand(brand, name)
        label = brand_info[0] if brand_info else '联想'
        bkey = brand_info[1] if brand_info else 'lenovo'
        # 台式关键词 → desktop，否则 notebook
        if any(k in name for k in ['台式', '一体机', 'aio', '主机', '商用机', 'thinkcentre', '启天', '开天', '扬天', '天逸']):
            # ThinkCentre/启天/开天多为台式
            if 'thinkpad' in name_l or '小新' in name or 'yoga' in name_l or 'legion' in name_l or '拯救者' in name or '昭阳' in name or 'thinkbook' in name_l:
                return (label, 'notebook', bkey)
            return (label, 'desktop', bkey)
        return (label, 'notebook', bkey)

    # ── 第零步D：name关键词强制覆盖 → 配件 ──
    _accessory_override_kw = ['适配器', '充电器', '充电头', '充电线', '充电宝', '移动电源',
                              '数据线', '鼠标', '键盘', '耳机', '音箱', '音响', '支架',
                              '散热器', '散热台', '散热垫', '背包', '书包', '保护壳', '贴膜', '钢化膜',
                              '扩展坞', '集线器', '耳麦', '摄像头', '麦克风', '手柄',
                              '键盘膜', '清洁套装', '电脑包',
                              '口红电源', '硬盘', '固态硬盘', 'ssd', 'sas', '打印机', '电源线',
                              '快充线', '双肩包', '吹风机', '剃须刀', '登机箱', '台灯',
                              '投屏器', '随身充', '优盘', '闪存盘', '指纹优盘',
                              'usb-c', '数码包', '编织', '硅胶快充']
    if any(k in name_l for k in _accessory_override_kw):
        brand_info = _identify_brand(brand, name)
        label = brand_info[0] if brand_info else '联想'
        bkey = brand_info[1] if brand_info else 'lenovo'
        return (label, 'accessory', bkey)

    # ── 第一步：parent_category 直接映射 ──
    cat_key = PARENT_CAT_MAP.get(pc)

    if cat_key is None:
        # parent_category 未命中，兜底
        if cpu:
            cat_key = 'notebook'  # 有CPU → 电脑类
        else:
            service_kw = ('服务', '专家', '延保', '充值', '会员', '保修', '恢复', '权益', '加速')
            solution_kw = ('解决方案', '行业方案')
            if any(k in name for k in service_kw):
                cat_key = 'service'
            elif any(k in name for k in solution_kw):
                cat_key = 'solution'
            else:
                cat_key = 'accessory'

    # ── 第二步：识别品牌 ──
    brand_info = _identify_brand(brand, name)
    if brand_info:
        label, brand_key = brand_info
    else:
        label = brand or '联想'
        brand_key = 'lenovo'

    # ── 第三步：显示器品牌特殊处理 ──
    if cat_key == 'monitor':
        if brand_key == 'thinkvision':
            pass  # 已正确
        elif brand_key in ('ruitian',):
            pass
        # 其他品牌的显示器保持 monitor 分类

    return (label, cat_key, brand_key)

def get_product_bu(cat_key, brand_key, name='', url=''):
    """根据分类和品牌判断子站归属，返回 'c'/'b'/'biz' """
    name_l = (name or '').lower()

    # URL域名强制归站
    _url = (url or '').lower()
    if 'biz.lenovo' in _url:
        return 'biz'
    if 'b.lenovo' in _url or 'tk.lenovo' in _url:
        return 'b'
    if 'item.lenovo' in _url:
        return 'c'

    # 标题含【企业购】→ b
    if '企业购' in (name or ''):
        return 'b'

    # 品类级别强制归属
    if cat_key in ('server', 'workstation'):
        return 'biz'
    if cat_key == 'solution':
        # 企业采购/行政采购 → b，其余 → biz
        if any(k in name for k in ('企业采购', '行政采购', '办公好物', '礼品甄选')):
            return 'b'
        return 'biz'
    if cat_key == 'smart_device':
        # 投影/NAS → c，其余 → biz
        if any(k in name_l for k in ('投影', 'nas', '个人云')):
            return 'c'
        return 'biz'

    # ThinkCentre 按系列区分: M系列→biz, P/S/K系列→b
    if brand_key == 'thinkcentre':
        if re.search(r'thinkcentre\s*m\d', name_l) or 'thinkcentre m ' in name_l:
            return 'biz'
        return 'b'

    # 默认按 BRAND_BU_MAP
    return BRAND_BU_MAP.get(brand_key, 'c')


# ===== 旧接口兼容层（返回2元组的地方适配3元组）=====
def _legacy_get_product_theme(brand, name='', parent_cat='', cpu='', **_kw):
    """兼容旧代码：只返回 (label, cat_key)"""
    label, cat_key, _bkey = get_product_theme(brand, name, parent_cat, cpu, **_kw)
    return (label, cat_key)

# ===== 内容格式化（支持markdown渲染）=====
def md_inline(text):
    """处理行内markdown：**bold**、`code`，去除多余星号"""
    # **粗体**
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    # *斜体*
    text = re.sub(r'\*(.+?)\*', r'<em>\1</em>', text)
    # `代码`
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    # 残余单独星号
    text = re.sub(r'(?<!\w)\*(?!\w)', '', text)
    return text

def clean_content(content):
    """预处理：去除无意义噪声内容"""
    # 去除 ```markdown ... ``` 和 ``` ... ``` 代码块标记行
    content = re.sub(r'```markdown\s*\n', '', content)
    content = re.sub(r'```\s*\n', '', content)
    content = re.sub(r'\n```\s*', '\n', content)
    # 去除无效图片占位符
    content = re.sub(r'!\[\]\(image-placeholder\)', '', content)
    content = re.sub(r'!\[图片[^\]]*\]\(image[^\)]*\)', '', content)
    # 去除 [图片内容识别] 标记行及其后紧跟的OCR标题（### 图片中所有可见文字：等）
    content = re.sub(r'\[图片内容识别\]\s*\n', '', content)
    content = re.sub(r'#{1,3}\s*图片中所有可见文字[：:][^\n]*\n', '', content)
    # 去除页码行
    content = re.sub(r'第\s*\d+\s*页\s*共\s*\d+\s*页', '', content)
    # 去除 [图片: ...] 占位文字
    content = re.sub(r'\[图片[：:][^\]]*\]', '', content)
    return content

def format_content(content):
    content = clean_content(content)
    lines = content.split('\n')
    html_parts = []
    in_ol = False   # 有序列表
    in_ul = False   # 无序列表
    in_table = False
    table_rows = []

    def close_list():
        nonlocal in_ol, in_ul
        if in_ol:
            html_parts.append('</ol>')
            in_ol = False
        if in_ul:
            html_parts.append('</ul>')
            in_ul = False

    def close_table():
        nonlocal in_table, table_rows
        if in_table and table_rows:
            t = '<table><tbody>'
            for i, row in enumerate(table_rows):
                cols = [c.strip() for c in row.split('|') if c.strip()]
                if i == 0:
                    t += '<tr>' + ''.join(f'<th>{html.escape(c)}</th>' for c in cols) + '</tr>'
                elif re.match(r'^[\s\-:|]+$', row.replace('|', '')):
                    pass  # 分隔行跳过
                else:
                    t += '<tr>' + ''.join(f'<td>{html.escape(c)}</td>' for c in cols) + '</tr>'
            t += '</tbody></table>'
            html_parts.append(t)
            table_rows = []
            in_table = False

    for line in lines:
        raw = line.rstrip()
        stripped = raw.strip()

        if not stripped:
            close_list()
            close_table()
            continue

        # 图片链接 ![alt](url) → <img>
        img_match = re.match(r'^!\[([^\]]*)\]\((https?://[^\)]+)\)$', stripped)
        if img_match:
            close_list(); close_table()
            alt = html.escape(img_match.group(1) or '操作示意图')
            src = img_match.group(2)
            html_parts.append(
                f'<figure class="doc-img"><img src="{src}" alt="{alt}" loading="lazy"></figure>'
            )
            continue

        # 表格行
        if stripped.startswith('|') and stripped.endswith('|'):
            close_list()
            in_table = True
            table_rows.append(stripped)
            continue
        else:
            close_table()

        # 标题 ## / ### / ####
        h_match = re.match(r'^(#{1,5})\s+(.+)', stripped)
        if h_match:
            close_list()
            level = min(max(len(h_match.group(1)), 2), 5)  # ## → h2, ### → h3, #### → h4, ##### → h5
            text = md_inline(html.escape(h_match.group(2).strip('*# ')))
            html_parts.append(f'<h{level}>{text}</h{level}>')
            continue

        # 有序列表 1. / 2.
        ol_match = re.match(r'^(\d+)[.)]\s+(.+)', stripped)
        if ol_match:
            if not in_ol:
                close_list()
                html_parts.append('<ol>')
                in_ol = True
            text = md_inline(html.escape(ol_match.group(2)))
            html_parts.append(f'<li>{text}</li>')
            continue

        # 无序列表 - / * / ●
        ul_match = re.match(r'^[-*●·]\s+(.+)', stripped)
        if ul_match:
            if not in_ul:
                close_list()
                html_parts.append('<ul>')
                in_ul = True
            text = md_inline(html.escape(ul_match.group(1)))
            html_parts.append(f'<li>{text}</li>')
            continue

        # 缩进列表（4空格或tab）
        indent_ol = re.match(r'^(?:    |\t)(\d+)[.)]\s+(.+)', raw)
        if indent_ol:
            if not in_ol:
                html_parts.append('<ol>')
                in_ol = True
            text = md_inline(html.escape(indent_ol.group(2)))
            html_parts.append(f'<li>{text}</li>')
            continue

        indent_ul = re.match(r'^(?:    |\t)[-*]\s+(.+)', raw)
        if indent_ul:
            if not in_ul:
                html_parts.append('<ul>')
                in_ul = True
            text = md_inline(html.escape(indent_ul.group(1)))
            html_parts.append(f'<li>{text}</li>')
            continue

        # 普通段落
        close_list()
        if len(stripped) <= 1:
            continue

        ep = html.escape(stripped)
        # 短行且像小标题（冒号结尾、少于40字）→ h4
        if len(stripped) < 40 and (stripped.endswith('：') or stripped.endswith(':')):
            text = md_inline(ep)
            html_parts.append(f'<h4>{text}</h4>')
        elif stripped.startswith('Q：') or stripped.startswith('Q:') or stripped.startswith('问：'):
            html_parts.append(f'<p><strong>{md_inline(ep)}</strong></p>')
        elif stripped.startswith('A：') or stripped.startswith('A:') or stripped.startswith('答：'):
            html_parts.append(f'<p>{md_inline(ep)}</p>')
        else:
            html_parts.append(f'<p>{md_inline(ep)}</p>')

    close_list()
    close_table()
    result = '\n'.join(html_parts)

    # 层级修正：两步处理
    # 步骤1：整体上移——若文章最小级别>h2，整体压平到h2起
    used = set(int(m) for m in re.findall(r'<h([2-5])', result))
    if used:
        min_level = min(used)
        if min_level > 2:
            shift = min_level - 2
            result = re.sub(r'<(/?h)([2-5])', lambda m: f'<{m.group(1)}{min(int(m.group(2)) - shift, 5)}' if int(m.group(2)) - shift >= 2 else f'<{m.group(1)}2', result)

    # 步骤2：消除跳级——顺序扫描，确保每个h标签不超过前一个+1
    def fix_jumps(html_str):
        prev_level = 1  # h1 是页面标题，文章内容从它之后开始
        def replacer(m):
            nonlocal prev_level
            tag, level_str = m.group(1), m.group(2)
            level = int(level_str)
            if '/' not in tag:  # 开标签
                max_allowed = min(prev_level + 1, 5)
                level = min(level, max_allowed)
                level = max(level, 2)
                prev_level = level
            return f'<{tag}{level}'
        return re.sub(r'<(/?h)([2-5])', replacer, html_str)

    result = fix_jumps(result)
    return result

def extract_slug_from_url(source_url, doc_id, is_product=False):
    if source_url:
        # 商品URL：/product/xxx
        m = re.search(r'/product/(\d+)', source_url)
        if m:
            return f'product-{m.group(1)}.html'
        # biz.lenovo.com.cn/pd/xxx
        m = re.search(r'/pd/(\d+)', source_url)
        if m:
            return f'product-{m.group(1)}.html'
        # iknow知识文章：/detail/xxx
        m = re.search(r'/detail/(\d+)', source_url)
        if m:
            return f'article-{m.group(1)}.html'
    if is_product:
        return f'product-doc-{doc_id}.html'
    return f'article-{doc_id}.html'

LEAI_BASE = 'https://leai.lenovo.com.cn/?pmf_group=zwtg&pmf_medium=leaiwiki&pmf_source=Z00617767T000&input='

def leai_url(input_text):
    return LEAI_BASE + urllib.parse.quote(input_text, safe='')

def leai_btn(input_text):
    url = leai_url(input_text)
    return f'<a class="leai-btn" href="{url}" target="_blank" rel="nofollow">在乐享AI咨询 →</a>'

def safe_str(v, maxlen=None):
    s = str(v) if v is not None else ''
    if maxlen and len(s) > maxlen:
        s = s[:maxlen]
    return s

def make_desc(content, title=''):
    text = clean_content(content or '')
    # 提取"简介："后的有效内容（品牌资讯类文章格式）
    m = re.search(r'简介[：:]\s*(.{20,})', text, re.DOTALL)
    if m:
        text = m.group(1)
    # 去掉"关键词："及之后内容
    text = re.split(r'关键词[：:]', text)[0]
    # 去掉"分享到微信"及之后内容
    text = re.split(r'分享到微信|看完视频才发现', text)[0]
    # 去掉开头和title重复的部分（content开头有时就是title本身）
    if title:
        t = title.strip()
        text = text.strip()
        if text.startswith(t):
            text = text[len(t):].lstrip('\n -：:')
    text = text.replace('\n', ' ').strip()
    text = re.sub(r'\s+', ' ', text)
    if len(text) > 150:
        text = text[:147] + '...'
    return text

# 连接知识库获取QA对
def get_qa_pairs(doc_id, db_path=DB_PATH):
    try:
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        cur.execute('SELECT question, answer, user_type FROM knowledge_qa WHERE doc_id=? ORDER BY id', (doc_id,))
        rows = cur.fetchall()
        conn.close()
        return rows
    except:
        return []

def gen_faq_schema(qa_pairs):
    if not qa_pairs:
        return ''
    items = []
    for q, a, _ in qa_pairs[:10]:  # schema最多10条，避免过长
        items.append({
            "@type": "Question",
            "name": q,
            "acceptedAnswer": {"@type": "Answer", "text": a}
        })
    return json.dumps({
        "@type": "FAQPage",
        "mainEntity": items
    }, ensure_ascii=False)

def gen_faq_html(qa_pairs):
    if not qa_pairs:
        return ''
    items_html = ''
    for q, a, utype in qa_pairs[:10]:
        q_esc = html.escape(q)
        a_esc = html.escape(a).replace('\n', '<br>')
        items_html += f'''<div class="faq-item">
  <h3 class="faq-q">{q_esc}</h3>
  <div class="faq-a">{a_esc}</div>
</div>\n'''
    return f'''<section class="faq-section" id="faq">
  <h2>常见问题解答</h2>
  {items_html}
</section>'''

def gen_howto_schema(content, title):
    """从有序列表步骤提取HowTo schema"""
    steps = re.findall(r'^\d+[.)]\s+(.+)', content, re.MULTILINE)
    if len(steps) < 2:
        return ''
    howto_steps = []
    for i, s in enumerate(steps[:10]):
        howto_steps.append({
            "@type": "HowToStep",
            "name": f"步骤{i+1}",
            "text": s.replace('**', '').strip()
        })
    return json.dumps({
        "@type": "HowTo",
        "name": title,
        "step": howto_steps
    }, ensure_ascii=False)

def gen_summary_block(qa_pairs, content, title):
    """生成结论前置摘要块"""
    # 优先用前2条QA的问题作为摘要
    if qa_pairs:
        topics = '、'.join(q for q, _, _ in qa_pairs[:3])
        summary = f'本文来源联想官方，解答关于 <strong>{html.escape(title)}</strong> 的常见问题，包括：{html.escape(topics)}等。'
    else:
        # 从content提取前100字
        text = re.sub(r'[#*!\[\]`]', '', content).strip()[:100]
        summary = html.escape(text) + '…'
    return f'''<div class="summary-block" id="summary">
  <div class="summary-label">⚡ 核心结论</div>
  <p>{summary}</p>
  <p class="summary-source">内容来源：联想官方</p>
</div>'''

# ===== 知识文章页模板 =====
def gen_know_html(doc_id, title, source_url, content):
    src = source_url or ''
    is_product = (
        any(x in src for x in ['biz.lenovo.com.cn', 'item.lenovo.com.cn', 'tk.lenovo.com.cn', 'b.lenovo.com.cn'])
        or '商品名称：' in content
    )
    # 知识库里的商品 → 用统一商品模板（内容太短则返回None，改用知识文章模板）
    if is_product:
        result = gen_product_html_from_content(doc_id, title, source_url, content)
        if result is not None:
            return result
        # 内容太短，降级为普通知识文章

    slug = extract_slug_from_url(source_url, doc_id)
    cat = get_know_cat(title, content, source_url)
    cat_label = CAT_LABELS.get(cat, '知识库')

    # 品牌/商用文章内容清洗：去掉页面底部的条款/隐私政策/注册协议
    if cat in ('brand_news', 'solution'):
        _is_brand = (cat == 'brand_news')
        _cut_markers = ('最新更新：', '您申请注册联想账号', '请您仔细阅读以下条款',
                        '用户注册协议', '隐私权政策', '法律公告', '京ICP备',
                        '版权所有', '联想网站及相关服务', '分享到微信朋友圈',
                        '看完视频才发现', '欢迎注册联想账户')
        for _mk in _cut_markers:
            _pos = content.find(_mk)
            if _pos > 0:
                content = content[:_pos].rstrip()
                break
        # brand_news：简介行就是正文，不做空壳丢弃，只做截断
        # 对非 brand_news（如 solution），也只截断不丢弃
        # 仅丢弃截断后内容完全为空的
        if len(content.strip()) == 0:
            return None, None, None

    content_html = format_content(content)

    # 取QA对
    qa_pairs = get_qa_pairs(doc_id)
    faq_html_str = gen_faq_html(qa_pairs)
    faq_schema_obj = gen_faq_schema(qa_pairs)
    howto_schema_obj = gen_howto_schema(content, title)
    summary_block = gen_summary_block(qa_pairs, content, title)

    # meta description
    if qa_pairs:
        first_q = qa_pairs[0][0][:60]
        desc = f'{title}：解答{first_q}等常见问题，来源联想官方。'
    else:
        desc = make_desc(content)
    if len(desc) > 150:
        desc = desc[:147] + '...'

    # SEO: title规则=文章标题-联想乐享知识库, description取前90字, keywords从标题提取
    title_seo = f'{title[:60]}-联想乐享知识库'
    title_safe = html.escape(title_seo)
    desc_safe = html.escape(desc[:90]) if len(desc) > 90 else html.escape(desc)
    source_safe = html.escape(source_url or 'https://iknow.lenovo.com.cn/')
    title_short = html.escape(title[:30])
    # 提取keywords：从标题中提取品牌名+产品型号+操作关键词
    _kw_parts = re.findall(r'[A-Za-z][A-Za-z0-9\s\-]+|[\u4e00-\u9fff]{2,6}', title)
    _keywords = [k.strip() for k in _kw_parts if len(k.strip()) >= 2][:5]
    keywords_str = html.escape(','.join(_keywords)) if _keywords else html.escape(title[:30])

    src = source_url or ''
    if 'brand.lenovo.com.cn' in src:
        t = title[:50]
        leai_input = f'{t}介绍' if t.startswith('联想') else f'联想{t}介绍'
    else:
        leai_input = title[:60]
    btn_html = leai_btn(leai_input)

    # 来源/作者标注：品牌和解决方案用不同标注
    if cat == 'brand_news':
        _author_line = '<span>来源：<a href="{source}" rel="nofollow" target="_blank">联想品牌中心</a></span>'.format(source=source_safe)
        _author_schema = '"name": "联想品牌中心"'
        _footer_source = '<small>内容来源：<a href="{source}" rel="nofollow" target="_blank">联想品牌中心</a></small>'.format(source=source_safe)
    elif cat == 'solution':
        _author_line = '<span>来源：<a href="{source}" rel="nofollow" target="_blank">联想商用</a></span>'.format(source=source_safe)
        _author_schema = '"name": "联想商用"'
        _footer_source = '<small>内容来源：<a href="{source}" rel="nofollow" target="_blank">联想商用</a></small>'.format(source=source_safe)
    else:
        _author_line = f'<span>来源：<a href="{source_safe}" rel="nofollow" target="_blank">联想官方</a></span>\n        <span>作者：<a href="/wiki/author/lenovo-expert.html" target="_blank">联想官方认证技术专家</a></span>'
        _author_schema = '"name": "联想官方认证技术专家"'
        _footer_source = f'<small>内容来源：<a href="{source_safe}" rel="nofollow" target="_blank">联想官方</a> · 由<a href="/wiki/author/lenovo-expert.html" target="_blank">联想官方认证技术专家</a>审核整理</small>'

    # 额外schema拼入@graph
    extra_schemas = ''
    if faq_schema_obj:
        extra_schemas += f',\n    {faq_schema_obj}'
    if howto_schema_obj:
        extra_schemas += f',\n    {howto_schema_obj}'

    # TOC
    toc_faq = '<li><a href="#faq">常见问题</a></li>' if qa_pairs else ''
    toc_block = '<div class="toc"><h3>目录</h3><ol>'
    toc_block += '<li><a href="#summary">核心结论</a></li>'
    toc_block += '<li><a href="#article-body">文章详情</a></li>'
    if toc_faq:
        toc_block += toc_faq
    toc_block += '<li><a href="#related">相关文章</a></li>'
    toc_block += '</ol></div>'

    # 侧边乐享AI按钮
    leai_btn_aside_html = f'<a class="leai-btn-aside" href="{leai_url(leai_input)}" target="_blank" rel="nofollow">在乐享AI咨询 →</a>'

    # 解决方案/品牌新闻：增加跳转官网原文按钮（类似商品的"立即购买"）
    _ext_btn_label = ''
    if cat == 'solution':
        _ext_btn_label = '查看官网方案 →'
    elif cat == 'brand_news':
        _ext_btn_label = '查看官网原文 →'
    _ext_btn_aside_html = ''
    _ext_mob_btn_html = ''
    if _ext_btn_label and src and src.startswith('http'):
        _ext_btn_aside_html = f'<a class="leai-btn-aside" href="{source_safe}" target="_blank" rel="nofollow" style="background:#e2231a;color:#fff;margin-bottom:10px;">{_ext_btn_label}</a>'
        _ext_mob_btn_html = f'<a class="mob-btn-buy" href="{source_safe}" target="_blank" rel="nofollow">{_ext_btn_label}</a>'

    # 右侧作者卡片：品牌内容用品牌中心，其他用技术专家
    if cat == 'brand_news':
        author_card = '''<div class="author-card-aside">
      <div class="author-card-avatar">📢</div>
      <div>
        <div class="author-card-name">联想品牌中心</div>
        <div class="author-card-title">品牌与公关传播</div>
      </div>
    </div>'''
    elif cat == 'solution':
        author_card = '''<div class="author-card-aside">
      <div class="author-card-avatar">🏢</div>
      <div>
        <div class="author-card-name">联想商用</div>
        <div class="author-card-title">行业解决方案</div>
      </div>
    </div>'''
    else:
        author_card = '''<div class="author-card-aside">
      <div class="author-card-avatar">🛠️</div>
      <div>
        <div class="author-card-name"><a href="/wiki/author/lenovo-expert.html" target="_blank">联想官方认证技术专家</a></div>
        <div class="author-card-title">高级售后技术工程师</div>
      </div>
    </div>'''

    return slug, cat, f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title_safe}</title>
<meta name="description" content="{desc_safe}">
<meta name="keywords" content="{keywords_str}">
<link rel="canonical" href="https://www.lenovo.com.cn/wiki/{slug}">
<meta property="og:type" content="article">
<meta property="og:title" content="{title_safe}">
<meta property="og:url" content="https://www.lenovo.com.cn/wiki/{slug}">
<meta property="og:locale" content="zh_CN">
<meta property="article:published_time" content="2026-03-20T10:00:00+08:00">
<meta property="article:modified_time" content="{TODAY}T10:00:00+08:00">
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@graph": [
    {{
      "@type": "TechArticle",
      "headline": {json.dumps(title[:100], ensure_ascii=False)},
      "description": {json.dumps(desc, ensure_ascii=False)},
      "datePublished": "2026-03-20",
      "dateModified": "{TODAY}",
      "author": {{
        "@type": "Organization",
        {_author_schema}
      }},
      "publisher": {{
        "@type": "Organization",
        "name": "联想乐享知识库",
        "url": "https://www.lenovo.com.cn/wiki/",
        "parentOrganization": {{"@type":"Organization","name":"Lenovo"}}
      }},
      "mainEntityOfPage": "https://www.lenovo.com.cn/wiki/{slug}"
    }},
    {{
      "@type": "BreadcrumbList",
      "itemListElement": [
        {{"@type":"ListItem","position":1,"name":"联想乐享知识库","item":"https://www.lenovo.com.cn/wiki/"}},
        {{"@type":"ListItem","position":2,"name":"{cat_label}","item":"https://www.lenovo.com.cn/wiki/{cat}/"}},
        {{"@type":"ListItem","position":3,"name":{json.dumps(title[:50], ensure_ascii=False)},"item":"https://www.lenovo.com.cn/wiki/{slug}"}}
      ]
    }}{extra_schemas}
  ]
}}
</script>
<link rel="stylesheet" href="/wiki/wiki.css">
<!-- iRadar DAAM SDK -->
<script>
var _isWap = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
var _trackDataType = 'web';
var CONFIGS = _isWap
  ? {{"club_wap_fid":888,"wap_child_id":"wap_common"}}
  : {{"club_pc_fid":888,"pc_child_id":"pc_common"}};
var _trackData = _trackData || [];
var _la_lenovo_website = 10000001;
</script>
<script src="/wiki/la.min.js"></script>
<!-- 神策 Sensors SDK -->
<script src="/wiki/sensorsdata.min.js"></script>
<script>
(function(){{
  var sensors = window.sensorsDataAnalytic201505;
  if (!sensors) return;
  sensors.init({{
    server_url: 'https://eccollect.lenovo.com/sa?project=production',
    project: 'production',
    heatmap: {{ clickmap: 'default', scroll_notice_map: 'default' }},
    is_track_single_page: true,
    show_log: false
  }});
  sensors.quick('autoTrack');
}})();
</script>
</head>
<body>
<div class="topbar">
  <a class="logo" href="/wiki/"><span>乐享</span>WIKI</a>
  <nav>
    <a href="/wiki/brand_news/">品牌/新闻</a>
    <a href="/wiki/notebook/">笔记本</a>
    <a href="/wiki/desktop/">台式机</a>
    <a href="/wiki/monitor/">显示器</a>
    <a href="/wiki/tablet_phone/">平板/手机</a>
    <a href="/wiki/accessory/">配件/办公</a>
    <a href="/wiki/smart_device/">智能设备</a>
    <a href="/wiki/server/">服务器</a>
    <a href="/wiki/workstation/">工作站</a>
    <a href="/wiki/solution/">解决方案</a>
    <a href="/wiki/service/">服务产品</a>
    <a href="/wiki/knowledge/">技术支持</a>
  </nav>
</div>
<nav class="bc" aria-label="面包屑">
  <ol>
    <li><a href="/wiki/">联想乐享知识库</a></li>
    <li><a href="/wiki/{cat}/">{cat_label}</a></li>
    <li><span>{title_short}</span></li>
  </ol>
</nav>
<div class="mob-buy-bar">
  {_ext_mob_btn_html}
  <a class="mob-btn-ai{' ' if _ext_mob_btn_html else ' mob-btn-full'}" href="{leai_url(leai_input)}" target="_blank" rel="nofollow">在乐享AI咨询 →</a>
</div>
<div class="page-wrap know-page">
  <article>
    <header>
      <span class="cat-tag">{cat_label}</span>
      <h1>{title_safe}</h1>
      <div class="article-meta">
        <span>📅 {TODAY}</span>
        {_author_line}
      </div>
    </header>
    {summary_block}
    <div id="article-body">
    {content_html}
    </div>
    {faq_html_str}
    {{related_html}}
    <section class="more-cat" id="related">
      <h2>更多{cat_label}文章</h2>
      <ul class="related-list">
        <li><a href="/wiki/{cat}/">查看更多{cat_label}文章</a></li>
        <li><a href="/wiki/">浏览全部知识库</a></li>
      </ul>
    </section>
  </article>
  <aside>
    {author_card}
    {toc_block}
    <div class="info-box">
      <h3>相关服务</h3>
      <ul>
        <li>售前咨询：400-166-6666</li>
        <li>售后服务：400-990-8888</li>
        <li>在线客服支持</li>
        <li>联想乐享知识库</li>
      </ul>
      {_ext_btn_aside_html}
      {leai_btn_aside_html}
    </div>
  </aside>
</div>
<footer class="footer">
  <strong>联想乐享知识库</strong> · 专业的联想产品使用指南与服务支持<br>
  {_footer_source}
  <div class="beian" style="margin-top:12px;font-size:12px;color:#999;line-height:1.8;">
    版权所有：1998-2026 联想集团 |
    <a href="https://shop.lenovo.com.cn/investor/html/legal.html" target="_blank" rel="nofollow noopener" style="color:#999;">法律公告</a> |
    <a href="https://www.lenovo.com.cn/statement/privacy.html" target="_blank" rel="nofollow noopener" style="color:#999;">隐私权政策</a> |
    <a href="https://www.lenovo.com.cn/public/security/security.html" target="_blank" rel="nofollow noopener" style="color:#999;">产品安全</a><br>
    <a href="https://beian.miit.gov.cn/" target="_blank" rel="nofollow noopener" style="color:#999;">京ICP备11035381-2</a> |
    京公网安备110108007970号 |
    <a href="https://p2.lefile.cn/product/adminweb/2019/07/09/4e555443-93b5-46d5-984f-7d5b06ea2967.jpg" target="_blank" rel="nofollow noopener" style="color:#999;">营业执照:91110108700000458B</a> |
    <a href="https://p2.lefile.cn/fes/cms/2021/06/28/kfqkr0wi9cgsbuubsnbwihci0rg4ft786379.jpg" target="_blank" rel="nofollow noopener" style="color:#999;">增值电信业务许可证 合字B2-20210143</a>
  </div>
</footer>
<script>
(function(){{
  var r = document.referrer;
  var m = r && r.match(/\/(wiki-[a-z]+)\//);
  if (m) {{
    var sub = '/' + m[1] + '/';
    document.querySelectorAll('a.logo, .breadcrumb a').forEach(function(a){{
      if (a.getAttribute('href') === '/wiki/') a.href = sub;
    }});
  }}
}})();
</script>
</body>
</html>'''

# ===== 从知识库content解析商品字段，调用统一商品模板 =====
def gen_product_html_from_content(doc_id, title, source_url, content):
    """知识库商品文档 → 解析content字段 → 构造虚拟row调用gen_product_html"""
    def ef(field):
        m = re.search(rf'{re.escape(field)}[：:]\s*(.+)', content)
        return m.group(1).strip() if m else ''

    def ef_list(field):
        """提取列表型字段（核心卖点/适合人群/规格参数下的- 条目）"""
        m = re.search(rf'{re.escape(field)}[：:]?\s*\n((?:[-·•]\s*.+\n?)+)', content)
        if not m: return []
        return [re.sub(r'^[-·•]\s*', '', l).strip() for l in m.group(1).splitlines() if l.strip()]

    name = ef('商品名称') or title
    gbrief = ef('简介')

    # 内容过短的商品页面（只有标题+简介+关键词，无规格/卖点）不生成商品页
    # 返回 None 让调用方改用知识文章模板
    if len(content) < 250 and not ef('商品名称') and not ef('核心卖点'):
        return None
    price_raw = ef('价格').replace('元','').strip()
    try: baseprice = float(price_raw) if price_raw else 0
    except: baseprice = 0
    cat_name = ef('品类') or ef('子品类') or ''
    poi_list = ef_list('核心卖点')
    poi = '、'.join(poi_list) if poi_list else ''
    target_list = ef_list('适合人群')
    target_user = '、'.join(target_list) if target_list else ''
    summary = ef('详细介绍')

    # 规格参数
    cpu = ''; memory_desc = ''; disk_desc = ''; gpu_desc = ''; screen_size = ''
    screen_res = ''; os_val = ''; warranty = ''; weight = ''
    spec_m = re.search(r'规格参数[：:]?\s*\n((?:[-·•]\s*.+\n?)+)', content)
    if spec_m:
        for line in spec_m.group(1).splitlines():
            line = line.strip().lstrip('-·• ')
            if '：' in line or ':' in line:
                k, _, val = line.partition('：') if '：' in line else line.partition(':')
                k = k.strip(); val = val.strip()
                if 'cpu' in k.lower() or '处理器' in k: cpu = val
                elif '内存' in k: memory_desc = val
                elif '存储' in k or '硬盘' in k: disk_desc = val
                elif '显卡' in k or 'gpu' in k.lower(): gpu_desc = val
                elif '屏幕尺寸' in k: screen_size = val
                elif '分辨率' in k: screen_res = val
                elif '系统' in k or 'os' in k.lower(): os_val = val
                elif '保修' in k: warranty = val
                elif '重量' in k: weight = val

    # 商品链接：content里的商品链接 → source_url → xlsx查找表
    buy_url_raw = ef('商品链接') or source_url or ''
    if not buy_url_raw:
        buy_url_raw = _xlsx_url_map.get(name, '')
    if buy_url_raw.startswith('//'):
        buy_url_raw = 'https:' + buy_url_raw

    # 构造虚拟 row_vals（按 gen_product_html 的字段索引）
    # 只填用到的索引，其余None
    N = 140
    row = [None] * N
    # 从name推断brand和parent_category，用于分类
    name_l_kb = name.lower()
    kb_brand = ''
    kb_parent_cat = cat_name  # 默认用品类字段

    # 1. 配件/外设类关键词（最高优先，避免"拯救者充电器"被归为笔记本）
    _accessory_kw = ['适配器', '充电器', '充电头', '充电线', '充电宝', '移动电源', '能量宝',
                     '会议平板', '会议大屏', '会议电视', '电子白板', '智能白板',
                     '数据线', '鼠标', '键盘', '耳机', '音箱', '音响', '支架', '奇光板', '灯板',
                     '散热器', '散热台', '散热垫', '背包', '书包', '保护壳', '贴膜', '钢化膜',
                     '扩展坞', '扩展器', '集线器', 'hub', '笔记本支架', '手机支架', '显示器支架',
                     '椅子', '游戏椅', '电竞椅', '耳麦', '摄像头', '麦克风', '手柄', '方向盘',
                     '脚架', 'u盘', '硬盘盒', '内存条', '网卡', '路由器',
                     '洗手机', '洗手液', '智能家居', '扫地机', '加湿器', '净化器']
    if any(k in name_l_kb for k in _accessory_kw):
        kb_brand, kb_parent_cat = '联想', '电脑外设与配件'
    # 2. 服务类
    elif any(k in name for k in ['服务', '延保', '保修', '礼品卡', '充值', '会员']):
        kb_brand, kb_parent_cat = '联想', '服务产品'
    # 3. 手机类
    elif 'moto' in name_l_kb: kb_brand, kb_parent_cat = 'moto', '手机'
    # 4. 工作站/台式关键词（含"工作站"和"workstation"）
    elif any(k in name_l_kb for k in ['工作站', 'workstation']):
        kb_brand, kb_parent_cat = '联想', '工作站'
    elif any(k in name for k in ['一体机', '一体计算机', '台式机', '台式计算机', '台式电脑']):
        kb_brand, kb_parent_cat = '联想', '台式机'
    # 5. 品牌关键词
    elif '昭阳' in name: kb_brand, kb_parent_cat = '昭阳', '笔记本电脑'
    elif '瑞天' in name: kb_brand, kb_parent_cat = '瑞天', '笔记本电脑'
    elif '启天' in name: kb_brand, kb_parent_cat = '启天', '台式机'
    elif '扬天' in name: kb_brand, kb_parent_cat = '扬天', '笔记本电脑'
    elif '天逸' in name: kb_brand, kb_parent_cat = '天逸', '台式机'
    elif '开天' in name: kb_brand, kb_parent_cat = '开天', '台式机'
    elif 'thinkstation' in name_l_kb: kb_brand, kb_parent_cat = 'thinkstation', '工作站'
    elif 'thinkcentre' in name_l_kb: kb_brand, kb_parent_cat = 'thinkcentre', '台式机'
    elif 'thinkpad' in name_l_kb: kb_brand, kb_parent_cat = 'thinkpad', '笔记本电脑'
    elif 'thinkbook' in name_l_kb: kb_brand, kb_parent_cat = 'thinkbook', '笔记本电脑'
    elif '拯救者' in name or 'legion' in name_l_kb: kb_brand, kb_parent_cat = '拯救者', '笔记本电脑'
    elif any(k in name for k in ['来酷', 'lecoo', 'Lecoo']): kb_brand, kb_parent_cat = '来酷', '显示器'
    elif any(k in name for k in ['投影仪', '投影机', '智能投影']): kb_brand, kb_parent_cat = '联想', '投影设备'
    elif any(k in name for k in ['平板', 'pad']) and '笔记本' not in name: kb_brand, kb_parent_cat = '联想', '平板电脑'
    elif '小新' in name or 'yoga' in name_l_kb: kb_brand, kb_parent_cat = '联想', '笔记本电脑'

    row[0] = f'kb-{doc_id}'          # pid
    row[1] = name                     # name
    row[3] = gbrief                   # gbrief
    row[4] = buy_url_raw              # pcdetailurl
    row[8] = baseprice                # baseprice
    row[24] = poi                     # poi
    row[25] = summary                 # summary
    row[26] = target_user             # target_user
    row[30] = kb_parent_cat           # parent_category
    row[35] = kb_brand or ''          # brand
    row[49] = weight                  # weight
    row[50] = warranty                # warranty
    row[55] = os_val                  # os
    row[57] = memory_desc             # memory
    row[62] = disk_desc               # disk
    row[68] = cpu                     # cpu
    row[79] = gpu_desc                # gpu
    row[85] = screen_size             # screen_size
    row[89] = screen_res              # screen_res

    slug, cat, html_out = gen_product_html(row, [])
    # 覆盖slug为商品规范格式
    slug = extract_slug_from_url(source_url, doc_id, is_product=True)
    return slug, cat, html_out


# ===== 商品页模板 =====
def gen_spec_row(label, value):
    if not value:
        return ''
    return f'<tr><th>{html.escape(label)}</th><td>{html.escape(str(value))}</td></tr>'

def gen_product_html(row_vals, headers):
    def v(idx):
        return row_vals[idx] if idx < len(row_vals) and row_vals[idx] is not None else ''

    pid = v(0)
    name = str(v(1))[:100]
    gbrief = str(v(3)) if v(3) else ''
    pcdetailurl = str(v(4)) if v(4) else ''   # 官方商品详情页链接
    color = str(v(6)) if v(6) else ''
    baseprice = v(8)
    poi = str(v(24)) if v(24) else ''
    summary = str(v(25)) if v(25) else ''
    target_user = str(v(26)) if v(26) else ''
    cat_name = str(v(42)) if v(42) else ''
    lvl1_cat_name = str(v(41)) if v(41) else ''   # lvl1_category_name，index 41
    lvl2_cat_name = str(v(42)) if v(42) else ''   # lvl2_category_name，index 42（cat_name同字段）
    brand = str(v(35)) if v(35) else ''   # brand字段，index 35
    parent_category = str(v(30)) if v(30) else ''  # parent_category，index 30
    category = str(v(31)) if v(31) else ''          # category，index 31
    weight = str(v(49)) if v(49) else ''
    warranty = str(v(50)) if v(50) else ''
    os_val = str(v(55)) if v(55) else ''
    memory_desc = str(v(57)) if v(57) else ''
    disk_desc = str(v(62)) if v(62) else ''
    cpu = str(v(68)) if v(68) else ''
    gpu_desc = str(v(79)) if v(79) else ''
    screen_size = str(v(85)) if v(85) else ''
    screen_res = str(v(89)) if v(89) else ''
    port = str(v(96)) if v(96) else ''
    power = str(v(99)) if v(99) else ''
    wifi = str(v(106)) if v(106) else ''

    cat_label, cat_key, brand_key = get_product_theme(brand, name, parent_category, cpu)
    emoji = '💻'

    # 生成slug：统一用 product-{pid}.html
    slug = f'product-{pid}.html'

    # 价格
    price = int(float(baseprice)) if baseprice else 0
    price_str = f'¥{price:,}' if price else ''

    title = f'{name}-联想乐享知识库'
    title_safe = html.escape(title[:80])

    # 规格表行
    spec_rows = ''
    spec_rows += gen_spec_row('操作系统', os_val)
    spec_rows += gen_spec_row('处理器', cpu)
    spec_rows += gen_spec_row('内存', memory_desc)
    spec_rows += gen_spec_row('存储', disk_desc)
    spec_rows += gen_spec_row('显卡', gpu_desc)
    spec_rows += gen_spec_row('屏幕尺寸', screen_size)
    spec_rows += gen_spec_row('分辨率', screen_res)
    spec_rows += gen_spec_row('接口', port)
    spec_rows += gen_spec_row('无线网卡', wifi)
    spec_rows += gen_spec_row('电源', power)
    spec_rows += gen_spec_row('重量', weight)
    spec_rows += gen_spec_row('保修', warranty)
    spec_rows += gen_spec_row('颜色', color)

    # article-intro 简介段落：优先用 summary 前两句，否则完整 gbrief
    if summary and len(summary) > 30:
        sents = re.split(r'(?<=[。！？.!?])', summary)
        intro_text = ''.join(sents[:2]).strip()
        if not intro_text:
            intro_text = summary[:120]
    else:
        intro_text = gbrief  # gbrief 是规格字符串，完整展示不截断
    if not intro_text:
        intro_text = name
    intro_html = f'<p>{html.escape(intro_text)}</p>'

    # SEO：description取页面可见内容前90字（以intro_text为主），keywords从标题+品牌+分类提取
    _desc_src = intro_text or summary or gbrief or name
    _desc_src = re.sub(r'\s+', ' ', _desc_src).strip()
    desc = _desc_src[:90]
    desc_safe = html.escape(desc)
    # keywords: 品牌 + 分类 + 核心型号 + 用途词
    _kw_set = []
    def _kw_add(x):
        x = (x or '').strip()
        if x and len(x) >= 2 and x not in _kw_set:
            _kw_set.append(x)
    _kw_add(cat_label)
    if brand:
        _kw_add(brand)
    else:
        _kw_add('联想')
    # 从 name 中抽品牌/系列词
    for _br in ('ThinkPad','ThinkBook','ThinkStation','ThinkCentre','ThinkSystem','YOGA','小新','拯救者','昭阳','启天','扬天','天逸','开天','来酷','Lecoo','俐智'):
        if _br.lower() in name.lower():
            _kw_add(_br)
    # 从 name 提取 \w+\d+ 型号（如 MM22、B1801s）
    _models = re.findall(r'[A-Za-z]+\d+[A-Za-z]?', name)
    for _m in _models[:2]:
        _kw_add(_m)
    # 产品用途词
    if cat_key == 'notebook': _kw_add('笔记本电脑')
    elif cat_key == 'desktop': _kw_add('台式机')
    elif cat_key == 'monitor': _kw_add('显示器')
    elif cat_key == 'tablet_phone': _kw_add('平板电脑')
    elif cat_key == 'accessory': _kw_add('办公配件')
    elif cat_key == 'workstation': _kw_add('工作站')
    elif cat_key == 'server': _kw_add('服务器')
    elif cat_key == 'service': _kw_add('延保服务')
    if '延保' in name: _kw_add('延长保修')
    if '鼠标' in name: _kw_add('鼠标')
    if '键盘' in name: _kw_add('键盘')
    if '耳机' in name: _kw_add('耳机')
    if '电脑包' in name or '双肩包' in name: _kw_add('电脑包')
    _kw_set = [k for k in _kw_set if k][:5]
    keywords_str = html.escape(','.join(_kw_set) if _kw_set else (cat_label or '联想'))

    # poi 亮点卡片（最多6条，按"、"或"，"或"。"分割）
    def parse_list_field(val):
        """解析可能是JSON数组或分隔符字符串的字段"""
        if not val:
            return []
        s = val.strip()
        if s.startswith('['):
            try:
                import json as _json
                items = _json.loads(s)
                return [str(i).strip('" ') for i in items if str(i).strip()]
            except Exception:
                # JSON解析失败，去掉括号后按分隔符分
                s = s.strip('[]')
        return [p.strip().strip('"\'') for p in re.split(r'[、，。；;\n]+', s) if p.strip().strip('"\'')]

    poi_cards_html = ''
    if poi:
        poi_items = [p for p in parse_list_field(poi) if len(p) > 4][:6]
        if poi_items:
            cards = ''
            for item in poi_items:
                cards += f'<div class="poi-card"><h4>{html.escape(item)}</h4></div>\n'
            poi_cards_html = f'<h2 id="poi">核心亮点</h2>\n<div class="poi-grid">\n{cards}</div>\n'

    # 适合人群标签
    target_html = ''
    if target_user:
        tags = parse_list_field(target_user)
        tags = [t for t in tags if t]
        if tags:
            li_items = ''.join(f'<li>{html.escape(t)}</li>' for t in tags)
            target_html = f'''<div class="target-box" id="target">
  <h3>适合人群</h3>
  <ul class="target-list">{li_items}</ul>
</div>
'''

    # summary 分段落详情（按句号/！/？断段，每3句一段）
    summary_detail_html = ''
    if summary:
        sentences = re.split(r'(?<=[。！？])', summary.strip())
        sentences = [s.strip() for s in sentences if s.strip()]
        chunks = []
        for i in range(0, len(sentences), 3):
            chunk = ''.join(sentences[i:i+3])
            if chunk:
                chunks.append(f'<p>{html.escape(chunk)}</p>')
        if chunks:
            summary_detail_html = '<h2 id="detail">产品详情</h2>\n' + '\n'.join(chunks)

    # 产品综合介绍（基于name/brand/cat生成差异化段落，提升EEAT与关键词密度）
    _name_bold = html.escape(name)
    _brand_bold = html.escape(brand or '联想')
    _cat_bold = html.escape(CAT_LABELS.get(cat_key, cat_label or '联想产品'))
    # 按品类生成不同的介绍模版
    _scene_map = {
        'notebook': '适合办公出差、学习创作、游戏娱乐等多场景使用',
        'desktop': '适合家庭办公、专业设计、游戏娱乐等场景',
        'monitor': '适合办公、设计、游戏等多种使用场景',
        'tablet_phone': '适合移动办公、学习娱乐、随身携带等场景',
        'accessory': '作为日常办公与学习的配套用品，提升使用体验',
        'smart_device': '适合智能家居与日常生活，提升便利性',
        'server': '面向企业数据中心、云计算与虚拟化等专业场景',
        'workstation': '面向专业设计、工程仿真、3D渲染等高性能场景',
        'service': '为联想用户提供专业的售后保障与延保服务',
    }
    _scene = _scene_map.get(cat_key, '适合多种日常使用场景')
    _buy_tip_map = {
        'notebook': '选购时建议重点关注<strong>处理器</strong>、<strong>内存容量</strong>与<strong>显卡配置</strong>，结合自身预算与使用场景选择合适型号',
        'desktop': '选购时建议关注<strong>处理器性能</strong>、<strong>显卡规格</strong>与<strong>存储配置</strong>',
        'monitor': '选购时建议关注<strong>分辨率</strong>、<strong>刷新率</strong>与<strong>色彩表现</strong>',
        'accessory': '选购时建议结合个人使用习惯与办公环境，选择合适的<strong>尺寸与配色</strong>',
        'service': '办理服务前请确认<strong>适用机型</strong>与<strong>服务期限</strong>，按需选购延保方案',
    }
    _buy_tip = _buy_tip_map.get(cat_key, '选购时请结合自身需求与预算，优先选择官方正品渠道')
    _intro_title = f'{_name_bold}介绍'
    _rich_paragraphs = [
        f'<p><strong>{_name_bold}</strong>是{_brand_bold}品牌旗下的{_cat_bold}类产品，{_scene}。',
        f'产品由联想官方提供正品保障，支持全国联保与官方售后服务。</p>'
    ]
    if gbrief:
        _rich_paragraphs.append(f'<p>核心卖点：{html.escape(gbrief[:150])}</p>')
    _rich_paragraphs.append(f'<p><strong>选购建议：</strong>{_buy_tip}。如有型号、规格或使用相关疑问，可通过联想官方渠道或乐享AI客服咨询。</p>')
    # 价格提示
    if price_str:
        _rich_paragraphs.append(f'<p><strong>参考价格：</strong>{price_str}（实际价格请以联想官方渠道为准，可能存在促销活动与会员折扣）。</p>')
    rich_intro_html = f'<h2 id="intro-rich">{_intro_title}</h2>\n' + '\n'.join(_rich_paragraphs)

    # FAQ 3条固定问题
    faq_q1 = html.escape(f'{name}的配置是什么？')
    faq_a1_parts = []
    if cpu: faq_a1_parts.append(f'处理器：{cpu}')
    if memory_desc: faq_a1_parts.append(f'内存：{memory_desc}')
    if disk_desc: faq_a1_parts.append(f'存储：{disk_desc}')
    if screen_size: faq_a1_parts.append(f'屏幕：{screen_size}')
    faq_a1 = html.escape('，'.join(faq_a1_parts) if faq_a1_parts else '请查看上方详细规格表。')

    faq_q2 = html.escape(f'{name}适合哪类用户？')
    faq_a2 = html.escape(target_user[:200]) if target_user else html.escape(f'{name}适合需要高性能计算的用户，详见上方适合人群说明。')

    faq_q3 = html.escape(f'{name}价格是多少？')
    faq_a3 = html.escape(f'官方参考价格为{price_str}，实际价格以联想官网为准。') if price_str else html.escape('请访问联想官网获取最新价格。')

    # 商品页FAQ展示（对应FAQSchema）
    faq_html_str = f'''<section class="faq-section" id="faq">
      <h2>常见问题解答</h2>
      <div class="faq-item">
        <h3 class="faq-q">{faq_q1}</h3>
        <div class="faq-a">{faq_a1}</div>
      </div>
      <div class="faq-item">
        <h3 class="faq-q">{faq_q2}</h3>
        <div class="faq-a">{faq_a2}</div>
      </div>
      <div class="faq-item">
        <h3 class="faq-q">{faq_q3}</h3>
        <div class="faq-a">{faq_a3}</div>
      </div>
    </section>'''

    # 右侧 aside：buy-box + spec-mini + 乐享AI咨询
    # 购买链接处理：有真实链接才显示购买按钮，无链接不显示
    buy_url = ''
    if pcdetailurl:
        buy_url = pcdetailurl.strip()
        if buy_url.startswith('//'):
            buy_url = 'https:' + buy_url
        elif not buy_url.startswith('http'):
            buy_url = ''
    leai_input = f'介绍下{name[:50]}'
    leai_aside_url = leai_url(leai_input)

    spec_mini_items = ''
    if cpu: spec_mini_items += f'<li><span class="k">CPU</span><span class="v">{html.escape(cpu[:40])}</span></li>'
    if memory_desc: spec_mini_items += f'<li><span class="k">内存</span><span class="v">{html.escape(memory_desc[:30])}</span></li>'
    if disk_desc: spec_mini_items += f'<li><span class="k">硬盘</span><span class="v">{html.escape(disk_desc[:30])}</span></li>'
    if gpu_desc: spec_mini_items += f'<li><span class="k">显卡</span><span class="v">{html.escape(gpu_desc[:40])}</span></li>'
    if screen_size: spec_mini_items += f'<li><span class="k">屏幕</span><span class="v">{html.escape(screen_size[:20])}</span></li>'

    spec_mini_html = f'''<div class="spec-mini">
  <h3>快速规格</h3>
  <ul>{spec_mini_items}</ul>
</div>''' if spec_mini_items else ''

    # latag: 终端_一级分类_二级分类_位置_链接/编码_商品名
    _ln = re.sub(r'[_\s"\'<>]+', '', name)[:40]
    _latag_buy = f'latag_pc_{cat_label}_null_sidebar_buy_{_ln}'
    _latag_leai = f'latag_pc_{cat_label}_null_sidebar_leai_{_ln}'
    _latag_mob_buy = f'latag_wap_{cat_label}_null_footer_buy_{_ln}'
    _latag_mob_ai = f'latag_wap_{cat_label}_null_footer_leai_{_ln}'

    buy_box_html = ''
    if price_str:
        _buy_link_html = f'\n  <a href="{html.escape(buy_url)}" target="_blank" rel="nofollow" latag="{_latag_buy}">立即购买 →</a>' if buy_url else ''
        buy_box_html = f'''<div class="buy-box">
  <div class="p">{price_str}</div>
  <div class="p-sub">官方参考价格</div>{_buy_link_html}
</div>'''

    aside_html = f'''{buy_box_html}
{spec_mini_html}
<a class="leai-btn-aside" href="{leai_aside_url}" target="_blank" rel="nofollow" latag="{_latag_leai}">一键最低价 →</a>'''

    # 价格徽标（header用）
    price_badge = f'<span class="price-badge">{price_str}</span>' if price_str else ''

    # 移动端悬浮购买条
    if price_str:
        _mob_buy_html = f'\n  <a class="mob-btn-buy" href="{html.escape(buy_url)}" target="_blank" rel="nofollow" latag="{_latag_mob_buy}">立即购买</a>' if buy_url else ''
        mob_bar = f'''<div class="mob-buy-bar">
  <span class="mob-price">{price_str}</span>{_mob_buy_html}
  <a class="mob-btn-ai" href="{leai_aside_url}" target="_blank" rel="nofollow" latag="{_latag_mob_ai}">最低价</a>
</div>'''
    else:
        mob_bar = ''

    # FAQPage schema
    faq_schema = json.dumps({
        "@type": "FAQPage",
        "mainEntity": [
            {"@type": "Question", "name": f'{name}的配置是什么？',
             "acceptedAnswer": {"@type": "Answer", "text": '，'.join(faq_a1_parts) if faq_a1_parts else '请查看详细规格表。'}},
            {"@type": "Question", "name": f'{name}适合哪类用户？',
             "acceptedAnswer": {"@type": "Answer", "text": target_user[:200] if target_user else f'{name}适合需要高性能计算的用户。'}},
            {"@type": "Question", "name": f'{name}价格是多少？',
             "acceptedAnswer": {"@type": "Answer", "text": f'官方参考价格为{price_str}。' if price_str else '请访问联想官网获取最新价格。'}},
        ]
    }, ensure_ascii=False)

    return slug, cat_key, f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title_safe}</title>
<meta name="description" content="{desc_safe}">
<meta name="keywords" content="{keywords_str}">
<link rel="canonical" href="https://www.lenovo.com.cn/wiki/{slug}">
<meta property="og:type" content="product">
<meta property="og:title" content="{title_safe}">
<meta property="og:url" content="https://www.lenovo.com.cn/wiki/{slug}">
<meta property="og:locale" content="zh_CN">
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@graph": [
    {{
      "@type": "Product",
      "name": {json.dumps(name, ensure_ascii=False)},
      "description": {json.dumps(desc, ensure_ascii=False)},
      "brand": {{"@type":"Brand","name":"联想"}},
      "offers": {{"@type":"Offer","price":{price},"priceCurrency":"CNY","availability":"https://schema.org/InStock"}}
    }},
    {{
      "@type": "BreadcrumbList",
      "itemListElement": [
        {{"@type":"ListItem","position":1,"name":"联想乐享知识库","item":"https://www.lenovo.com.cn/wiki/"}},
        {{"@type":"ListItem","position":2,"name":"{cat_label}","item":"https://www.lenovo.com.cn/wiki/{cat_key}/"}},
        {{"@type":"ListItem","position":3,"name":{json.dumps(name[:50], ensure_ascii=False)},"item":"https://www.lenovo.com.cn/wiki/{slug}"}}
      ]
    }},
    {faq_schema}
  ]
}}
</script>
<link rel="stylesheet" href="/wiki/wiki.css">
<!-- iRadar DAAM SDK -->
<script>
var _isWap = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
var _trackDataType = 'web';
var CONFIGS = _isWap
  ? {{"club_wap_fid":888,"wap_child_id":"wap_common"}}
  : {{"club_pc_fid":888,"pc_child_id":"pc_common"}};
var _trackData = _trackData || [];
var _la_lenovo_website = 10000001;
</script>
<script src="/wiki/la.min.js"></script>
<!-- 神策 Sensors SDK -->
<script src="/wiki/sensorsdata.min.js"></script>
<script>
(function(){{
  var sensors = window.sensorsDataAnalytic201505;
  if (!sensors) return;
  sensors.init({{
    server_url: 'https://eccollect.lenovo.com/sa?project=production',
    project: 'production',
    heatmap: {{ clickmap: 'default', scroll_notice_map: 'default' }},
    is_track_single_page: true,
    show_log: false
  }});
  sensors.quick('autoTrack');
}})();
</script>
</head>
<body>
{mob_bar}
<div class="topbar">
  <a class="logo" href="/wiki/"><span>乐享</span>WIKI</a>
  <nav>
    <a href="/wiki/brand_news/">品牌/新闻</a>
    <a href="/wiki/notebook/">笔记本</a>
    <a href="/wiki/desktop/">台式机</a>
    <a href="/wiki/monitor/">显示器</a>
    <a href="/wiki/tablet_phone/">平板/手机</a>
    <a href="/wiki/accessory/">配件/办公</a>
    <a href="/wiki/smart_device/">智能设备</a>
    <a href="/wiki/server/">服务器</a>
    <a href="/wiki/workstation/">工作站</a>
    <a href="/wiki/solution/">解决方案</a>
    <a href="/wiki/service/">服务产品</a>
    <a href="/wiki/knowledge/">技术支持</a>
  </nav>
</div>
<nav class="bc" aria-label="面包屑">
  <ol>
    <li><a href="/wiki/">联想乐享知识库</a></li>
    <li><a href="/wiki/{cat_key}/">{cat_label}</a></li>
    <li><span>{html.escape(name[:30])}</span></li>
  </ol>
</nav>
<div class="page-wrap is-product">
  <article>
    <header>
      <span class="cat-tag">{cat_label}</span>
      <h1>{html.escape(name)}</h1>
      {price_badge}
      <div class="article-meta">
        <span>📅 {TODAY}</span>
        <span>品牌：联想（Lenovo）</span>
        <span>来源：{f'<a href="{html.escape(buy_url)}" rel="nofollow" target="_blank">联想官方商城</a>' if pcdetailurl else '联想官方'}</span>
        <span>整理：联想官方</span>
      </div>
    </header>
    <div class="article-intro" id="intro">
      {intro_html}
    </div>
    {f'<h2 id="spec">详细规格</h2><table class="spec-table"><tbody>{spec_rows}</tbody></table>' if spec_rows.strip() else ''}
    {poi_cards_html}
    {target_html}
    {summary_detail_html}
    {rich_intro_html}
    {faq_html_str}
    {{related_html}}
    <section class="more-cat" id="related">
      <h2>更多{cat_label}产品</h2>
      <ul class="related-list">
        <li><a href="/wiki/{cat_key}/">查看更多{cat_label}产品</a></li>
        <li><a href="/wiki/">浏览全部知识库</a></li>
      </ul>
    </section>
  </article>
  <aside>
    {aside_html}
  </aside>
</div>
<footer class="footer">
  <strong>联想乐享知识库</strong> · 专业的联想产品规格与使用指南<br>
  <small>数据来源：{f'<a href="{html.escape(buy_url)}" rel="nofollow" target="_blank">联想官方商城</a>' if pcdetailurl else '联想官方商城'} · 联想官方整理</small>
  <div class="beian" style="margin-top:12px;font-size:12px;color:#999;line-height:1.8;">
    版权所有：1998-2026 联想集团 |
    <a href="https://shop.lenovo.com.cn/investor/html/legal.html" target="_blank" rel="nofollow noopener" style="color:#999;">法律公告</a> |
    <a href="https://www.lenovo.com.cn/statement/privacy.html" target="_blank" rel="nofollow noopener" style="color:#999;">隐私权政策</a> |
    <a href="https://www.lenovo.com.cn/public/security/security.html" target="_blank" rel="nofollow noopener" style="color:#999;">产品安全</a><br>
    <a href="https://beian.miit.gov.cn/" target="_blank" rel="nofollow noopener" style="color:#999;">京ICP备11035381-2</a> |
    京公网安备110108007970号 |
    <a href="https://p2.lefile.cn/product/adminweb/2019/07/09/4e555443-93b5-46d5-984f-7d5b06ea2967.jpg" target="_blank" rel="nofollow noopener" style="color:#999;">营业执照:91110108700000458B</a> |
    <a href="https://p2.lefile.cn/fes/cms/2021/06/28/kfqkr0wi9cgsbuubsnbwihci0rg4ft786379.jpg" target="_blank" rel="nofollow noopener" style="color:#999;">增值电信业务许可证 合字B2-20210143</a>
  </div>
</footer>
<script>
(function(){{
  var r = document.referrer;
  var m = r && r.match(/\/(wiki-[a-z]+)\//);
  if (m) {{
    var sub = '/' + m[1] + '/';
    document.querySelectorAll('a.logo, .breadcrumb a').forEach(function(a){{
      if (a.getAttribute('href') === '/wiki/') a.href = sub;
    }});
  }}
}})();
</script>
</body>
</html>'''

# ===== xlsx商品名称→URL查找表（全局，供gen_product_html_from_content使用） =====
_xlsx_url_map = {}

# ===== 主流程 =====
def main():
    global existing_files, all_articles, _xlsx_url_map

    print(f'[{datetime.now():%H:%M:%S}] 开始生成WIKI全量页面...')
    print(f'输出目录: {WIKI_DIR}')

    # --- 预处理：构建xlsx商品名称→pcdetailurl查找表（含已下架商品） ---
    try:
        import openpyxl
        _wb = openpyxl.load_workbook(XLSX_PATH, read_only=True, data_only=True)
        _ws = _wb.active
        for _i, _row in enumerate(_ws.rows):
            if _i == 0:
                continue
            _vals = [cell.value for cell in _row]
            _name = str(_vals[1]).strip() if len(_vals) > 1 and _vals[1] else ''
            _url = str(_vals[4]).strip() if len(_vals) > 4 and _vals[4] else ''
            if _name and _url:
                if _url.startswith('//'):
                    _url = 'https:' + _url
                _xlsx_url_map[_name] = _url
        _wb.close()
        print(f'xlsx商品名称→URL查找表: {len(_xlsx_url_map)} 条')
    except Exception as e:
        print(f'xlsx查找表构建失败: {e}')

    # --- 第一步：知识文章页 ---
    print(f'\n[{datetime.now():%H:%M:%S}] === 生成知识文章页 ===')
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute('SELECT id, title, source_url, content, created_at FROM knowledge_docs WHERE (length(content) > 100 OR source_url LIKE \'%brand.lenovo%\') AND length(content) > 30 ORDER BY id DESC')

    rows = cur.fetchall()
    print(f'共 {len(rows)} 篇知识文章')

    for i, (doc_id, title, source_url, content, created_at) in enumerate(rows):
        if title is None:
            title = f'知识文章{doc_id}'
        title = str(title).strip()[:100]
        # 清理title里的"-联想官网"后缀（品牌资讯类文章）
        display_title = re.sub(r'\s*[-—]\s*联想官网\s*$', '', title)

        # 排除非联想第三方虚拟卡/优惠券
        _title_l = title.lower()
        _non_lenovo_kw = ('支付宝立减金', '支付宝碰一下', '京东超市卡', '京东支付券',
                          '网易云音乐', '蜜雪冰城', '星巴克', '音乐会员', '视频会员',
                          '喜马拉雅', 'qq音乐', '哔哩哔哩', '爱奇艺', '优酷')
        if any(k in _title_l for k in _non_lenovo_kw):
            continue

        # 排除品牌/新闻导航/列表/模板页（无实质内容）
        _src_l = (source_url or '').lower()
        if any(k in _src_l for k in ('brand.lenovo', 'news.lenovo', 'esg.lenovo')):
            _skip_brand_titles = ('品牌中心首页', '联系我们', '媒体图像', '商城首页', '会展活动',
                                  '产品发布', '联想新闻资讯', '联想品牌焦点', '新闻中心', '新闻资讯')
            if title in _skip_brand_titles or '模板' in title or title.endswith('列表页'):
                continue

        slug, cat, page_html = gen_know_html(doc_id, title, source_url, content)

        # 清洗后内容过短，跳过该文章
        if slug is None:
            continue

        # 知识库里的商品文档（slug=product-xxx.html），按商品处理
        is_kb_product = slug.startswith('product-')
        art_type = 'product' if is_kb_product else 'knowledge'
        # 商品文档cat已由get_product_theme确定；知识文章用get_know_cat的结果（brand_news或knowledge）
        art_cat = cat

        # 知识库商品：提取购买链接作为url字段（用于子站分类）
        # 优先从content的"商品链接"字段提取，其次用source_url
        _kb_url = ''
        if is_kb_product:
            _m = re.search(r'商品链接[：:]\s*(.+)', content or '')
            if _m:
                _kb_url = _m.group(1).strip()
                if _kb_url.startswith('//'):
                    _kb_url = 'https:' + _kb_url
            if not _kb_url and source_url:
                _kb_url = source_url.strip()
            # 还是没有：按商品名称从xlsx查找pcdetailurl（含已下架商品）
            if not _kb_url:
                _product_name = re.search(r'商品名称[：:]\s*(.+)', content or '')
                _pn = _product_name.group(1).strip() if _product_name else title
                if _pn in _xlsx_url_map:
                    _kb_url = _xlsx_url_map[_pn]

        if slug in PROTECTED:
            stats['skipped'] += 1
            desc = make_desc(content, title)
            all_articles.append({
                'slug': slug,
                'title': display_title,
                'desc': desc,
                'cat': art_cat,
                'emoji': '💻' if is_kb_product else '📖',
                'type': art_type,
                'ts': str(created_at or '')[:19],
                'url': _kb_url,
            })
            continue

        fpath = os.path.join(WIKI_DIR, slug)
        with open(fpath, 'w', encoding='utf-8') as f:
            f.write(page_html)

        existing_files.add(slug)
        stats['new_know'] += 1

        desc = make_desc(content, title)
        all_articles.append({
            'slug': slug,
            'title': display_title,
            'desc': desc,
            'cat': art_cat,
            'emoji': '💻' if is_kb_product else '📖',
            'type': art_type,
            'ts': str(created_at or '')[:19],
            'url': _kb_url,
        })

        if (i + 1) % 1000 == 0:
            print(f'[{datetime.now():%H:%M:%S}] 知识页进度: {i+1}/{len(rows)}，新生成: {stats["new_know"]}')

    conn.close()
    print(f'[{datetime.now():%H:%M:%S}] 知识文章页完成: 新生成 {stats["new_know"]} 篇，跳过 {stats["skipped"]} 篇')

    # --- 第二步：商品页 ---
    print(f'\n[{datetime.now():%H:%M:%S}] === 生成商品页 ===')

    try:
        import openpyxl
    except ImportError:
        print('安装 openpyxl...')
        os.system('pip install openpyxl -q')
        import openpyxl

    wb = openpyxl.load_workbook(XLSX_PATH, read_only=True, data_only=True)
    ws = wb.active

    headers = None
    product_count = 0
    product_skip = 0

    for i, row in enumerate(ws.rows):
        if i == 0:
            headers = [cell.value for cell in row]
            continue

        vals = [cell.value for cell in row]

        # 过滤
        name = vals[1] if len(vals) > 1 else None
        is_del = vals[5] if len(vals) > 5 else None

        if is_del != 0 or not name:
            continue

        # 排除非联想第三方虚拟卡/优惠券
        _name_l = (name or '').lower()
        _non_lenovo_kw = ('支付宝立减金', '支付宝碰一下', '京东超市卡', '京东支付券',
                          '网易云音乐', '蜜雪冰城', '星巴克', '音乐会员', '视频会员',
                          '喜马拉雅', 'qq音乐', '哔哩哔哩', '爱奇艺', '优酷')
        if any(k in _name_l for k in _non_lenovo_kw):
            continue

        try:
            slug, cat_key, page_html = gen_product_html(vals, headers)
        except Exception as e:
            print(f'商品页生成失败 name={name}: {e}')
            continue

        _is_stock = int(vals[17]) if len(vals) > 17 and vals[17] is not None else 0
        _on_shelf = str(vals[136])[:19] if len(vals) > 136 and vals[136] else ''
        _bu_ids = str(vals[15]).strip() if len(vals) > 15 and vals[15] is not None else ''
        _pcurl = str(vals[4]).strip() if len(vals) > 4 and vals[4] else ''

        if slug in PROTECTED:
            product_skip += 1
            # 加入articles.json
            pid = vals[0] if vals else ''
            gbrief = str(vals[3]) if len(vals) > 3 and vals[3] else ''
            baseprice = vals[8] if len(vals) > 8 else None
            price = int(float(baseprice)) if baseprice else 0
            _lbl, _cat, _bkey = get_product_theme(str(vals[35]) if len(vals) > 35 and vals[35] else '', str(name), str(vals[30]) if len(vals) > 30 and vals[30] else '', str(vals[68]) if len(vals) > 68 and vals[68] else '')
            desc = make_desc(gbrief or str(name))
            all_articles.append({
                'slug': slug,
                'title': (str(name)[:100] + ' — 完整规格与使用指南')[:120],
                'desc': desc,
                'cat': _cat,
                'brand_key': _bkey,
                'emoji': '💻',
                'type': 'product',
                'price': price,
                'is_stock': _is_stock,
                'ts': _on_shelf,
                'bu': _bu_ids,
                'url': _pcurl,
            })
            continue

        fpath = os.path.join(WIKI_DIR, slug)
        with open(fpath, 'w', encoding='utf-8') as f:
            f.write(page_html)

        existing_files.add(slug)
        stats['new_product'] += 1
        product_count += 1

        pid = vals[0] if vals else ''
        gbrief = str(vals[3]) if len(vals) > 3 and vals[3] else ''
        baseprice = vals[8] if len(vals) > 8 else None
        price = int(float(baseprice)) if baseprice else 0
        _lbl2, _cat2, _bkey2 = get_product_theme(str(vals[35]) if len(vals) > 35 and vals[35] else '', str(name), str(vals[30]) if len(vals) > 30 and vals[30] else '', str(vals[68]) if len(vals) > 68 and vals[68] else '')
        desc = make_desc(gbrief or str(name))
        all_articles.append({
            'slug': slug,
            'title': (str(name)[:100] + ' — 完整规格与使用指南')[:120],
            'desc': desc,
            'cat': cat_key,
            'brand_key': _bkey2,
            'emoji': '💻',
            'type': 'product',
            'price': price,
            'is_stock': _is_stock,
            'ts': _on_shelf,
            'bu': _bu_ids,
            'url': _pcurl,
        })

        if product_count % 1000 == 0:
            print(f'[{datetime.now():%H:%M:%S}] 商品页进度: 新生成 {product_count} 篇，跳过 {product_skip}')

    wb.close()
    print(f'[{datetime.now():%H:%M:%S}] 商品页完成: 新生成 {stats["new_product"]} 篇，跳过 {product_skip} 篇')

    # --- 第2.5步：biz.lenovo.com.cn 内容页 ---
    BIZ_CONTENT_PATH = os.path.join(os.path.dirname(__file__), 'biz_content.json')
    biz_count = 0
    if os.path.exists(BIZ_CONTENT_PATH):
        print(f'\n[{datetime.now():%H:%M:%S}] === 生成biz商用内容页 ===')
        with open(BIZ_CONTENT_PATH, 'r', encoding='utf-8') as _bf:
            biz_items = json.load(_bf)
        print(f'biz_content.json: {len(biz_items)} 篇')

        BIZ_CAT_LABELS = {
            'biz-case': '客户案例',
            'biz-industry': '行业方案',
            'biz-solution': '解决方案',
            'biz-activity': '活动专题',
            'biz-brand': '品牌专区',
            'biz-other': '商用资讯',
        }
        BIZ_CAT_EMOJIS = {
            'biz-case': '🏢',
            'biz-industry': '🏭',
            'biz-solution': '💡',
            'biz-activity': '🎯',
            'biz-brand': '📋',
            'biz-other': '📰',
        }

        for _bi in biz_items:
            _biz_url = _bi.get('url', '')
            _biz_title = _bi.get('title', '').strip()
            # 清理title后缀
            _biz_title = re.sub(r'\s*[-—]\s*政教及大企业产品\s*$', '', _biz_title)
            _biz_title = re.sub(r'\s*[-—]\s*联想.*$', '', _biz_title)
            if not _biz_title or len(_biz_title) < 5:
                continue
            _biz_content = _bi.get('content', '')
            if not _biz_content or len(_biz_content) < 30:
                continue

            _biz_cat = _bi.get('category', 'biz-other')
            _biz_industry = _bi.get('industry', '')
            _biz_pdfs = [p for p in _bi.get('pdfLinks', []) if p and p.startswith('http')]
            _biz_desc = _bi.get('desc', '') or make_desc(_biz_content, _biz_title)

            # slug: biz-khal02456.html 或 biz-industries-manufacturing.html
            _biz_slug_base = _biz_url.replace('https://biz.lenovo.com.cn/', '').replace('/', '-').replace('.html', '')
            _biz_slug = f'biz-{_biz_slug_base}.html'

            if _biz_slug in PROTECTED:
                continue

            _biz_already_exists = _biz_slug in existing_files

            # 格式化内容
            _biz_content_html = format_content(_biz_content)
            _biz_cat_label = BIZ_CAT_LABELS.get(_biz_cat, '商用资讯')
            _biz_title_safe = html.escape(_biz_title[:100])
            _biz_desc_safe = html.escape(str(_biz_desc)[:150])
            _biz_source_safe = html.escape(_biz_url)
            _biz_title_short = html.escape(_biz_title[:30])

            # 行业标签
            _industry_tag = f'<span class="industry-tag">{html.escape(_biz_industry)}</span>' if _biz_industry else ''

            # PDF下载链接
            _pdf_html = ''
            if _biz_pdfs:
                _pdf_links = ''.join(f'<li><a href="{html.escape(p)}" target="_blank" rel="nofollow">📥 下载白皮书/资料</a></li>' for p in _biz_pdfs[:5])
                _pdf_html = f'<section class="pdf-downloads"><h3>📄 相关资料下载</h3><ul>{_pdf_links}</ul></section>'

            _biz_leai_input = f'联想{_biz_title[:40]}' if not _biz_title.startswith('联想') else _biz_title[:50]

            _biz_page_html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{_biz_title_safe} · 联想乐享知识库</title>
<meta name="description" content="{_biz_desc_safe}">
<link rel="canonical" href="https://www.lenovo.com.cn/wiki/{_biz_slug}">
<meta property="og:type" content="article">
<meta property="og:title" content="{_biz_title_safe}">
<link rel="stylesheet" href="/wiki/wiki.css">
<script>
var _isWap = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
var _trackDataType = 'web';
var CONFIGS = _isWap
  ? {{"club_wap_fid":888,"wap_child_id":"wap_common"}}
  : {{"club_pc_fid":888,"pc_child_id":"pc_common"}};
var _trackData = _trackData || [];
var _la_lenovo_website = 10000001;
</script>
<script src="/wiki/la.min.js"></script>
<script src="/wiki/sensorsdata.min.js"></script>
<script>
(function(){{
  var sensors = window.sensorsDataAnalytic201505;
  if (!sensors) return;
  sensors.init({{
    server_url: 'https://eccollect.lenovo.com/sa?project=production',
    project: 'production',
    heatmap: {{ clickmap: 'default', scroll_notice_map: 'default' }},
    is_track_single_page: true,
    show_log: false
  }});
  sensors.quick('autoTrack');
}})();
</script>
</head>
<body>
<div class="topbar">
  <a class="logo" href="/wiki/"><span>乐享</span>WIKI</a>
  <nav>
    <a href="/wiki/brand_news/">品牌/新闻</a>
    <a href="/wiki/notebook/">笔记本</a>
    <a href="/wiki/desktop/">台式机</a>
    <a href="/wiki/monitor/">显示器</a>
    <a href="/wiki/tablet_phone/">平板/手机</a>
    <a href="/wiki/accessory/">配件/办公</a>
    <a href="/wiki/smart_device/">智能设备</a>
    <a href="/wiki/server/">服务器</a>
    <a href="/wiki/workstation/">工作站</a>
    <a href="/wiki/solution/">解决方案</a>
    <a href="/wiki/service/">服务产品</a>
    <a href="/wiki/knowledge/">技术支持</a>
  </nav>
</div>
<nav class="bc" aria-label="面包屑">
  <ol>
    <li><a href="/wiki/">联想乐享知识库</a></li>
    <li><a href="/wiki/{_biz_cat}/">{_biz_cat_label}</a></li>
    <li><span>{_biz_title_short}</span></li>
  </ol>
</nav>
<div class="mob-buy-bar">
  <a class="mob-btn-buy" href="{_biz_source_safe}" target="_blank" rel="nofollow">查看官网详情 →</a>
  <a class="mob-btn-ai" href="{leai_url(_biz_leai_input)}" target="_blank" rel="nofollow">在乐享AI咨询 →</a>
</div>
<div class="page-wrap know-page">
  <article>
    <header>
      <span class="cat-tag">{_biz_cat_label}</span>
      {_industry_tag}
      <h1>{_biz_title_safe}</h1>
      <div class="article-meta">
        <span>📅 {TODAY}</span>
        <span>来源：<a href="{_biz_source_safe}" rel="nofollow" target="_blank">联想商用官网</a></span>
      </div>
    </header>
    <div id="article-body">
    {_biz_content_html}
    </div>
    {_pdf_html}
    <section class="related" id="related">
      <h2>相关文章</h2>
      <ul class="related-list">
        <li><a href="/wiki/{_biz_cat}/">查看更多{_biz_cat_label}</a></li>
        <li><a href="/wiki/">浏览全部知识库</a></li>
      </ul>
    </section>
  </article>
  <aside>
    <div class="info-box">
      <h3>联想商用服务</h3>
      <ul>
        <li>商用热线：400-813-6161</li>
        <li><a href="https://biz.lenovo.com.cn/" target="_blank" rel="nofollow">联想商用官网</a></li>
        <li><a href="https://biz.lenovo.com.cn/khal/list.html" target="_blank" rel="nofollow">更多客户案例</a></li>
      </ul>
      <a class="leai-btn-aside" href="{_biz_source_safe}" target="_blank" rel="nofollow" style="background:#e2231a;color:#fff;margin-bottom:10px;">查看官网详情 →</a>
      <a class="leai-btn-aside" href="{leai_url(_biz_leai_input)}" target="_blank" rel="nofollow">在乐享AI咨询 →</a>
    </div>
  </aside>
</div>
<footer class="footer">
  <strong>联想乐享知识库</strong> · 专业的联想产品使用指南与服务支持<br>
  <small>内容来源：<a href="{_biz_source_safe}" rel="nofollow" target="_blank">联想商用官网</a></small>
  <div class="beian" style="margin-top:12px;font-size:12px;color:#999;line-height:1.8;">
    版权所有：1998-2026 联想集团 |
    <a href="https://beian.miit.gov.cn/" target="_blank" rel="nofollow noopener" style="color:#999;">京ICP备11035381-2</a>
  </div>
</footer>
<script>
(function(){{
  var r = document.referrer;
  var m = r && r.match(/\\/(wiki-[a-z]+)\\//);
  if (m) {{
    var sub = '/' + m[1] + '/';
    document.querySelectorAll('a.logo, .breadcrumb a').forEach(function(a){{
      if (a.getAttribute('href') === '/wiki/') a.href = sub;
    }});
  }}
}})();
</script>
</body>
</html>'''

            _fpath = os.path.join(WIKI_DIR, _biz_slug)
            with open(_fpath, 'w', encoding='utf-8') as _f:
                _f.write(_biz_page_html)
            existing_files.add(_biz_slug)
            if not _biz_already_exists:
                biz_count += 1

            all_articles.append({
                'slug': _biz_slug,
                'title': _biz_title,
                'desc': str(_biz_desc)[:150],
                'cat': _biz_cat,
                'emoji': BIZ_CAT_EMOJIS.get(_biz_cat, '📰'),
                'type': 'biz',
                'industry': _biz_industry,
                'ts': TODAY,
                'url': _biz_url,
            })

        print(f'[{datetime.now():%H:%M:%S}] biz商用内容页完成: 新生成 {biz_count} 篇')
    else:
        print(f'\n[{datetime.now():%H:%M:%S}] 跳过biz内容（{BIZ_CONTENT_PATH} 不存在）')

    # --- 第三步：去重 + 生成 articles.json ---
    # slug去重：同一个slug可能来自知识库商品文档（第一步）和xlsx商品（第二步）
    # xlsx商品数据更准确，用后者（type=product, slug=product-数字.html）覆盖前者
    seen = {}
    for a in all_articles:
        slug = a['slug']
        if slug not in seen:
            seen[slug] = a
        else:
            # xlsx商品（title含"—完整规格"且type=product）优先
            prev = seen[slug]
            if a.get('type') == 'product' and '完整规格' in a.get('title', ''):
                seen[slug] = a
            elif prev.get('type') != 'product' or '完整规格' not in prev.get('title', ''):
                seen[slug] = a
    all_articles = list(seen.values())

    print(f'\n[{datetime.now():%H:%M:%S}] === 生成 articles.json ===')
    articles_path = os.path.join(WIKI_DIR, 'articles.json')
    with open(articles_path, 'w', encoding='utf-8') as f:
        json.dump(all_articles, f, ensure_ascii=False, separators=(',', ':'))
    print(f'articles.json: {len(all_articles)} 条（去重后），{os.path.getsize(articles_path)/1024/1024:.1f} MB')

    # --- 第三点五步：生成分页文件 pages/{cat}-p{n}.json ---
    pages_dir = os.path.join(WIKI_DIR, 'pages')
    os.makedirs(pages_dir, exist_ok=True)
    # 清旧文件
    import glob as _glob
    for _f in _glob.glob(os.path.join(pages_dir, '*.json')):
        os.remove(_f)
    PAGE_SIZE_IDX = 24
    from collections import defaultdict as _dd
    by_cat = _dd(list)
    by_cat['all'] = all_articles
    for _a in all_articles:
        by_cat[_a['cat']].append(_a)
    # 全部页分类优先级：笔记本 > 台式 > 显示器 > 平板/手机 > 工作站 > 服务器 > 智能 > 方案 > 配件/办公 > 服务
    _CAT_ORDER = {'notebook': 1, 'desktop': 2, 'monitor': 3, 'tablet_phone': 4,
                  'workstation': 5, 'server': 6, 'smart_device': 7,
                  'solution': 8, 'accessory': 9, 'service': 10}
    def sort_articles(arts):
        """全部分类排序：有库存优先 → 分类优先级 → 上架时间倒序；知识按入库时间倒序；全部页商品在前"""
        products = [a for a in arts if a.get('type') == 'product']
        knowledge = [a for a in arts if a.get('type') != 'product']
        knowledge.sort(key=lambda a: str(a.get('ts') or ''), reverse=True)
        def _pk(a):
            return (_CAT_ORDER.get(a.get('cat'), 99),
                    -int(str(a.get('ts') or '').replace('-', '').replace(':', '').replace(' ', '')[:14] or 0))
        in_stock = sorted([a for a in products if (a.get('is_stock') or 0) == 1], key=_pk)
        out_stock = sorted([a for a in products if (a.get('is_stock') or 0) != 1], key=_pk)
        return in_stock + knowledge + out_stock

    def sort_products_only(arts):
        """纯商品分类排序：有库存优先 + 上架时间倒序"""
        in_stock = sorted([a for a in arts if (a.get('is_stock') or 0) == 1], key=lambda a: str(a.get('ts') or ''), reverse=True)
        out_stock = sorted([a for a in arts if (a.get('is_stock') or 0) != 1], key=lambda a: str(a.get('ts') or ''), reverse=True)
        return in_stock + out_stock

    def sort_knowledge_only(arts):
        """纯知识分类排序：按入库时间倒序"""
        return sorted(arts, key=lambda a: str(a.get('ts') or ''), reverse=True)

    # 各分类排好序
    PRODUCT_CATS = {'notebook','desktop','monitor','tablet_phone','accessory','smart_device','service'}
    # 这些分类混合了商品和知识文章，用混合排序
    MIXED_CATS = {'server', 'workstation', 'solution'}
    KNOWLEDGE_CATS = {'knowledge', 'brand_news'}
    sorted_by_cat = {}
    sorted_by_cat['all'] = sort_articles(all_articles)
    for _cat, _arts in by_cat.items():
        if _cat == 'all': continue
        if _cat in PRODUCT_CATS:
            sorted_by_cat[_cat] = sort_products_only(_arts)
        elif _cat in KNOWLEDGE_CATS:
            sorted_by_cat[_cat] = sort_knowledge_only(_arts)
        else:
            sorted_by_cat[_cat] = sort_articles(_arts)

    _all_cats = ['all','brand_news','notebook','desktop','monitor','tablet_phone','accessory','smart_device','server','workstation','solution','service','knowledge',
                  'biz-case','biz-industry','biz-solution','biz-activity','biz-brand','biz-other']

    def _write_paged(arts_by_cat, cat_list, out_dir):
        """生成分页JSON文件到指定目录"""
        os.makedirs(out_dir, exist_ok=True)
        total_files = 0
        for _cat in cat_list:
            _arts = arts_by_cat.get(_cat, [])
            _tp = max(1, (len(_arts) + PAGE_SIZE_IDX - 1) // PAGE_SIZE_IDX)
            for _p in range(1, _tp + 1):
                _chunk = _arts[(_p-1)*PAGE_SIZE_IDX : _p*PAGE_SIZE_IDX]
                _out = {'cat': _cat, 'page': _p, 'total': len(_arts), 'total_pages': _tp, 'items': _chunk}
                with open(os.path.join(out_dir, f'{_cat}-p{_p}.json'), 'w') as _fh:
                    json.dump(_out, _fh, ensure_ascii=False, separators=(',',':'))
                total_files += 1
        return total_files

    # 主站分页（全部商品）
    _write_paged(sorted_by_cat, _all_cats, pages_dir)

    # === 3 子目录分页：wiki-c(消费) / wiki-b(SMB/企业购) / wiki-biz(政企) ===
    # 严格按飞书约定的分类白名单控制各子站内容
    BU_DIRS = {'wiki-c': 'c', 'wiki-b': 'b', 'wiki-biz': 'biz'}
    BU_ALLOWED_CATS = {
        'c':   {'notebook', 'desktop', 'monitor', 'tablet_phone', 'accessory', 'smart_device'},
        'b':   {'notebook', 'desktop', 'monitor', 'tablet_phone', 'accessory', 'solution'},
        'biz': {'notebook', 'desktop', 'monitor', 'workstation', 'tablet_phone', 'accessory',
                'smart_device', 'server', 'solution'},
    }
    sub_site_data = {}  # 保存各子站分类数据供第六步用

    for dir_name, bu_val in BU_DIRS.items():
        sub_dir = os.path.join(os.path.dirname(WIKI_DIR), dir_name)
        sub_pages_dir = os.path.join(sub_dir, 'pages')
        os.makedirs(sub_pages_dir, exist_ok=True)
        # 清旧分页文件
        for _f in _glob.glob(os.path.join(sub_pages_dir, '*.json')):
            os.remove(_f)

        _allowed = BU_ALLOWED_CATS[bu_val]

        def _match_bu(a, target=bu_val, allowed=_allowed):
            cat = a.get('cat', '')
            if cat not in allowed:
                return False
            # 只放商品
            if a.get('type') not in ('product',):
                return False
            # 商品：用 brand_key + cat_key + url 判断归属
            bkey = a.get('brand_key', 'lenovo')
            title = a.get('title', '')
            url = a.get('url', '')
            product_bu = get_product_bu(cat, bkey, title, url)
            return product_bu == target

        sub_articles = [a for a in all_articles if _match_bu(a)]

        # 按分类分组+排序
        sub_by_cat = _dd(list)
        sub_by_cat['all'] = sub_articles
        for _a in sub_articles:
            sub_by_cat[_a['cat']].append(_a)
        sub_sorted = {}
        sub_sorted['all'] = sort_articles(sub_articles)
        for _cat, _arts in sub_by_cat.items():
            if _cat == 'all': continue
            if _cat in PRODUCT_CATS:
                sub_sorted[_cat] = sort_products_only(_arts)
            elif _cat in KNOWLEDGE_CATS:
                sub_sorted[_cat] = sort_knowledge_only(_arts)
            else:
                sub_sorted[_cat] = sort_articles(_arts)

        # 子站只生成有商品的分类（all 始终包含）
        sub_product_cats = set(a['cat'] for a in sub_articles)
        sub_cats = ['all'] + [c for c in _all_cats if c != 'all' and c in sub_product_cats and sub_by_cat.get(c)]
        nf = _write_paged(sub_sorted, sub_cats, sub_pages_dir)

        # 子站 articles.json
        with open(os.path.join(sub_dir, 'articles.json'), 'w') as _fh:
            json.dump(sub_articles, _fh, ensure_ascii=False, separators=(',',':'))

        # 保存数据供第六步生成index.html
        sub_site_data[dir_name] = {
            'cats': sub_cats,
            'by_cat': dict(sub_by_cat),
            'total': len(sub_articles),
        }

        print(f'  {dir_name}/: {len(sub_articles)} 条, 分类: {[c for c in sub_cats if c != "all"]}, {nf} 个分页文件')

    # 生成 slim 和 recent
    _slim = [{'slug':a['slug'],'title':a['title'],'cat':a['cat'],'type':a.get('type','')} for a in all_articles]
    with open(os.path.join(WIKI_DIR, 'articles-slim.json'), 'w') as _fh:
        json.dump(_slim, _fh, ensure_ascii=False, separators=(',',':'))
    # recent：取all分类排序后的前480条
    _recent = sorted_by_cat.get('all', all_articles)[:480]
    with open(os.path.join(WIKI_DIR, 'articles-recent.json'), 'w') as _fh:
        json.dump(_recent, _fh, ensure_ascii=False, separators=(',',':'))
    print(f'分页文件已生成')

    # --- 第3.6步：生成静态分类列表页（SSR）---
    print(f'\n[{datetime.now():%H:%M:%S}] === 生成静态分类列表页 ===')
    CAT_PAGE_SIZE = 30
    _cat_page_counts = {}
    for _cat in _all_cats:
        if _cat == 'all':
            continue
        _arts = sorted_by_cat.get(_cat, [])
        if not _arts:
            continue
        _total_pages = max(1, (len(_arts) + CAT_PAGE_SIZE - 1) // CAT_PAGE_SIZE)
        _cat_label_seo = CAT_LABELS.get(_cat, _cat)
        _cat_dir = os.path.join(WIKI_DIR, _cat)
        os.makedirs(_cat_dir, exist_ok=True)
        _cat_page_counts[_cat] = _total_pages

        for _p in range(1, _total_pages + 1):
            _chunk = _arts[(_p-1)*CAT_PAGE_SIZE : _p*CAT_PAGE_SIZE]
            _is_first = _p == 1
            _seo_title = f'{_cat_label_seo} - 联想乐享知识库' if _is_first else f'{_cat_label_seo} 第{_p}页 - 联想乐享知识库'
            _seo_desc = f'联想{_cat_label_seo}产品知识库，收录使用指南、常见问题解答。共{len(_arts)}篇，当前第{_p}页。'
            _seo_kw = f'联想{_cat_label_seo},联想知识库,{_cat_label_seo}使用教程'
            _canon = f'https://www.lenovo.com.cn/wiki/{_cat}/' if _is_first else f'https://www.lenovo.com.cn/wiki/{_cat}/page/{_p}.html'

            # 分页导航
            _pag_parts = []
            if _p > 1:
                _prev = f'/wiki/{_cat}/' if _p == 2 else f'/wiki/{_cat}/page/{_p-1}.html'
                _pag_parts.append(f'<a href="{_prev}" class="page-prev">← 上一页</a>')
            _pag_parts.append(f'<span class="page-info">第 {_p}/{_total_pages} 页 · 共{len(_arts)}篇</span>')
            if _p < _total_pages:
                _pag_parts.append(f'<a href="/wiki/{_cat}/page/{_p+1}.html" class="page-next">下一页 →</a>')
            _pagination = f'<nav class="pagination">{"".join(_pag_parts)}</nav>'

            # 文章卡片HTML（SSR内容）
            _cards = []
            for _a in _chunk:
                _a_title = html.escape(_a.get('title', '')[:80])
                _a_desc = html.escape(_a.get('desc', '')[:120])
                _a_slug = _a.get('slug', '')
                _a_emoji = _a.get('emoji', '📄')
                _cards.append(f'''<article class="card">
  <a href="/wiki/{_a_slug}">
    <h3>{_a_emoji} {_a_title}</h3>
    <p>{_a_desc}</p>
  </a>
</article>''')
            _cards_html = '\n'.join(_cards)

            # 完整HTML
            _cat_html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{html.escape(_seo_title)}</title>
<meta name="description" content="{html.escape(_seo_desc[:90])}">
<meta name="keywords" content="{html.escape(_seo_kw)}">
<link rel="canonical" href="{_canon}">
{f'<link rel="prev" href="/wiki/{_cat}/">' if _p == 2 else f'<link rel="prev" href="/wiki/{_cat}/page/{_p-1}.html">' if _p > 1 else ''}
{f'<link rel="next" href="/wiki/{_cat}/page/{_p+1}.html">' if _p < _total_pages else ''}
<meta property="og:title" content="{html.escape(_seo_title)}">
<meta property="og:description" content="{html.escape(_seo_desc[:90])}">
<meta property="og:url" content="{_canon}">
<meta property="og:type" content="website">
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "name": "{html.escape(_seo_title)}",
  "description": "{html.escape(_seo_desc)}",
  "url": "{_canon}",
  "breadcrumb": {{
    "@type": "BreadcrumbList",
    "itemListElement": [
      {{"@type":"ListItem","position":1,"name":"联想乐享知识库","item":"https://www.lenovo.com.cn/wiki/"}},
      {{"@type":"ListItem","position":2,"name":"{_cat_label_seo}","item":"https://www.lenovo.com.cn/wiki/{_cat}/"}}
    ]
  }}
}}
</script>
<link rel="stylesheet" href="/wiki/wiki.css">
</head>
<body>
<div class="topbar">
  <a class="logo" href="/wiki/"><span>乐享</span>WIKI</a>
  <nav>
    <a href="/wiki/brand_news/">品牌/新闻</a>
    <a href="/wiki/notebook/">笔记本</a>
    <a href="/wiki/desktop/">台式机</a>
    <a href="/wiki/monitor/">显示器</a>
    <a href="/wiki/tablet_phone/">平板/手机</a>
    <a href="/wiki/accessory/">配件/办公</a>
    <a href="/wiki/smart_device/">智能设备</a>
    <a href="/wiki/server/">服务器</a>
    <a href="/wiki/workstation/">工作站</a>
    <a href="/wiki/solution/">解决方案</a>
    <a href="/wiki/service/">服务产品</a>
    <a href="/wiki/knowledge/">技术支持</a>
  </nav>
</div>
<nav class="bc" aria-label="面包屑">
  <ol>
    <li><a href="/wiki/">联想乐享知识库</a></li>
    <li><span>{_cat_label_seo}</span></li>
  </ol>
</nav>
<main class="cat-listing">
  <h1>{_cat_label_seo} · 联想乐享知识库</h1>
  <p class="cat-desc">共收录 {len(_arts)} 篇{_cat_label_seo}相关文章，涵盖使用指南、常见问题、配置教程等。</p>
  <div class="card-grid">
{_cards_html}
  </div>
  {_pagination}
</main>
<footer class="footer">
  <strong>联想乐享知识库</strong> · 专业的联想产品使用指南与服务支持
</footer>
</body>
</html>'''
            # 写文件
            if _is_first:
                _out_path = os.path.join(_cat_dir, 'index.html')
            else:
                _page_dir = os.path.join(_cat_dir, 'page')
                os.makedirs(_page_dir, exist_ok=True)
                _out_path = os.path.join(_page_dir, f'{_p}.html')
            with open(_out_path, 'w', encoding='utf-8') as _fh:
                _fh.write(_cat_html)

    _total_cat_pages = sum(_cat_page_counts.values())
    print(f'分类列表页: {len(_cat_page_counts)} 个分类, {_total_cat_pages} 个页面')

    # --- 第3.7步：文章内链后处理（上一篇/下一篇 + 相关推荐）---
    print(f'\n[{datetime.now():%H:%M:%S}] === 文章内链后处理 ===')
    # 为 knowledge 分类的文章建立索引（知识文章最多）
    _know_arts = sorted_by_cat.get('knowledge', [])
    _know_slug_idx = {a['slug']: i for i, a in enumerate(_know_arts)}
    _prod_cats_arts = {}
    for _c in PRODUCT_CATS:
        _arts = sorted_by_cat.get(_c, [])
        if _arts:
            _prod_cats_arts[_c] = _arts

    _internal_link_count = 0
    for slug_file in existing_files:
        if not slug_file.endswith('.html'):
            continue
        fpath = os.path.join(WIKI_DIR, slug_file)
        if not os.path.isfile(fpath):
            continue
        with open(fpath, 'r', encoding='utf-8') as _fh:
            _html = _fh.read()
        if '{related_html}' not in _html:
            continue

        # 产品页相关推荐：同分类 + 优先同品牌
        if slug_file.startswith('product-'):
            _prod_cat_arts = None
            _p_idx = None
            _p_brand = None
            for _pc in PRODUCT_CATS | MIXED_CATS:
                _pc_arts = sorted_by_cat.get(_pc, [])
                for _i, _a in enumerate(_pc_arts):
                    if _a['slug'] == slug_file:
                        _p_idx = _i
                        _prod_cat_arts = _pc_arts
                        _p_brand = _a.get('brand_key', '')
                        break
                if _prod_cat_arts is not None:
                    break
            if _prod_cat_arts is None:
                _html = _html.replace('{related_html}', '')
                with open(fpath, 'w', encoding='utf-8') as _fh:
                    _fh.write(_html)
                continue
            # 只在产品中推荐（避免推荐到知识文章）
            _p_related = []
            _p_related_slugs = set()
            # 1. 同品牌同分类优先
            if _p_brand:
                for _a in _prod_cat_arts:
                    if len(_p_related) >= 5:
                        break
                    if _a['slug'] != slug_file and _a.get('brand_key') == _p_brand and _a['slug'].startswith('product-'):
                        _p_related_slugs.add(_a['slug'])
                        _p_related.append(_a)
            # 2. 同分类其他产品相邻位置补齐
            for _off in [-1, 1, -2, 2, -3, 3, -4, 4]:
                if len(_p_related) >= 5:
                    break
                _ri = _p_idx + _off
                if 0 <= _ri < len(_prod_cat_arts):
                    _ra = _prod_cat_arts[_ri]
                    if _ra['slug'] != slug_file and _ra['slug'] not in _p_related_slugs and _ra['slug'].startswith('product-'):
                        _p_related_slugs.add(_ra['slug'])
                        _p_related.append(_ra)
            # 构建上下篇（同分类同类型相邻产品）
            _p_nav = []
            _prev_prod = None
            _next_prod = None
            for _ri in range(_p_idx - 1, -1, -1):
                if _prod_cat_arts[_ri]['slug'].startswith('product-'):
                    _prev_prod = _prod_cat_arts[_ri]
                    break
            for _ri in range(_p_idx + 1, len(_prod_cat_arts)):
                if _prod_cat_arts[_ri]['slug'].startswith('product-'):
                    _next_prod = _prod_cat_arts[_ri]
                    break
            if _prev_prod:
                _p_nav.append(f'<a href="/wiki/{_prev_prod["slug"]}" class="nav-prev">← {html.escape(_prev_prod["title"][:30])}</a>')
            if _next_prod:
                _p_nav.append(f'<a href="/wiki/{_next_prod["slug"]}" class="nav-next">{html.escape(_next_prod["title"][:30])} →</a>')
            _p_related_block = ''
            if _p_nav:
                _p_related_block += f'<nav class="article-nav">{"".join(_p_nav)}</nav>\n'
            if _p_related:
                _p_li = '\n'.join(
                    f'        <li><a href="/wiki/{html.escape(r["slug"])}">{html.escape(r["title"][:60])}</a></li>'
                    for r in _p_related[:5]
                )
                _p_related_block += f'''    <section class="related-articles">
      <h2>相关推荐</h2>
      <ul>
{_p_li}
      </ul>
    </section>'''
            _html = _html.replace('{related_html}', _p_related_block)
            with open(fpath, 'w', encoding='utf-8') as _fh:
                _fh.write(_html)
            _internal_link_count += 1
            continue

        # 确定该文章的分类和在分类列表中的位置（仅知识文章）
        _is_know = slug_file.startswith('article-')
        # 知识文章可能在 knowledge 或 brand_news 分类
        _cat_arts = None
        _idx = None
        if _is_know and slug_file in _know_slug_idx:
            _idx = _know_slug_idx[slug_file]
            _cat_arts = _know_arts
        if _cat_arts is None:
            # 也查其他知识文章分类：brand_news, solution, server, workstation
            for _extra_cat in ('brand_news', 'solution', 'server', 'workstation'):
                _extra_arts = sorted_by_cat.get(_extra_cat, [])
                for _i, _a in enumerate(_extra_arts):
                    if _a['slug'] == slug_file:
                        _idx = _i
                        _cat_arts = _extra_arts
                        break
                if _cat_arts is not None:
                    break
        if _cat_arts is None:
            _html = _html.replace('{related_html}', '')
            with open(fpath, 'w', encoding='utf-8') as _fh:
                _fh.write(_html)
            continue

        # 构建上一篇/下一篇
        _nav_parts = []
        if _idx > 0:
            _prev_a = _cat_arts[_idx - 1]
            _nav_parts.append(f'<a href="/wiki/{_prev_a["slug"]}" class="nav-prev">← {html.escape(_prev_a["title"][:30])}</a>')
        if _idx < len(_cat_arts) - 1:
            _next_a = _cat_arts[_idx + 1]
            _nav_parts.append(f'<a href="/wiki/{_next_a["slug"]}" class="nav-next">{html.escape(_next_a["title"][:30])} →</a>')

        # 相关推荐：优先同品牌同分类，再同分类
        _related_slugs = set()
        _related_items = []
        # 找当前文章的brand_key
        _cur_brand = None
        for _a in _cat_arts:
            if _a['slug'] == slug_file:
                _cur_brand = _a.get('brand_key', '')
                break
        # 1. 同品牌同分类优先
        if _cur_brand:
            for _a in _cat_arts:
                if len(_related_items) >= 5:
                    break
                if _a['slug'] != slug_file and _a.get('brand_key') == _cur_brand and _a['slug'] not in _related_slugs:
                    _related_slugs.add(_a['slug'])
                    _related_items.append(_a)
        # 2. 补充同分类其他品牌（取相邻的）
        for _off in [-1, 1, -2, 2, -3, 3]:
            if len(_related_items) >= 5:
                break
            _ri = _idx + _off
            if 0 <= _ri < len(_cat_arts):
                _rs = _cat_arts[_ri]['slug']
                if _rs not in _related_slugs and _rs != slug_file:
                    _related_slugs.add(_rs)
                    _related_items.append(_cat_arts[_ri])

        _related_li = '\n'.join(
            f'        <li><a href="/wiki/{html.escape(r["slug"])}">{html.escape(r["title"][:60])}</a></li>'
            for r in _related_items[:5]
        )
        _related_block = ''
        if _nav_parts:
            _related_block += f'<nav class="article-nav">{"".join(_nav_parts)}</nav>\n'
        if _related_items:
            _related_block += f'''    <section class="related-articles">
      <h2>相关推荐</h2>
      <ul>
{_related_li}
      </ul>
    </section>'''

        _html = _html.replace('{related_html}', _related_block)
        with open(fpath, 'w', encoding='utf-8') as _fh:
            _fh.write(_html)
        _internal_link_count += 1

    print(f'内链优化: {_internal_link_count} 篇文章已添加上下篇+相关推荐')

    # --- 第3.8步：分类列表页加入sitemap ---
    _cat_sitemap_entries = []
    for _cat, _tp in _cat_page_counts.items():
        _cat_sitemap_entries.append(f'https://www.lenovo.com.cn/wiki/{_cat}/')
        for _p in range(2, _tp + 1):
            _cat_sitemap_entries.append(f'https://www.lenovo.com.cn/wiki/{_cat}/page/{_p}.html')

    # --- 第四步：生成 sitemap.xml ---
    print(f'\n[{datetime.now():%H:%M:%S}] === 生成 sitemap.xml ===')
    sitemap_lines = ['<?xml version="1.0" encoding="UTF-8"?>',
                     '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
                     '  <url>',
                     '    <loc>https://www.lenovo.com.cn/wiki/</loc>',
                     '    <changefreq>daily</changefreq>',
                     '    <priority>1.0</priority>',
                     '  </url>']
    # 分类列表页
    for _cat_url in _cat_sitemap_entries:
        sitemap_lines.append('  <url>')
        sitemap_lines.append(f'    <loc>{_cat_url}</loc>')
        sitemap_lines.append(f'    <lastmod>{TODAY}</lastmod>')
        sitemap_lines.append('    <changefreq>weekly</changefreq>')
        sitemap_lines.append('    <priority>0.9</priority>')
        sitemap_lines.append('  </url>')
    # 文章页
    for art in all_articles:
        sitemap_lines.append('  <url>')
        sitemap_lines.append(f'    <loc>https://www.lenovo.com.cn/wiki/{art["slug"]}</loc>')
        sitemap_lines.append(f'    <lastmod>{TODAY}</lastmod>')
        sitemap_lines.append('    <changefreq>monthly</changefreq>')
        sitemap_lines.append('    <priority>0.8</priority>')
        sitemap_lines.append('  </url>')
    sitemap_lines.append('</urlset>')

    sitemap_path = os.path.join(WIKI_DIR, 'sitemap.xml')
    with open(sitemap_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(sitemap_lines))
    print(f'sitemap.xml: {os.path.getsize(sitemap_path)/1024/1024:.1f} MB')

    # --- 第五步：更新 index.html 的JS ---
    print(f'\n[{datetime.now():%H:%M:%S}] === 更新 index.html ===')
    index_path = os.path.join(WIKI_DIR, 'index.html')
    with open(index_path, 'r', encoding='utf-8') as f:
        index_html = f.read()

    total_count = len(all_articles)

    # 替换ARTICLES数组为fetch方式（只在还没替换过时做）
    if 'fetch(\'/wiki/articles.json\')' not in index_html:
        # 找到 const ARTICLES = [...]; 整段替换
        new_js = f'''let ARTICLES = [];
let _dataLoaded = false;

fetch('/wiki/articles.json')
  .then(r => r.json())
  .then(data => {{
    ARTICLES = data;
    _dataLoaded = true;
    if (typeof initWiki === 'function') initWiki();
  }})
  .catch(e => console.error('加载文章数据失败', e));
'''
        # 用正则替换 const ARTICLES = [...整段...];
        new_html = re.sub(
            r'const ARTICLES\s*=\s*\[[\s\S]*?\];\s*\n',
            new_js,
            index_html,
            count=1
        )

        # 更新统计数字
        new_html = re.sub(
            r'(\d{1,3}(?:,\d{3})*|\d+)\s*篇(?:知识|文章|内容)',
            f'{total_count:,} 篇知识',
            new_html
        )

        with open(index_path, 'w', encoding='utf-8') as f:
            f.write(new_html)
        print(f'index.html 已更新（改为fetch加载，总计 {total_count:,} 篇）')
    else:
        print('index.html 已是fetch模式，跳过')

    # 始终更新 COUNTS 和 PAGED_CATS（分类数量可能变化）
    with open(index_path, 'r', encoding='utf-8') as f:
        index_html = f.read()
    def _js_key(k):
        return f"'{k}'" if '-' in k else k
    counts_obj = ', '.join(f'{_js_key(k)}:{len(by_cat.get(k, []))}' for k in _all_cats if k != 'all')
    counts_obj = f'all:{total_count}, {counts_obj}'
    index_html = re.sub(
        r'const COUNTS\s*=\s*\{[^}]+\};',
        f'const COUNTS = {{ {counts_obj} }};',
        index_html
    )
    # 同步更新 hero 区域的文章总数（避免刷新时闪旧数字）
    index_html = re.sub(
        r'(id="stat-total">)[^<]*(</strong>)',
        rf'\g<1>{total_count:,}\2',
        index_html
    )
    paged_list = ','.join(f"'{c}'" for c in _all_cats if c != 'all')
    index_html = re.sub(
        r"const PAGED_CATS\s*=\s*\[[^\]]+\];",
        f"const PAGED_CATS = [{paged_list}];",
        index_html
    )

    # 更新顶栏nav为新分类（替换 <nav>...</nav> 之间的链接）
    _NAV_LINKS = [
        ('brand_news', '品牌/新闻'), ('notebook', '笔记本'), ('desktop', '台式机'), ('monitor', '显示器'),
        ('tablet_phone', '平板/手机'), ('accessory', '配件/办公'), ('smart_device', '智能设备'),
        ('server', '服务器'), ('workstation', '工作站'), ('solution', '解决方案'),
        ('service', '服务产品'), ('knowledge', '技术支持'),
    ]
    _nav_html = '\n'.join(f'    <a href="/wiki/{c}/" onclick="filterCat(\'{c}\');return false;">{l}</a>' for c, l in _NAV_LINKS)
    index_html = re.sub(
        r'(<nav>\s*\n)([\s\S]*?)(  </nav>)',
        r'\1' + _nav_html + '\n  \\3',
        index_html,
        count=1
    )

    # 更新侧边栏分类为新分类
    _SIDEBAR_CATS = [
        ('brand_news', '品牌/新闻'), ('notebook', '笔记本'), ('desktop', '台式机'), ('monitor', '显示器'),
        ('tablet_phone', '平板/手机'), ('accessory', '配件/办公'),
        ('smart_device', '智能设备'), ('server', '服务器'), ('workstation', '工作站'),
        ('solution', '解决方案'), ('service', '服务产品'), ('knowledge', '技术支持'),
    ]
    _sb_links = '      <a class="sidebar-link active" href="#" onclick="filterCat(\'all\');return false;">全部 <span class="sidebar-count" id="cnt-all">-</span></a>\n'
    for _c, _l in _SIDEBAR_CATS:
        _sb_links += f'      <a class="sidebar-link" href="#" onclick="filterCat(\'{_c}\');return false;">{_l} <span class="sidebar-count" id="cnt-{_c}">-</span></a>\n'
    index_html = re.sub(
        r'(<h3>分类</h3>\s*\n)[\s\S]*?(\s*</div>\s*\n\s*<div class="sidebar-section">)',
        r'\1' + _sb_links + r'\2',
        index_html,
        count=1
    )

    # 更新中间分类tab栏（.cats-inner）
    _cat_btn_html = '    <button class="cat-btn active" data-cat="all">全部</button>\n'
    for _c, _l in _SIDEBAR_CATS:
        _cat_btn_html += f'    <button class="cat-btn" data-cat="{_c}">{_l}</button>\n'
    index_html = re.sub(
        r'(<div class="cats-inner">\s*\n)[\s\S]*?(\s*</div>\s*\n\s*</div>\s*\n)',
        r'\1' + _cat_btn_html + r'\2',
        index_html,
        count=1
    )

    # 更新统计数字
    index_html = re.sub(
        r'(<strong>)\d{1,3}(,\d{3})*(<\/strong>大分类)',
        f'\\g<1>{len(_SIDEBAR_CATS)}\\3',
        index_html
    )
    # 更新加载提示
    index_html = re.sub(
        r'约[\d,]+篇',
        f'约{total_count:,}篇',
        index_html
    )

    # 更新 INLINE_PAGE1 为主站第一页数据
    _main_p1_path = os.path.join(pages_dir, 'all-p1.json')
    _main_p1_items = []
    if os.path.exists(_main_p1_path):
        with open(_main_p1_path, 'r', encoding='utf-8') as _fp1:
            _main_p1_data = _fp1.read().strip()
        try:
            _main_p1_items = json.loads(_main_p1_data).get('items', [])
        except Exception:
            _main_p1_items = []
        index_html = re.sub(
            r'const INLINE_PAGE1\s*=\s*\{[\s\S]*?\};',
            f'const INLINE_PAGE1 = {_main_p1_data};',
            index_html,
            count=1
        )

    # SSR：将 article-grid 占位符替换成真实的卡片HTML（供爬虫与首屏可见）
    _ssr_cards = []
    for _a in _main_p1_items[:24]:
        _a_slug = html.escape(_a.get('slug', ''))
        _a_title = html.escape((_a.get('title') or '')[:80])
        _a_desc = html.escape((_a.get('desc') or '')[:120])
        _a_cat = _a.get('cat') or 'knowledge'
        _a_cat_label = html.escape(CAT_LABELS.get(_a_cat, _a_cat))
        _a_price = _a.get('price') or 0
        _a_type = _a.get('type') or ''
        _price_html = f'<span class="card-price">¥{int(_a_price):,}</span>' if _a_type == 'product' and _a_price else ''
        _ssr_cards.append(f'''<article class="card">
        <a href="/wiki/{_a_slug}" title="{_a_title}">
          <div class="card-tag">{_a_cat_label}</div>
          <h3>{_a_title}</h3>
          <p>{_a_desc}</p>
          {_price_html}
        </a>
      </article>''')
    _ssr_grid = '\n      '.join(_ssr_cards) if _ssr_cards else '<p>正在加载…</p>'
    index_html = re.sub(
        r'<div class="grid" id="article-grid">[\s\S]*?</div>\s*\n\s*<!-- 分页',
        f'<div class="grid" id="article-grid">\n      {_ssr_grid}\n    </div>\n\n    <!-- 分页',
        index_html,
        count=1
    )

    # SSR：生成静态分页入口链接（前10页 + 分类深链），放到分页div中供爬虫抓取
    _seo_pag_links = []
    _seo_pag_links.append('<a href="/wiki/" class="page-first">首页</a>')
    # 分类深链接
    for _c, _l in _SIDEBAR_CATS:
        _seo_pag_links.append(f'<a href="/wiki/{_c}/">{_l}</a>')
    _seo_pag_html = ' '.join(_seo_pag_links)
    index_html = re.sub(
        r'<div class="pagination" id="pagination"[^>]*></div>',
        f'<div class="pagination" id="pagination" aria-label="分页导航"><nav class="seo-cat-nav">{_seo_pag_html}</nav></div>',
        index_html,
        count=1
    )

    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(index_html)
    print(f'COUNTS 已更新: {total_count:,} 条')
    print(f'首页SSR卡片: {len(_ssr_cards)} 篇')

    # --- 第六步：生成子站 index.html ---
    print(f'\n[{datetime.now():%H:%M:%S}] === 生成子站 index.html ===')
    BU_DIR_LABELS = {'wiki-c': '消费产品', 'wiki-b': '企业购', 'wiki-biz': '商用'}
    # 默认分类标签
    _DEFAULT_CAT_LABELS = {
        'brand_news': '品牌/新闻', 'notebook': '笔记本', 'desktop': '台式机', 'monitor': '显示器',
        'tablet_phone': '平板/手机', 'accessory': '配件/办公',
        'smart_device': '智能设备', 'server': '服务器', 'workstation': '工作站',
        'solution': '解决方案', 'service': '服务产品', 'knowledge': '技术支持',
        'biz-case': '客户案例', 'biz-industry': '行业方案', 'biz-solution': '解决方案',
        'biz-activity': '活动专题', 'biz-brand': '品牌专区', 'biz-other': '商用资讯',
    }
    _DEFAULT_CAT_SHORT = {
        'brand_news': '品牌/新闻', 'notebook': '笔记本', 'desktop': '台式机', 'monitor': '显示器',
        'tablet_phone': '平板/手机', 'accessory': '配件/办公',
        'smart_device': '智能设备', 'server': '服务器', 'workstation': '工作站',
        'solution': '方案', 'service': '服务', 'knowledge': '技术支持',
        'biz-case': '案例', 'biz-industry': '行业', 'biz-solution': '方案',
        'biz-activity': '活动', 'biz-brand': '品牌', 'biz-other': '资讯',
    }
    _SUB_CAT_OVERRIDES = {
        'wiki-c': {},
        'wiki-b': {},
        'wiki-biz': {},
    }

    for dir_name, label in BU_DIR_LABELS.items():
        sub_dir = os.path.join(os.path.dirname(WIKI_DIR), dir_name)
        sub_index = os.path.join(sub_dir, 'index.html')
        sd = sub_site_data[dir_name]
        sub_cats = sd['cats']  # 该子站有的分类
        sub_by_cat = sd['by_cat']

        # 该子站的标签定制
        overrides = _SUB_CAT_OVERRIDES.get(dir_name, {})
        ALL_CAT_LABELS = {**_DEFAULT_CAT_LABELS, **{k: v for k, v in overrides.items() if not k.endswith('_full')}}
        # _full 后缀用于侧边栏全名
        for k, v in overrides.items():
            if k.endswith('_full'):
                ALL_CAT_LABELS[k[:-5]] = v
        ALL_CAT_SHORT = {**_DEFAULT_CAT_SHORT, **{k: v for k, v in overrides.items() if not k.endswith('_full')}}

        # 读主站index.html作为模板
        with open(os.path.join(WIKI_DIR, 'index.html'), 'r', encoding='utf-8') as f:
            tpl = f.read()

        # 1. SITE_BASE 已从pathname自动检测（/wiki-c/等），fetch路径自动适配
        # 只需替换硬编码的非JS路径
        sub_html = tpl.replace(
            "/wiki/articles.json",
            f"/{dir_name}/articles.json"
        )
        # articles-slim.json 搜索仍用主站数据（子站不生成slim）

        # 2. 标题加子站标签 + canonical/og指向子站
        sub_html = sub_html.replace(
            '<title>联想乐享知识库',
            f'<title>联想乐享知识库 - {label}'
        )
        sub_html = sub_html.replace(
            'href="https://www.lenovo.com.cn/wiki/"',
            f'href="https://www.lenovo.com.cn/{dir_name}/"'
        ).replace(
            '"https://www.lenovo.com.cn/wiki/"',
            f'"https://www.lenovo.com.cn/{dir_name}/"'
        )
        # logo 和面包屑指向子站
        sub_html = sub_html.replace(
            'href="/wiki/">联想乐享知识库',
            f'href="/{dir_name}/">联想乐享知识库'
        )
        sub_html = sub_html.replace(
            '<a class="logo" href="/wiki/">',
            f'<a class="logo" href="/{dir_name}/">'
        )

        # 3. 产品链接指向主站（子站和主站平级，用绝对路径）
        sub_html = sub_html.replace(
            "href=\"product-", "href=\"/wiki/product-"
        ).replace(
            "href='product-", "href='/wiki/product-"
        )
        # JS 动态生成的链接直接指向主站
        sub_html = sub_html.replace(
            "a.href = a_item.slug",
            "a.href = '/wiki/' + a_item.slug"
        )
        # JS 模板字符串中的卡片链接指向主站，新窗口打开
        sub_html = sub_html.replace(
            'href="/wiki/${a.slug}"',
            'href="/wiki/${a.slug}" target="_blank"'
        )

        # 4. 替换侧边栏分类（只保留该子站有的分类）
        sidebar_links = '      <a class="sidebar-link active" href="#" onclick="filterCat(\'all\');return false;">全部 <span class="sidebar-count" id="cnt-all">-</span></a>\n'
        for c in sub_cats:
            if c == 'all':
                continue
            lbl = ALL_CAT_LABELS.get(c, c)
            sidebar_links += f'      <a class="sidebar-link" href="#" onclick="filterCat(\'{c}\');return false;">{lbl} <span class="sidebar-count" id="cnt-{c}">-</span></a>\n'
        # 用 <h3>分类</h3> 到 </div> 之间的区域替换
        sub_html = re.sub(
            r'(<h3>分类</h3>\s*\n)[\s\S]*?(\s*</div>\s*\n\s*<div class="sidebar-section">)',
            r'\1' + sidebar_links + r'\2',
            sub_html,
            count=1
        )

        # 5. 替换顶栏导航（只保留该子站有的分类）
        nav_links = ''
        for c in sub_cats:
            if c in ('all', 'knowledge'):
                continue  # 知识库只在侧边栏
            short = ALL_CAT_SHORT.get(c, c)
            nav_links += f'    <a href="#" onclick="filterCat(\'{c}\');return false;">{short}</a>\n'
        # 子站不含知识库文章，不添加知识库入口
        sub_html = re.sub(
            r'(<nav>\s*\n)([\s\S]*?)(  </nav>)',
            r'\1' + nav_links + r'\3',
            sub_html,
            count=1
        )

        # 5.5 替换分类标签按钮栏 .cats-inner（蓝色区域下方）
        cat_buttons = '    <button class="cat-btn active" data-cat="all">全部</button>\n'
        for c in sub_cats:
            if c == 'all':
                continue
            lbl = ALL_CAT_LABELS.get(c, c)
            cat_buttons += f'    <button class="cat-btn" data-cat="{c}">{lbl}</button>\n'
        sub_html = re.sub(
            r'(<div class="cats-inner">\s*\n)[\s\S]*?(\s*</div>\s*\n\s*</div>\s*\n)',
            r'\1' + cat_buttons + r'\2',
            sub_html,
            count=1
        )

        # 6. 替换 COUNTS / PAGED_CATS / CAT_TITLES
        sub_counts = ', '.join(f'{_js_key(c)}:{len(sub_by_cat.get(c, []))}' for c in sub_cats if c != 'all')
        sub_counts = f'all:{sd["total"]}, {sub_counts}'
        sub_html = re.sub(
            r'const COUNTS\s*=\s*\{[^}]+\};',
            f'const COUNTS = {{ {sub_counts} }};',
            sub_html
        )
        sub_paged = ','.join(f"'{c}'" for c in sub_cats if c != 'all')
        sub_html = re.sub(
            r"const PAGED_CATS\s*=\s*\[[^\]]+\];",
            f"const PAGED_CATS = [{sub_paged}];",
            sub_html
        )
        sub_titles = ', '.join(f"{_js_key(c)}:'{ALL_CAT_LABELS.get(c, c)}'" for c in sub_cats if c != 'all')
        sub_titles = f"all:'全部', {sub_titles}"
        sub_html = re.sub(
            r"const CAT_TITLES\s*=\s*\{[^}]+\};",
            f"const CAT_TITLES = {{ {sub_titles} }};",
            sub_html
        )

        # 6.5 替换 hero 区域的统计数字（篇文章数、大分类数）
        sub_cat_count = len([c for c in sub_cats if c != 'all'])
        sub_html = re.sub(
            r'(<strong>)\d{1,3}(,\d{3})*(<\/strong>大分类)',
            f'\\g<1>{sub_cat_count}\\3',
            sub_html
        )
        sub_html = re.sub(
            r'(id="stat-total">)[^<]*(</strong>)',
            f'\\g<1>{sd["total"]:,}\\2',
            sub_html
        )

        # 6.8 替换 INLINE_PAGE1 为子站第一页数据
        sub_p1_path = os.path.join(sub_dir, 'pages', 'all-p1.json')
        sub_p1_items = []
        if os.path.exists(sub_p1_path):
            with open(sub_p1_path, 'r', encoding='utf-8') as _fp1:
                sub_p1_data = _fp1.read().strip()
            try:
                sub_p1_items = json.loads(sub_p1_data).get('items', [])
            except Exception:
                sub_p1_items = []
            sub_html = re.sub(
                r'const INLINE_PAGE1\s*=\s*\{[\s\S]*?\};',
                f'const INLINE_PAGE1 = {sub_p1_data};',
                sub_html,
                count=1
            )

        # 6.9 子站SSR卡片注入（首屏可见，爬虫可抓取）
        _sub_ssr_cards = []
        for _a in sub_p1_items[:24]:
            _a_slug = html.escape(_a.get('slug', ''))
            _a_title = html.escape((_a.get('title') or '')[:80])
            _a_desc = html.escape((_a.get('desc') or '')[:120])
            _a_cat = _a.get('cat') or 'knowledge'
            _a_cat_label = html.escape(ALL_CAT_LABELS.get(_a_cat, _a_cat))
            _a_price = _a.get('price') or 0
            _a_type = _a.get('type') or ''
            _price_html = f'<span class="card-price">¥{int(_a_price):,}</span>' if _a_type == 'product' and _a_price else ''
            _sub_ssr_cards.append(f'''<article class="card">
        <a href="/wiki/{_a_slug}" title="{_a_title}" target="_blank">
          <div class="card-tag">{_a_cat_label}</div>
          <h3>{_a_title}</h3>
          <p>{_a_desc}</p>
          {_price_html}
        </a>
      </article>''')
        _sub_ssr_grid = '\n      '.join(_sub_ssr_cards) if _sub_ssr_cards else '<p>正在加载…</p>'
        sub_html = re.sub(
            r'<div class="grid" id="article-grid">[\s\S]*?</div>\s*\n\s*<!-- 分页',
            f'<div class="grid" id="article-grid">\n      {_sub_ssr_grid}\n    </div>\n\n    <!-- 分页',
            sub_html,
            count=1
        )

        # 7. 在 </body> 前插入 AI/SEO 友好的纯HTML产品列表（视觉隐藏，爬虫可见）
        product_links = '\n'.join(
            f'<li><a href="/wiki/{a["slug"]}">{html.escape(a["title"][:80])}</a></li>'
            for a in sub_articles[:500]
        )
        seo_block = f'''<section id="product-index" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden">
<h2>联想{label}产品目录（共{len(sub_articles)}款）</h2>
<ul>
{product_links}
</ul>
</section>
'''
        sub_html = sub_html.replace('</body>', seo_block + '</body>')

        with open(sub_index, 'w', encoding='utf-8') as f:
            f.write(sub_html)
        cat_names = [ALL_CAT_SHORT.get(c, c) for c in sub_cats if c not in ('all', 'knowledge')]
        print(f'  {dir_name}/index.html ({label}): 分类={cat_names}')

    # --- 生成 robots.txt（测试期禁止抓取） ---
    _robots_body = 'User-agent: *\nDisallow: /wiki/*\nDisallow: /wiki-c/*\nDisallow: /wiki-b/*\nDisallow: /wiki-biz/*\n'
    # 写到域名根目录（生效的位置）
    _site_root = os.path.dirname(WIKI_DIR)
    for _rp in (os.path.join(_site_root, 'robots.txt'), os.path.join(WIKI_DIR, 'robots.txt')):
        try:
            with open(_rp, 'w', encoding='utf-8') as _rf:
                _rf.write(_robots_body)
        except OSError:
            pass
    print(f'robots.txt: 已写入（测试期禁止抓取）')

    # --- 清理不在当前有效集合内的陈旧 article-*.html / product-*.html ---
    valid_slugs = {a['slug'] for a in all_articles}
    removed_stale = 0
    for _f in os.listdir(WIKI_DIR):
        if (_f.startswith('article-') or _f.startswith('product-')) and _f.endswith('.html'):
            if _f not in valid_slugs:
                try:
                    os.remove(os.path.join(WIKI_DIR, _f))
                    removed_stale += 1
                except OSError:
                    pass
    print(f'清理陈旧页: {removed_stale:,} 篇')

    # --- 统计 ---
    stats['total'] = stats['new_know'] + stats['new_product'] + stats['skipped'] + product_skip
    print(f'''
===== 生成完成 =====
新生成知识页: {stats["new_know"]:,} 篇
新生成商品页: {stats["new_product"]:,} 篇
跳过已存在:   {stats["skipped"] + product_skip:,} 篇
articles.json: {len(all_articles):,} 条
sitemap.xml:   {len(all_articles):,} 条URL
子站:          wiki-c/ wiki-b/ wiki-biz/
输出目录:      {WIKI_DIR}
''')

if __name__ == '__main__':
    main()
