// ===== PAGE RENDERERS =====
function renderPage(pageId) {
  const content = document.getElementById('page-content');
  const renderer = PAGE_RENDERERS[pageId];
  if (renderer) {
    content.innerHTML = renderer();
  } else {
    content.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">${getPageLabel(pageId)}</div>
        <div class="page-desc">功能开发中，敬请期待</div></div>
      </div>
      <div class="empty-state">
        <div class="icon">🚧</div>
        <div class="title">${getPageLabel(pageId)}</div>
        <div>该模块正在建设中，可通过右侧 AI 助手使用自然语言操作</div>
      </div>`;
  }
}

const PAGE_RENDERERS = {
  'dashboard.overview': () => `
    <div class="page-header">
      <div>
        <div class="page-title">运营总览</div>
        <div class="page-desc">乐享 & 官网全渠道数据概览</div>
      </div>
      <div style="display:flex;gap:8px;">
        <select style="padding:6px 10px;border:1px solid var(--border-light);border-radius:6px;font-size:12px;background:#fff;cursor:pointer">
          <option>最近7天</option><option>最近30天</option><option>本月</option>
        </select>
        <button class="btn btn-sm btn-secondary" onclick="aiQuick('生成本周运营报告')">📄 生成报告</button>
      </div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">MAU（月活跃用户）</div>
        <div class="kpi-value">823万</div>
        <div class="kpi-sub"><span class="up">↑ 12.3%</span> 较上月</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">WAU（周活跃用户）</div>
        <div class="kpi-value">289万</div>
        <div class="kpi-sub"><span class="up">↑ 5.7%</span> 较上周</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">GMV（交易额）</div>
        <div class="kpi-value">38.2亿</div>
        <div class="kpi-sub"><span class="up">↑ 8.1%</span> 较上月</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">登录客户数</div>
        <div class="kpi-value">541万</div>
        <div class="kpi-sub"><span class="down">↓ 2.1%</span> 较上月</div>
      </div>
    </div>
    <div class="kpi-grid" style="grid-template-columns:repeat(5,1fr);">
      <div class="kpi-card"><div class="kpi-label">总对话数</div><div class="kpi-value" style="font-size:20px" id="ov-convs">-</div></div>
      <div class="kpi-card"><div class="kpi-label">今日对话</div><div class="kpi-value" style="font-size:20px" id="ov-today">-</div></div>
      <div class="kpi-card"><div class="kpi-label">用户消息总数</div><div class="kpi-value" style="font-size:20px" id="ov-msgs">-</div></div>
      <div class="kpi-card"><div class="kpi-label">知识库文档</div><div class="kpi-value" style="font-size:20px" id="ov-docs">-</div></div>
      <div class="kpi-card"><div class="kpi-label">好评率</div><div class="kpi-value" style="font-size:20px" id="ov-satisfaction">-</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title">📈 Query 场景分布</div></div>
        <div style="display:flex;align-items:flex-end;gap:16px;height:160px;padding-top:10px;">
          ${['会员|68', '电商|85', '服务|42', '门店|31', '方案|55', '咨询|73'].map(d => {
            const [l,v] = d.split('|');
            return `<div style="flex:1;text-align:center"><div style="background:var(--primary);border-radius:4px 4px 0 0;height:${v*1.5}px;margin:0 auto;width:24px;opacity:0.8"></div><div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">${l}</div></div>`;
          }).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">🎯 业务决策看板</div></div>
        <div class="action-card" onclick="aiQuick('高意向未转化客户分析')">
          <div class="ac-icon" style="background:var(--orange-light);color:var(--orange)">⚡</div>
          <div><div class="ac-title">高意向未转化：1,247 人</div><div class="ac-desc">浏览≥3次未下单，建议触达</div></div>
        </div>
        <div class="action-card" onclick="aiQuick('无答案Query分析')">
          <div class="ac-icon" style="background:var(--red-light);color:var(--red)">❓</div>
          <div><div class="ac-title">无答案 Query：89 条</div><div class="ac-desc">需补充知识库或优化检索</div></div>
        </div>
        <div class="action-card" onclick="aiQuick('流失风险客户预警')">
          <div class="ac-icon" style="background:var(--purple-light);color:var(--purple)">📉</div>
          <div><div class="ac-title">流失风险客户：3,421 人</div><div class="ac-desc">30天未活跃，建议召回</div></div>
        </div>
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title">🔥 热门商品 TOP5</div></div>
        <table>
          <tr><th>商品</th><th>浏览量</th><th>转化率</th></tr>
          <tr><td>ThinkPad X9-14 Aura AI元启版</td><td>15,847</td><td><span class="badge status-on">4.8%</span></td></tr>
          <tr><td>YOGA Air 14 Aura AI元启版</td><td>13,203</td><td><span class="badge status-on">5.3%</span></td></tr>
          <tr><td>拯救者 R7000P 2025 AI元启</td><td>11,876</td><td><span class="badge status-on">4.1%</span></td></tr>
          <tr><td>联想小新Pro14GT AI元启版</td><td>9,543</td><td><span class="badge status-warn">3.2%</span></td></tr>
          <tr><td>ThinkPad P14s 2025 AI元启版</td><td>7,810</td><td><span class="badge status-warn">2.6%</span></td></tr>
        </table>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">📉 差评问题 (实时)</div></div>
        <div id="ov-bad-feedback"><div style="text-align:center;padding:20px;color:var(--text-tertiary)">加载中...</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">📊 7 日对话趋势 (实时)</div></div>
      <div id="ov-trend" style="display:flex;align-items:flex-end;gap:12px;height:120px;padding-top:10px;"></div>
    </div>
  `,

  // ===== GEO DASHBOARD =====
  'dashboard.geo': () => `
    <div class="page-header">
      <div><div class="page-title">GEO · 整体数据概览</div><div class="page-desc">联想 AI 搜索引擎优化效果监控 · 数据来源：点亮AI</div></div>
      <button class="btn btn-sm btn-primary" onclick="geoLoadData()">刷新</button>
    </div>
    <div class="geo-dark">
      <div class="geo-scope-bar">
        <div class="geo-scope-tab active" data-scope="all" onclick="geoSetScope(this)">整体</div>
        <div class="geo-scope-tab" data-scope="leai" onclick="geoSetScope(this)">联想乐享</div>
        <div class="geo-scope-tab" data-scope="official" onclick="geoSetScope(this)">联想官网</div>
      </div>
      <div class="geo-filter-row">
        <span class="geo-label">AI 平台</span>
        <div class="geo-pill active" data-model="all" onclick="geoTogglePlatform(this)">全平台</div>
        <div class="geo-pill" data-model="doubao" onclick="geoTogglePlatform(this)">豆包</div>
        <div class="geo-pill" data-model="deepseek" onclick="geoTogglePlatform(this)">DeepSeek</div>
        <div class="geo-pill" data-model="yuanbao" onclick="geoTogglePlatform(this)">元宝</div>
        <div class="geo-pill" data-model="kimi" onclick="geoTogglePlatform(this)">Kimi</div>
        <span class="geo-pill-disabled" title="项目未开启该平台">千问 (未开启)</span>
        <span class="geo-pill-disabled" title="项目未开启该平台">文心 (未开启)</span>
        <span class="geo-pill-disabled" title="项目未开启该平台">夸克 (未开启)</span>
      </div>
      <div class="geo-filter-row">
        <span class="geo-label">时间范围</span>
        <select id="geo-period" onchange="geoSetPeriod(this.value)" style="padding:5px 10px;border-radius:14px;font-size:12px;background:#f9fafb;color:#374151;border:1px solid #d1d5db;cursor:pointer;">
          <option value="7d">最近 7 天</option>
          <option value="30d" selected>最近 30 天</option>
          <option value="year">本年度</option>
        </select>
        <span class="geo-label" style="margin-left:16px;">问题筛选</span>
        <input id="geo-questions" type="text" placeholder="多个问题用逗号分隔，回车筛选" onkeydown="if(event.key==='Enter'){geoSetQuestions(this.value)}" style="padding:5px 10px;border-radius:14px;font-size:12px;background:#f9fafb;color:#374151;border:1px solid #d1d5db;min-width:260px;outline:none;">
      </div>
      <div class="geo-status-line" id="geo-status">加载中...</div>

      <!-- 第一行：4 个核心 KPI -->
      <div class="geo-kpi-grid cols-4">
        <div class="geo-kpi highlight">
          <div class="gk-tip" title="AI 答案中提及目标品牌的问题数占比，衡量品牌基础曝光能力">?</div>
          <div class="gk-val" id="gv-brand-visible">--</div>
          <div class="gk-label">品牌可见度</div>
          <div class="gk-sub">竞品可见度 <span id="gv-comp-visible">--</span></div>
        </div>
        <div class="geo-kpi">
          <div class="gk-tip" title="AI 答案中推荐目标品牌/产品的次数占比">?</div>
          <div class="gk-val" id="gv-brand-rec">--</div>
          <div class="gk-label">品牌推荐率</div>
          <div class="gk-sub">竞品推荐率 <span id="gv-comp-rec">--</span></div>
        </div>
        <div class="geo-kpi">
          <div class="gk-tip" title="AI 答案中目标品牌/产品出现在推荐首位（置顶）的次数占比">?</div>
          <div class="gk-val" id="gv-brand-top1">--</div>
          <div class="gk-label">品牌推荐置顶率</div>
          <div class="gk-sub">竞品置顶率 <span id="gv-comp-top1">--</span></div>
        </div>
        <div class="geo-kpi">
          <div class="gk-tip" title="AI 答案中目标品牌/产品出现在推荐列表前 3 位的次数占比">?</div>
          <div class="gk-val" id="gv-brand-top3">--</div>
          <div class="gk-label">品牌推荐前三率</div>
          <div class="gk-sub">竞品前三率 <span id="gv-comp-top3">--</span></div>
        </div>
      </div>

      <!-- 第二行：信源分布 Treemap + 排行榜 -->
      <div class="geo-row">
        <div class="geo-panel">
          <div class="gpnl-title">信源分布图</div>
          <div id="geo-sites-treemap" style="min-height:260px"><div style="color:#9ca3af;font-size:12px;padding:12px">加载中...</div></div>
        </div>
        <div class="geo-panel">
          <div class="gpnl-title">信源排行榜 Top20</div>
          <div class="geo-scroll-wrap" style="max-height:320px">
            <div id="geo-sites-rank"><div style="color:#9ca3af;font-size:12px;padding:12px">加载中...</div></div>
          </div>
        </div>
      </div>

      <!-- 第三行：各平台引用次数 -->
      <div class="geo-row wide-right">
        <div class="geo-panel">
          <div class="gpnl-title">各 AI 平台引用次数 <span style="font-size:11px;color:#9ca3af;font-weight:400">· wiki + 官网合计</span></div>
          <div class="geo-kpi-grid cols-2" style="margin-bottom:12px">
            <div class="geo-kpi"><div class="gk-val" id="gv-lenovo-cite">--</div><div class="gk-label">联想官网引用次数</div></div>
            <div class="geo-kpi"><div class="gk-val" id="gv-wiki-cite">--</div><div class="gk-label">乐享/业务 wiki 引用次数</div></div>
          </div>
          <div class="geo-plat-grid" id="geo-plat-dist"><div style="color:#9ca3af;font-size:12px;padding:12px">加载中...</div></div>
        </div>
        <div class="geo-panel">
          <div class="gpnl-title">信源站点总览</div>
          <div class="geo-kpi-grid cols-3" style="margin-bottom:8px">
            <div class="geo-kpi"><div class="gk-val" id="gv-sites-total">--</div><div class="gk-label">总信源站点数</div></div>
            <div class="geo-kpi"><div class="gk-val" id="gv-sites-top1-name">--</div><div class="gk-label">最高信源站点</div></div>
            <div class="geo-kpi"><div class="gk-val" id="gv-sites-top1-pct">--</div><div class="gk-label">最高占比</div></div>
          </div>
        </div>
      </div>

      <!-- 第四行：问题列表 -->
      <div class="geo-panel" style="margin-bottom:12px">
        <div class="gpnl-title">GEO 问题列表 <span style="font-size:11px;color:#9ca3af;font-weight:400">· 共 <span id="gv-q-count">--</span> 个问题 · 按模型展示可见性</span></div>
        <div class="geo-scroll-wrap" style="max-height:500px">
          <div id="geo-questions-table"><div style="color:#9ca3af;font-size:12px;padding:12px">加载中...</div></div>
        </div>
      </div>
    </div>
  `,

  'dashboard.geoSource': () => `
    <div class="page-header">
      <div><div class="page-title">GEO · 各平台信源分布</div><div class="page-desc">各 AI 模型引用的内容发布平台分布及占比</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="geo-source-model" onchange="geoLoadSourcePage()" style="padding:5px 10px;border-radius:14px;font-size:12px;background:#f9fafb;color:#374151;border:1px solid #d1d5db;cursor:pointer;">
          <option value="all">全平台</option>
          <option value="doubao">豆包</option>
          <option value="deepseek">DeepSeek</option>
          <option value="yuanbao">元宝</option>
          <option value="kimi">Kimi</option>
        </select>
      </div>
    </div>
    <div class="geo-dark">
      <div class="geo-status-line" id="geo-source-status">加载中...</div>
      <div id="geo-source-list"><div style="color:#9ca3af;font-size:12px;padding:20px;text-align:center">加载中...</div></div>
      <div id="geo-source-pager" style="text-align:center;margin-top:12px"></div>
    </div>
  `,

  'dashboard.geoIntent': () => `
    <div class="page-header">
      <div><div class="page-title">GEO · 各平台意图分布</div><div class="page-desc">各 AI 平台覆盖意图总数及可见性矩阵</div></div>
    </div>
    <div class="geo-dark">
      <div class="geo-status-line">本模块数据需点亮AI 开放「意图分布」接口后接入</div>
      <div class="geo-placeholder" style="min-height:360px;display:flex;align-items:center;justify-content:center">
        <div>
          <div class="gp-title">意图可见性矩阵</div>
          可见性分 4 类：品牌综合可见性 · 品牌精准可见性 · 竞品可见性 · 链接可见性<br>
          当前点亮AI overview 接口不返回意图级数据
        </div>
      </div>
    </div>
  `,

  'dashboard.geoConversion': () => `
    <div class="page-header">
      <div><div class="page-title">GEO · 转化看板</div><div class="page-desc">通过 AI 搜索平台入站的访问 / 登录 / 注册 / 购买转化</div></div>
    </div>
    <div class="geo-dark">
      <div class="geo-status-line">以下字段依据 GEO看板样式.xlsx 定义，数据需埋点系统 + 点亮AI 转化接口对接后接入</div>

      <div class="geo-conv-section">
        <div class="geo-conv-title">联想整体（URL 包含 lenovo，排除 wiki.lenovo.com.cn）</div>
        <div class="geo-conv-grid">
          <div class="geo-conv-cell"><div class="gcc-label">访问联想 UV</div><div class="gcc-val">--</div><div class="gcc-def">通过 AI 搜索平台访问联想域名的用户数</div></div>
          <div class="geo-conv-cell"><div class="gcc-label">登录用户-Lenovo</div><div class="gcc-val">--</div><div class="gcc-def">当天访问联想的用户中有 Lenovoid 登录行为的用户数</div></div>
          <div class="geo-conv-cell"><div class="gcc-label">新注册用户-Lenovo</div><div class="gcc-val">--</div><div class="gcc-def">当天访问联想的登录用户中是新注册的用户数</div></div>
          <div class="geo-conv-cell"><div class="gcc-label">当日付费用户数</div><div class="gcc-val">--</div><div class="gcc-def">用户入站后在当日产生购买行为的用户数</div></div>
          <div class="geo-conv-cell"><div class="gcc-label">当日 GMV</div><div class="gcc-val">--</div><div class="gcc-def">用户入站后当日产生的订单交易额</div></div>
          <div class="geo-conv-cell"><div class="gcc-label">财年累计付费用户数</div><div class="gcc-val">--</div><div class="gcc-def">本财年通过 AI 搜索入站并产生购买的用户去重数</div></div>
          <div class="geo-conv-cell"><div class="gcc-label">财年累计 GMV</div><div class="gcc-val">--</div><div class="gcc-def">本财年通过 AI 搜索入站的用户产生的订单交易额</div></div>
          <div class="geo-conv-cell"></div>
        </div>
      </div>

      <div class="geo-conv-section">
        <div class="geo-conv-title">联想乐享（URL 包含 leai.lenovo.com.cn / wiki.lenovo.com.cn）</div>
        <div class="geo-conv-grid">
          <div class="geo-conv-cell"><div class="gcc-label">访问联想乐享 UV</div><div class="gcc-val">--</div><div class="gcc-def">通过 AI 搜索平台访问联想乐享的用户数</div></div>
          <div class="geo-conv-cell"><div class="gcc-label">登录用户-乐享</div><div class="gcc-val">--</div><div class="gcc-def">当天访问乐享的用户中有 Lenovoid 登录的用户数</div></div>
          <div class="geo-conv-cell"><div class="gcc-label">新注册用户-乐享</div><div class="gcc-val">--</div><div class="gcc-def">当天访问乐享的登录用户中是新注册的用户数</div></div>
          <div class="geo-conv-cell"><div class="gcc-label">互动用户数/日</div><div class="gcc-val">--</div><div class="gcc-def">当天访问乐享的用户中至少有 1 次会话的用户数</div></div>
          <div class="geo-conv-cell"><div class="gcc-label">登录状态互动人数</div><div class="gcc-val">--</div><div class="gcc-def">当日互动用户中有登录状态的用户数</div></div>
          <div class="geo-conv-cell"><div class="gcc-label">当日付费用户数-乐享</div><div class="gcc-val">--</div><div class="gcc-def">订单来源为乐享，当日通过乐享自主功能下单的用户数</div></div>
          <div class="geo-conv-cell"><div class="gcc-label">当日 GMV-乐享</div><div class="gcc-val">--</div><div class="gcc-def">订单来源为乐享，当日通过乐享自主下单的交易额</div></div>
          <div class="geo-conv-cell"><div class="gcc-label">财年累计付费-乐享</div><div class="gcc-val">--</div><div class="gcc-def">订单来源为乐享，本财年通过乐享自主下单的用户去重数</div></div>
          <div class="geo-conv-cell"><div class="gcc-label">财年累计 GMV-乐享</div><div class="gcc-val">--</div><div class="gcc-def">订单来源为乐享，本财年通过乐享自主下单的交易额</div></div>
        </div>
      </div>

      <div class="geo-conv-section">
        <div class="geo-conv-title">访问来源（按 AI 平台拆分）</div>
        <div class="geo-conv-grid">
          <div class="geo-conv-cell"><div class="gcc-label">豆包</div><div class="gcc-val">--</div><div class="gcc-def">上级来源字段包含"豆包"标识</div></div>
          <div class="geo-conv-cell"><div class="gcc-label">元宝</div><div class="gcc-val">--</div><div class="gcc-def">上级来源字段包含"元宝"标识</div></div>
          <div class="geo-conv-cell"><div class="gcc-label">Kimi</div><div class="gcc-val">--</div><div class="gcc-def">上级来源字段包含"Kimi"标识</div></div>
          <div class="geo-conv-cell"><div class="gcc-label">DeepSeek</div><div class="gcc-val">--</div><div class="gcc-def">上级来源字段包含"DS"标识</div></div>
          <div class="geo-conv-cell"><div class="gcc-label">千问</div><div class="gcc-val">--</div><div class="gcc-def">上级来源字段包含"千问"标识</div></div>
          <div class="geo-conv-cell"><div class="gcc-label">文心</div><div class="gcc-val">--</div><div class="gcc-def">上级来源字段包含"文心"标识</div></div>
          <div class="geo-conv-cell"><div class="gcc-label">夸克</div><div class="gcc-val">--</div><div class="gcc-def">上级来源字段包含"夸克"标识</div></div>
          <div class="geo-conv-cell"></div>
        </div>
      </div>
    </div>
  `,

  'dashboard.geoKnowledge': () => `
    <div class="page-header">
      <div><div class="page-title">GEO · 手工上传知识</div><div class="page-desc">上传文档或手动添加 QA 对，补充 AI 搜索引擎可抓取的知识内容</div></div>
    </div>
    <div class="kpi-grid" style="margin-bottom:16px">
      <div class="kpi-card"><div class="kpi-label">文档总数</div><div class="kpi-value" style="font-size:20px" id="stat-docs">-</div></div>
      <div class="kpi-card"><div class="kpi-label">向量数</div><div class="kpi-value" style="font-size:20px" id="stat-vectors">-</div></div>
      <div class="kpi-card"><div class="kpi-label">QA 对数</div><div class="kpi-value" style="font-size:20px" id="stat-qa">-</div></div>
      <div class="kpi-card"><div class="kpi-label">图谱实体</div><div class="kpi-value" style="font-size:20px" id="stat-kg">-</div></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="tab-bar" style="display:flex;border-bottom:1px solid var(--border-light);margin-bottom:16px">
        <div class="tab-item active" onclick="switchKbTab('upload',this)" style="padding:10px 20px;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid var(--primary);color:var(--primary)">上传文档</div>
        <div class="tab-item" onclick="switchKbTab('qa',this)" style="padding:10px 20px;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;color:var(--text-tertiary)">手动添加 QA</div>
        <div class="tab-item" onclick="switchKbTab('docs',this)" style="padding:10px 20px;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;color:var(--text-tertiary)">文档列表</div>
        <div class="tab-item" onclick="switchKbTab('qalist',this)" style="padding:10px 20px;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;color:var(--text-tertiary)">QA 列表</div>
      </div>
      <div id="kb-tab-upload">
        <div style="padding:20px;text-align:center;border:2px dashed var(--border-light);border-radius:10px;margin:0 16px 16px">
          <div style="font-size:32px;margin-bottom:8px">📄</div>
          <div style="margin-bottom:12px;color:var(--text-secondary);font-size:13px">支持 .txt / .md / .pdf / .docx / .xlsx 格式</div>
          <input type="file" id="kb-file-input" accept=".txt,.md,.pdf,.docx,.xlsx,.csv" onchange="handleKBFileSelect(this)" style="display:none">
          <button class="btn btn-sm btn-secondary" onclick="document.getElementById('kb-file-input').click()">选择文件</button>
          <button class="btn btn-sm btn-primary" id="kb-upload-btn" disabled onclick="submitKBUpload()">上传并处理</button>
          <div id="kb-upload-status" style="display:none;margin-top:10px;font-size:12px"></div>
        </div>
      </div>
      <div id="kb-tab-qa" style="display:none">
        <div style="padding:0 16px 16px">
          <div style="margin-bottom:12px"><label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">问题</label><input type="text" id="manual-qa-q" placeholder="输入问题" style="width:100%;padding:8px 12px;border:1px solid var(--border-light);border-radius:6px;font-size:13px;box-sizing:border-box"></div>
          <div style="margin-bottom:12px"><label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">答案</label><textarea id="manual-qa-a" placeholder="输入答案" rows="4" style="width:100%;padding:8px 12px;border:1px solid var(--border-light);border-radius:6px;font-size:13px;resize:vertical;box-sizing:border-box"></textarea></div>
          <div style="margin-bottom:12px"><label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:4px">场景标签（可选）</label><input type="text" id="manual-qa-scene" placeholder="如：售前咨询、产品对比" style="width:100%;padding:8px 12px;border:1px solid var(--border-light);border-radius:6px;font-size:13px;box-sizing:border-box"></div>
          <button class="btn btn-sm btn-primary" onclick="submitManualQA()">保存 QA 对</button>
          <div id="manual-qa-status" style="display:none;margin-top:10px;font-size:12px"></div>
        </div>
      </div>
      <div id="kb-tab-docs" style="display:none"><div id="kb-docs" style="padding:0 16px 16px"><div style="color:var(--text-tertiary);font-size:12px">加载中...</div></div></div>
      <div id="kb-tab-qalist" style="display:none"><div style="padding:0 16px 16px"><div style="margin-bottom:8px;font-size:12px;color:var(--text-tertiary)" id="qa-count-label">共 - 条</div><table id="qa-table" style="width:100%"><tr><td style="text-align:center;color:var(--text-tertiary)">加载中...</td></tr></table></div></div>
    </div>
  `,

  // ===== QUERY ANALYSIS =====
  'dashboard.query': () => `
    <div class="page-header"><div><div class="page-title">Query 分析</div><div class="page-desc">智能体交互数据深度分析</div></div></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(5,1fr);">
      <div class="kpi-card"><div class="kpi-label">Query 总数</div><div class="kpi-value" style="font-size:22px" id="qa-total">-</div></div>
      <div class="kpi-card"><div class="kpi-label">今日 Query</div><div class="kpi-value" style="font-size:22px" id="qa-today">-</div></div>
      <div class="kpi-card"><div class="kpi-label">总对话数</div><div class="kpi-value" style="font-size:22px" id="qa-convs">-</div></div>
      <div class="kpi-card"><div class="kpi-label">好评数</div><div class="kpi-value" style="font-size:22px;color:var(--green)" id="qa-likes">-</div></div>
      <div class="kpi-card"><div class="kpi-label">差评数</div><div class="kpi-value" style="font-size:22px;color:var(--red)" id="qa-dislikes">-</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-header"><div class="card-title">7日 Query 趋势</div></div>
        <div id="qa-trend" style="display:flex;align-items:flex-end;gap:12px;height:140px;padding-top:10px"></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">热门 Query TOP10</div></div>
        <div id="qa-top"><div style="text-align:center;padding:20px;color:var(--text-tertiary)">加载中...</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">差评 Query</div><button class="btn btn-sm btn-primary" onclick="switchPage('content.knowledge')">去补充知识</button></div>
      <div id="qa-bad"><div style="text-align:center;padding:20px;color:var(--text-tertiary)">加载中...</div></div>
    </div>
  `,

  // ===== CUSTOMER BEHAVIOR =====
  'dashboard.behavior': () => `
    <div class="page-header"><div><div class="page-title">客户行为分析</div><div class="page-desc">客户转化、流失、营销、商机等行为指标</div></div></div>
    <div class="demo-banner"><span class="demo-icon">💡</span> 以下为示例数据，接入埋点系统后将展示真实行为分析</div>
    <div class="tab-bar">
      <div class="tab-item active" onclick="switchBehaviorTab('conversion',this)">转化漏斗</div>
      <div class="tab-item" onclick="switchBehaviorTab('intent',this)">意向分析</div>
      <div class="tab-item" onclick="switchBehaviorTab('churn',this)">流失预警</div>
      <div class="tab-item" onclick="switchBehaviorTab('marketing',this)">营销效果</div>
      <div class="tab-item" onclick="switchBehaviorTab('member',this)">会员分析</div>
    </div>
    <div id="behavior-conversion">
      <div class="kpi-grid" style="grid-template-columns:repeat(6,1fr);">
        <div class="kpi-card"><div class="kpi-label">浏览商品客户</div><div class="kpi-value" style="font-size:18px;">456,789</div></div>
        <div class="kpi-card"><div class="kpi-label">收藏行为客户</div><div class="kpi-value" style="font-size:18px;">123,456</div></div>
        <div class="kpi-card"><div class="kpi-label">对比行为客户</div><div class="kpi-value" style="font-size:18px;">89,012</div></div>
        <div class="kpi-card"><div class="kpi-label">加购客户</div><div class="kpi-value" style="font-size:18px;">67,890</div></div>
        <div class="kpi-card"><div class="kpi-label">未支付客户</div><div class="kpi-value" style="font-size:18px;color:var(--orange);">23,456</div></div>
        <div class="kpi-card"><div class="kpi-label">Query→转化客户</div><div class="kpi-value" style="font-size:18px;color:var(--green);">34,567</div></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">转化漏斗</div></div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;align-items:center;gap:12px;"><span style="width:100px;font-size:12px;text-align:right;">浏览</span><div style="flex:1;height:32px;background:var(--primary);border-radius:4px;display:flex;align-items:center;padding:0 10px;color:#fff;font-size:12px;">456,789 (100%)</div></div>
          <div style="display:flex;align-items:center;gap:12px;"><span style="width:100px;font-size:12px;text-align:right;">收藏/对比</span><div style="width:46%;height:32px;background:rgba(51,112,255,0.7);border-radius:4px;display:flex;align-items:center;padding:0 10px;color:#fff;font-size:12px;">212,468 (46.5%)</div></div>
          <div style="display:flex;align-items:center;gap:12px;"><span style="width:100px;font-size:12px;text-align:right;">加购</span><div style="width:15%;height:32px;background:rgba(51,112,255,0.5);border-radius:4px;display:flex;align-items:center;padding:0 10px;color:#fff;font-size:12px;">67,890 (14.9%)</div></div>
          <div style="display:flex;align-items:center;gap:12px;"><span style="width:100px;font-size:12px;text-align:right;">下单</span><div style="width:10%;height:32px;background:rgba(51,112,255,0.3);border-radius:4px;display:flex;align-items:center;padding:0 10px;font-size:12px;">44,434 (9.7%)</div></div>
          <div style="display:flex;align-items:center;gap:12px;"><span style="width:100px;font-size:12px;text-align:right;">支付</span><div style="width:7.5%;height:32px;background:var(--green);border-radius:4px;display:flex;align-items:center;padding:0 10px;color:#fff;font-size:12px;">34,567 (7.6%)</div></div>
        </div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">跨品类浏览客户</div></div><div style="font-size:26px;font-weight:700;margin-bottom:6px;">78,901</div><div style="font-size:12px;color:var(--text-secondary);">浏览 ≥2 个品类的客户，购买意向更广泛</div></div>
        <div class="card"><div class="card-header"><div class="card-title">多次咨询客户</div></div><div style="font-size:26px;font-weight:700;margin-bottom:6px;">45,678</div><div style="font-size:12px;color:var(--text-secondary);">同一客户多次咨询，高意向客户</div></div>
      </div>
    </div>
    <div id="behavior-intent" style="display:none;">
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-label">高意向未转化</div><div class="kpi-value" style="font-size:22px;color:var(--red);">12,345</div><div class="kpi-sub">多次咨询/加购但未下单</div></div>
        <div class="kpi-card"><div class="kpi-label">以旧换新咨询</div><div class="kpi-value" style="font-size:22px;">8,765</div><div class="kpi-sub">换机需求客户</div></div>
        <div class="kpi-card"><div class="kpi-label">企业采购咨询</div><div class="kpi-value" style="font-size:22px;">3,456</div><div class="kpi-sub">SMB 线索</div></div>
        <div class="kpi-card"><div class="kpi-label">推荐未采纳</div><div class="kpi-value" style="font-size:22px;color:var(--orange);">15,678</div><div class="kpi-sub">需优化推荐算法</div></div>
      </div>
    </div>
    <div id="behavior-churn" style="display:none;">
      <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);">
        <div class="kpi-card"><div class="kpi-label">咨询后离开客户</div><div class="kpi-value" style="font-size:22px;color:var(--orange);">34,567</div></div>
        <div class="kpi-card"><div class="kpi-label">流失风险客户</div><div class="kpi-value" style="font-size:22px;color:var(--red);">8,456</div></div>
        <div class="kpi-card"><div class="kpi-label">服务不满意客户</div><div class="kpi-value" style="font-size:22px;color:var(--red);">3,201</div></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">流失风险客户列表</div><button class="btn btn-sm btn-primary" onclick="aiQuick('批量发送挽留优惠')">批量发送挽留优惠</button></div>
        <table><tr><th>客户</th><th>最后活跃</th><th>历史消费</th><th>风险等级</th><th>操作</th></tr>
          <tr><td>用户 A***8</td><td>14 天前</td><td>¥12,890</td><td><span class="badge badge-red">高</span></td><td><button class="btn btn-sm btn-primary">发送优惠</button></td></tr>
          <tr><td>用户 B***3</td><td>21 天前</td><td>¥8,456</td><td><span class="badge badge-red">高</span></td><td><button class="btn btn-sm btn-primary">发送优惠</button></td></tr>
          <tr><td>用户 C***7</td><td>10 天前</td><td>¥5,678</td><td><span class="badge badge-orange">中</span></td><td><button class="btn btn-sm btn-primary">发送优惠</button></td></tr>
        </table>
      </div>
    </div>
    <div id="behavior-marketing" style="display:none;">
      <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);">
        <div class="kpi-card"><div class="kpi-label">优惠券使用客户</div><div class="kpi-value" style="font-size:22px;">56,789</div></div>
        <div class="kpi-card"><div class="kpi-label">优惠券领取未使用</div><div class="kpi-value" style="font-size:22px;color:var(--orange);">45,678</div></div>
        <div class="kpi-card"><div class="kpi-label">负反馈内容</div><div class="kpi-value" style="font-size:22px;color:var(--red);">156</div></div>
      </div>
    </div>
    <div id="behavior-member" style="display:none;">
      <div class="card">
        <div class="card-header"><div class="card-title">会员等级分布</div></div>
        <div class="bar-chart" style="height:140px;">
          <div class="bar-col"><div class="bar-value">58%</div><div class="bar" style="height:87%;background:#8f959e;"></div><div class="bar-label">普通</div></div>
          <div class="bar-col"><div class="bar-value">22%</div><div class="bar" style="height:66%;background:#c0c0c0;"></div><div class="bar-label">银卡</div></div>
          <div class="bar-col"><div class="bar-value">14%</div><div class="bar" style="height:42%;background:#ffd700;"></div><div class="bar-label">金卡</div></div>
          <div class="bar-col"><div class="bar-value">6%</div><div class="bar" style="height:18%;background:#b8860b;"></div><div class="bar-label">铂金</div></div>
        </div>
      </div>
    </div>
  `,

  // ===== 在职员工管理模块 =====
  'employee.overview': () => `
    <div class="page-header">
      <div>
        <div class="page-title">在职员工管理</div>
        <div class="page-desc">查看和管理所有在职员工信息</div>
      </div>
    </div>

    <!-- KPI 卡片 -->
    <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:24px;">
      <div class="kpi-card" style="background:linear-gradient(135deg,#10b981,#059669); color:#fff; cursor:pointer;" onclick="filterAndNavigate('all')">
        <div style="font-size:12px; opacity:0.9; margin-bottom:8px;">在职员工总数</div>
        <div style="font-size:32px; font-weight:700; margin-bottom:8px;" id="kpi-total">2,847</div>
        <div style="font-size:12px; opacity:0.8;">↑ 8% 较上月</div>
      </div>
      <div class="kpi-card" style="background:linear-gradient(135deg,#10b981,#059669); color:#fff; cursor:pointer;" onclick="filterAndNavigate('approved')">
        <div style="font-size:12px; opacity:0.9; margin-bottom:8px;">已认证工数</div>
        <div style="font-size:32px; font-weight:700; margin-bottom:8px;" id="kpi-approved">2,341</div>
        <div style="font-size:12px; opacity:0.8;">82.3% 认证率</div>
      </div>
      <div class="kpi-card" style="background:linear-gradient(135deg,#10b981,#059669); color:#fff; cursor:pointer;" onclick="filterAndNavigate('rejected')">
        <div style="font-size:12px; opacity:0.9; margin-bottom:8px;">已驳回工</div>
        <div style="font-size:32px; font-weight:700; margin-bottom:8px;" id="kpi-rejected">45</div>
        <div style="font-size:12px; opacity:0.8;">需重新认证</div>
      </div>
      <div class="kpi-card" style="background:linear-gradient(135deg,#10b981,#059669); color:#fff; cursor:pointer;" onclick="filterAndNavigate('pending')">
        <div style="font-size:12px; opacity:0.9; margin-bottom:8px;">本月新增</div>
        <div style="font-size:32px; font-weight:700; margin-bottom:8px;" id="kpi-pending">187</div>
        <div style="font-size:12px; opacity:0.8;">↑ 15% 环比</div>
      </div>
    </div>

    <!-- 职员认证状态分布 -->
    <div class="card" style="margin-bottom:24px;">
      <div class="card-header">
        <span class="card-title">职员认证状态分布</span>
      </div>
      <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:16px; padding:20px;">
        <div style="padding:20px; background:var(--bg); border-radius:6px; text-align:center; cursor:pointer;" onclick="filterByDept('普通职员')">
          <div style="font-size:24px; color:#10b981; font-weight:700; margin-bottom:4px;" id="dept-normal">1,850</div>
          <div style="font-size:12px; color:var(--text-secondary);">普通职员</div>
        </div>
        <div style="padding:20px; background:var(--bg); border-radius:6px; text-align:center; cursor:pointer;" onclick="filterByDept('法律')">
          <div style="font-size:24px; color:#10b981; font-weight:700; margin-bottom:4px;" id="dept-legal">186</div>
          <div style="font-size:12px; color:var(--text-secondary);">法律</div>
        </div>
        <div style="padding:20px; background:var(--bg); border-radius:6px; text-align:center; cursor:pointer;" onclick="filterByDept('设计师')">
          <div style="font-size:24px; color:#10b981; font-weight:700; margin-bottom:4px;" id="dept-designer">287</div>
          <div style="font-size:12px; color:var(--text-secondary);">设计师</div>
        </div>
        <div style="padding:20px; background:var(--bg); border-radius:6px; text-align:center; cursor:pointer;" onclick="filterByDept('编程开发')">
          <div style="font-size:24px; color:#10b981; font-weight:700; margin-bottom:4px;" id="dept-dev">38</div>
          <div style="font-size:12px; color:var(--text-secondary);">编程开发</div>
        </div>
      </div>
    </div>

    <!-- 认证方式分布 -->
    <div class="card" style="margin-bottom:24px;">
      <div class="card-header">
        <span class="card-title">认证方式分布</span>
      </div>
      <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:16px; padding:20px;">
        <div style="padding:20px; background:var(--bg); border-radius:6px; text-align:center; cursor:pointer;" onclick="filterByMethod('email')">
          <div style="font-size:24px; color:#10b981; font-weight:700; margin-bottom:4px;" id="method-email">1,051</div>
          <div style="font-size:12px; color:var(--text-secondary); margin-bottom:8px;">企业邮箱</div>
          <div style="font-size:12px; color:var(--text-secondary);">45%</div>
        </div>
        <div style="padding:20px; background:var(--bg); border-radius:6px; text-align:center; cursor:pointer;" onclick="filterByMethod('contract')">
          <div style="font-size:24px; color:#10b981; font-weight:700; margin-bottom:4px;" id="method-contract">703</div>
          <div style="font-size:12px; color:var(--text-secondary); margin-bottom:8px;">劳动合同</div>
          <div style="font-size:12px; color:var(--text-secondary);">30%</div>
        </div>
        <div style="padding:20px; background:var(--bg); border-radius:6px; text-align:center; cursor:pointer;" onclick="filterByMethod('tax')">
          <div style="font-size:24px; color:#10b981; font-weight:700; margin-bottom:4px;" id="method-tax">422</div>
          <div style="font-size:12px; color:var(--text-secondary); margin-bottom:8px;">个人所得税</div>
          <div style="font-size:12px; color:var(--text-secondary);">18%</div>
        </div>
        <div style="padding:20px; background:var(--bg); border-radius:6px; text-align:center; cursor:pointer;" onclick="filterByMethod('other')">
          <div style="font-size:24px; color:#10b981; font-weight:700; margin-bottom:4px;" id="method-other">165</div>
          <div style="font-size:12px; color:var(--text-secondary); margin-bottom:8px;">其他材料</div>
          <div style="font-size:12px; color:var(--text-secondary);">7%</div>
        </div>
      </div>
    </div>

    <!-- 员工列表 -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">在职员工列表</span>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <input type="text" id="emp-search-name" placeholder="姓名..." style="width:120px; padding:6px 8px; border:1px solid var(--border); border-radius:4px; background:var(--card-bg); color:var(--text);"/>
          <input type="text" id="emp-search-id" placeholder="身份证号..." style="width:140px; padding:6px 8px; border:1px solid var(--border); border-radius:4px; background:var(--card-bg); color:var(--text);"/>
          <select id="emp-search-status" style="width:120px; padding:6px 8px; border:1px solid var(--border); border-radius:4px; background:var(--card-bg); color:var(--text);">
            <option value="">全部状态</option>
            <option value="pending">待审核</option>
            <option value="approved">已通过</option>
            <option value="rejected">已驳回</option>
          </select>
          <button class="btn btn-sm btn-secondary" onclick="loadEmployeeOverviewTable()">搜索</button>
        </div>
      </div>
      <table style="width:100%; font-size:12px;">
        <thead>
          <tr style="border-bottom:1px solid var(--border); background:var(--bg);">
            <th style="text-align:center; padding:12px; width:40px;"><input type="checkbox"/></th>
            <th style="text-align:left; padding:12px;">账号</th>
            <th style="text-align:left; padding:12px;">真实姓名</th>
            <th style="text-align:left; padding:12px;">LenovoID</th>
            <th style="text-align:left; padding:12px;">关联手机号</th>
            <th style="text-align:left; padding:12px;">岗位信息</th>
            <th style="text-align:left; padding:12px;">所属企业</th>
            <th style="text-align:left; padding:12px;">职员认证状态</th>
            <th style="text-align:left; padding:12px;">认证方式</th>
            <th style="text-align:left; padding:12px;">认证时间</th>
            <th style="text-align:left; padding:12px;">当前状态</th>
            <th style="text-align:left; padding:12px;">操作</th>
          </tr>
        </thead>
        <tbody id="emp-overview-tbody">
          <tr><td colspan="13" style="text-align:center; padding:20px;">加载中...</td></tr>
        </tbody>
      </table>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px;">
        <div style="color:var(--text-secondary); font-size:12px;">
          共 <span id="emp-overview-count">0</span> 条记录，当前第 <span id="emp-overview-page">1</span> 页，共 <span id="emp-overview-total-pages">1</span> 页
        </div>
        <div style="display:flex; gap:8px;">
          <button id="emp-overview-prev-btn" class="btn btn-sm btn-secondary" onclick="loadEmployeeOverviewTable(Math.max(1, parseInt(document.getElementById('emp-overview-page').textContent) - 1))">上一页</button>
          <button id="emp-overview-next-btn" class="btn btn-sm btn-secondary" onclick="loadEmployeeOverviewTable(parseInt(document.getElementById('emp-overview-page').textContent) + 1)">下一页</button>
        </div>
      </div>
    </div>
  `,

  'employee.list': () => `
    <div class="page-header">
      <div>
        <div class="page-title">员工列表</div>
        <div class="page-desc">查看、搜索在职员工信息</div>
      </div>
      <button class="btn btn-primary" onclick="exportEmployeeList()">📥 导出</button>
    </div>
    <div class="card">
      <div class="card-header">
        <span class="card-title">在职员工列表</span>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <input type="text" id="emp-search-name" placeholder="姓名..." style="width:120px; padding:6px 8px; border:1px solid var(--border); border-radius:4px; background:var(--card-bg); color:var(--text);"/>
          <input type="text" id="emp-search-id" placeholder="身份证号..." style="width:140px; padding:6px 8px; border:1px solid var(--border); border-radius:4px; background:var(--card-bg); color:var(--text);"/>
          <select id="emp-search-status" style="width:120px; padding:6px 8px; border:1px solid var(--border); border-radius:4px; background:var(--card-bg); color:var(--text);">
            <option value="">全部状态</option>
            <option value="pending">待审核</option>
            <option value="approved">已通过</option>
            <option value="rejected">已驳回</option>
          </select>
          <button class="btn btn-sm btn-secondary" onclick="loadEmployeeList(1)">搜索</button>
        </div>
      </div>
      <table style="width:100%; font-size:12px;">
        <thead>
          <tr style="border-bottom:1px solid var(--border); background:var(--bg);">
            <th style="text-align:center; padding:12px; width:40px;"><input type="checkbox"/></th>
            <th style="text-align:left; padding:12px;">账号</th>
            <th style="text-align:left; padding:12px;">真实姓名</th>
            <th style="text-align:left; padding:12px;">LenovoID</th>
            <th style="text-align:left; padding:12px;">关联手机号</th>
            <th style="text-align:left; padding:12px;">岗位信息</th>
            <th style="text-align:left; padding:12px;">所属企业</th>
            <th style="text-align:left; padding:12px;">职员认证状态</th>
            <th style="text-align:left; padding:12px;">认证方式</th>
            <th style="text-align:left; padding:12px;">认证时间</th>
            <th style="text-align:left; padding:12px;">当前状态</th>
            <th style="text-align:left; padding:12px;">操作</th>
          </tr>
        </thead>
        <tbody id="emp-list-tbody">
          <tr><td colspan="13" style="text-align:center; padding:20px;">加载中...</td></tr>
        </tbody>
      </table>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px;">
        <div style="color:var(--text-secondary); font-size:12px;">
          共 <span id="emp-total-count">0</span> 条记录，当前第 <span id="emp-current-page">1</span> 页，共 <span id="emp-total-pages">1</span> 页
        </div>
        <div style="display:flex; gap:8px;">
          <button id="emp-prev-btn" class="btn btn-sm btn-secondary" onclick="loadEmployeeList(Math.max(1, parseInt(document.getElementById('emp-current-page').textContent) - 1))">上一页</button>
          <button id="emp-next-btn" class="btn btn-sm btn-secondary" onclick="loadEmployeeList(parseInt(document.getElementById('emp-current-page').textContent) + 1)">下一页</button>
        </div>
      </div>
    </div>
  `,

  'employee.certification': () => `
    <div class="page-header">
      <div>
        <div class="page-title">✓ 认证审核管理</div>
        <div class="page-desc">重待审批的在职人员认证申请</div>
      </div>
    </div>

    <!-- 标签页 -->
    <div style="display:flex; gap:0; margin-bottom:0; border-bottom:2px solid var(--border);">
      <button class="tab-btn" data-status="pending" onclick="switchCertTab('pending', this)" style="padding:12px 24px; border:none; background:none; color:var(--text-secondary); cursor:pointer; border-bottom:3px solid transparent; font-size:14px;" id="tab-pending">
        <span style="color:#10b981;">待审核/期待奖活动</span> <span style="color:var(--text-secondary);">(51)</span>
      </button>
      <button class="tab-btn" data-status="approved" onclick="switchCertTab('approved', this)" style="padding:12px 24px; border:none; background:none; color:var(--text-secondary); cursor:pointer; border-bottom:3px solid transparent; font-size:14px;">
        <span>已通过</span> <span style="color:var(--green);">(2,341)</span>
      </button>
      <button class="tab-btn" data-status="rejected" onclick="switchCertTab('rejected', this)" style="padding:12px 24px; border:none; background:none; color:var(--text-secondary); cursor:pointer; border-bottom:3px solid transparent; font-size:14px;">
        <span>已拒绝</span> <span style="color:var(--red);">(156)</span>
      </button>
    </div>

    <div class="card" style="border-radius:0; border-top:2px solid var(--red);">
      <!-- 搜索过滤区 -->
      <div style="padding:16px 20px; background:rgba(255,0,0,0.02); border-bottom:1px solid var(--border);">
        <div style="display:flex; gap:12px; flex-wrap:wrap;">
          <input type="text" id="cert-search-no" placeholder="搜索申请编号/座号" style="flex:1; min-width:200px; padding:8px 12px; border:1px solid var(--border); border-radius:4px; background:var(--card-bg); color:var(--text); font-size:13px;"/>
          <select id="cert-search-method" style="padding:8px 12px; border:1px solid var(--border); border-radius:4px; background:var(--card-bg); color:var(--text); font-size:13px;">
            <option value="">认证方式 - 全部</option>
            <option value="email">企业邮箱</option>
            <option value="contract">劳动合同</option>
            <option value="tax">个人所得税</option>
            <option value="other">其他材料</option>
          </select>
          <select id="cert-search-review-method" style="padding:8px 12px; border:1px solid var(--border); border-radius:4px; background:var(--card-bg); color:var(--text); font-size:13px;">
            <option value="">审核方式 - 全部</option>
            <option value="email">邮件审核</option>
            <option value="phone">电话审核</option>
            <option value="visit">现场审核</option>
          </select>
          <button class="btn btn-primary" onclick="loadCertificationTable()" style="padding:8px 24px; font-size:13px;">🔍 搜索</button>
        </div>
      </div>

      <!-- 认证列表表格 -->
      <table style="width:100%;">
        <thead>
          <tr style="border-bottom:1px solid var(--border); background:var(--bg);">
            <th style="text-align:center; padding:12px; font-size:12px; width:40px;">
              <input type="checkbox" style="cursor:pointer;"/>
            </th>
            <th style="text-align:left; padding:12px; font-size:12px;">申请编号</th>
            <th style="text-align:left; padding:12px; font-size:12px;">申请人</th>
            <th style="text-align:left; padding:12px; font-size:12px;">认证方式</th>
            <th style="text-align:left; padding:12px; font-size:12px;">认证身份</th>
            <th style="text-align:left; padding:12px; font-size:12px;">审核方式</th>
            <th style="text-align:left; padding:12px; font-size:12px;">申请时间</th>
            <th style="text-align:left; padding:12px; font-size:12px;">审核人</th>
            <th style="text-align:left; padding:12px; font-size:12px;">操作</th>
          </tr>
        </thead>
        <tbody id="cert-list-tbody">
          <tr><td colspan="9" style="text-align:center; padding:20px; color:var(--text-tertiary);">加载中...</td></tr>
        </tbody>
      </table>

      <!-- 分页 -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-top:1px solid var(--border); font-size:12px;">
        <div style="color:var(--text-secondary);">
          共 <span id="cert-total-count">0</span> 条记录 | 第 <span id="cert-current-page">1</span> 页 / 共 <span id="cert-total-pages">1</span> 页
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-sm btn-secondary" onclick="loadCertificationTable(Math.max(1, parseInt(document.getElementById('cert-current-page').textContent) - 1))">上一页</button>
          <span style="padding:4px 12px; border:1px solid var(--border); border-radius:4px; background:var(--bg);">
            <input type="number" id="cert-page-input" value="1" style="width:40px; text-align:center; border:none; background:transparent; color:var(--text);" min="1"/>
          </span>
          <button class="btn btn-sm btn-secondary" onclick="goToCertPage()">跳转</button>
          <button class="btn btn-sm btn-secondary" onclick="loadCertificationTable(parseInt(document.getElementById('cert-current-page').textContent) + 1)">下一页</button>
        </div>
      </div>
    </div>

    <!-- 审核详情面板 -->
    <div class="card" style="margin-top:24px;" id="cert-detail-card">
      <div class="card-header">
        <span class="card-title">审核详情</span>
      </div>
      <div style="padding:20px; text-align:center; color:var(--text-secondary); font-size:12px;">
        点击表格中的行查看详情
      </div>
    </div>
  `,

  'employee.cert-detail': () => {
    const cert = window.currentCertification;
    if (!cert) {
      return `<div class="page-header"><h1>认证详情</h1></div><div class="empty-state"><div>未找到申请数据</div></div>`;
    }

    const firstLetter = (cert.applicant_name || '-').charAt(0).toUpperCase();
    const applicantMasked = cert.applicant_name || '-';
    const methodLabel = cert.method === 'email' ? '企业邮箱' : cert.method === 'contract' ? '劳动合同' : cert.method === 'tax' ? '个人所得税' : '其他材料';

    return `
      <div style="padding:20px;">
        <button class="btn btn-secondary" onclick="switchPage('employee.certification')" style="margin-bottom:20px;">← 返回列表</button>

        <div style="display:grid; grid-template-columns: 280px 1fr; gap:30px;">
          <!-- 左侧用户卡片 -->
          <div class="card" style="height:fit-content; text-align:center;">
            <div style="width:100px; height:100px; border-radius:50%; background:linear-gradient(135deg, #3370ff, #06b6d4); color:#fff; font-size:40px; font-weight:700; display:flex; align-items:center; justify-content:center; margin:0 auto 16px;">
              ${firstLetter}
            </div>
            <div style="font-size:18px; font-weight:600; margin-bottom:4px;">${cert.applicant_name}</div>
            <div style="font-size:12px; color:var(--text-secondary); margin-bottom:16px;">昵称：${cert.nickname || '-'}</div>
            <div style="font-size:12px; color:var(--text-secondary); margin-bottom:16px;">LenovoID：${cert.lenovo_id || '-'}</div>

            <div style="border-top:1px solid var(--border); padding-top:12px; font-size:12px;">
              <div style="margin-bottom:8px;">申请时间：${cert.created_at}</div>
              <div style="margin-bottom:8px;">申请类型：${cert.cert_type || '首次申请'}</div>
              <div style="margin-top:8px;">
                <span style="display:inline-block; padding:4px 8px; background:#3370ff08; color:#3370ff; border-radius:3px; font-size:11px;">
                  ${cert.status === 'pending' ? '⏳ 待审核' : cert.status === 'approved' ? '✓ 已通过' : '✗ 已驳回'}
                </span>
              </div>
            </div>
          </div>

          <!-- 右侧信息区 -->
          <div style="display:flex; flex-direction:column; gap:20px;">
            <!-- 申请基本信息 -->
            <div class="card">
              <div class="card-header">
                <span class="card-title">申请基本信息</span>
              </div>
              <div style="padding:20px;">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; font-size:13px;">
                  <div>
                    <div style="color:var(--text-secondary); margin-bottom:4px;">申请编号</div>
                    <div style="font-weight:600;">${cert.id}</div>
                  </div>
                  <div>
                    <div style="color:var(--text-secondary); margin-bottom:4px;">申请类型</div>
                    <div>${cert.cert_type || '首次申请'}</div>
                  </div>
                  <div>
                    <div style="color:var(--text-secondary); margin-bottom:4px;">认证方式</div>
                    <div>${methodLabel}</div>
                  </div>
                  <div>
                    <div style="color:var(--text-secondary); margin-bottom:4px;">认证身份</div>
                    <div>${cert.identity}</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 用户信息审核 -->
            <div class="card">
              <div class="card-header">
                <span class="card-title">用户信息审核</span>
              </div>
              <div style="padding:20px;">
                <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-bottom:1px solid var(--border);">
                  <div>
                    <div style="font-weight:600;">真实姓名</div>
                    <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">${cert.real_name || cert.applicant_name}</div>
                  </div>
                  <div style="color:#34c724; font-size:14px;">✓ 与实名认证信息一致</div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-bottom:1px solid var(--border);">
                  <div>
                    <div style="font-weight:600;">企业信息</div>
                    <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">${cert.company || '-'}</div>
                  </div>
                  <div style="color:#34c724; font-size:14px;">✓ 已核实</div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 0;">
                  <div>
                    <div style="font-weight:600;">职位信息</div>
                    <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">${cert.position || '-'}</div>
                  </div>
                  <div style="color:#34c724; font-size:14px;">✓ 已核实</div>
                </div>
              </div>
            </div>

            <!-- 认证材料审核 -->
            <div class="card">
              <div class="card-header">
                <span class="card-title">认证材料审核</span>
              </div>
              <div style="padding:20px;">
                <div style="color:var(--text-secondary); font-size:12px; margin-bottom:12px;">已上传材料：</div>
                <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; margin-bottom:20px;">
                  <div style="aspect-ratio:1; background:var(--border); border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:40px; cursor:pointer; transition:all 0.2s;" onclick="showMaterialPreview('${cert.method}', '📄')" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='var(--border)'">
                    📄
                  </div>
                  <div style="aspect-ratio:1; background:var(--border); border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:40px; cursor:pointer; transition:all 0.2s;" onclick="showMaterialPreview('在职证明', '📄')" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='var(--border)'">
                    📄
                  </div>
                </div>

                <div style="color:var(--text-secondary); font-size:12px; margin-bottom:12px;">验证项：</div>
                <div style="display:flex; flex-direction:column; gap:8px; font-size:13px;">
                  <label><input type="checkbox" checked/> 姓名是否匹配</label>
                  <label><input type="checkbox" checked/> 企业名称是否匹配</label>
                  <label><input type="checkbox" checked/> 有效期是否符合（六个月内）</label>
                  <label><input type="checkbox" checked/> 印章是否清晰</label>
                </div>
              </div>
            </div>

            <!-- 审核操作 -->
            <div class="card">
              <div class="card-header">
                <span class="card-title">审核操作</span>
              </div>
              <div style="padding:20px;">
                <div style="margin-bottom:20px;">
                  <div style="color:var(--text-secondary); font-size:12px; margin-bottom:12px;">审核结论</div>
                  <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                    <input type="radio" name="review-conclusion" id="cert-review-approve" value="approve" checked/>
                    <span>✓ 通过</span>
                  </label>
                  <label style="display:flex; align-items:center; gap:8px;">
                    <input type="radio" name="review-conclusion" id="cert-review-reject" value="reject"/>
                    <span>✗ 拒绝</span>
                  </label>
                </div>

                <div style="margin-bottom:20px;">
                  <label style="display:block; color:var(--text-secondary); font-size:12px; margin-bottom:8px;">审核意见（可选）</label>
                  <textarea id="cert-review-remark" style="width:100%; height:80px; padding:8px; border:1px solid var(--border); border-radius:4px; background:var(--card-bg); color:var(--text); font-size:12px;" placeholder="请输入审核意见"></textarea>
                </div>

                <div style="display:flex; gap:8px;">
                  <button class="btn btn-primary" onclick="submitCertReview('${cert.id}')" style="flex:1; background:#34c724; border:none;">✓ 提交审核</button>
                  <button class="btn btn-secondary" onclick="switchPage('employee.certification')" style="flex:1;">取消</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  'employee.detail': () => {
    const emp = window.currentEmployee;
    if (!emp) {
      return `<div class="page-header"><h1>员工信息</h1></div><div class="empty-state"><div>未找到员工数据</div></div>`;
    }

    const firstLetter = (emp.real_name || '-').charAt(0).toUpperCase();
    const accountMasked = emp.account ? emp.account.slice(0, 2) + '*'.repeat(4) + emp.account.slice(-2) : '-';
    const statusBadgeColor = emp.is_realname?.includes('✓') ? '#34c724' : '#999';

    return `
      <div style="padding:20px;">
        <button class="btn btn-secondary" onclick="switchPage('employee.overview')" style="margin-bottom:20px;">← 返回列表</button>

        <div style="display:grid; grid-template-columns: 280px 1fr; gap:30px;">
          <!-- 左侧用户卡片 -->
          <div style="display:flex; flex-direction:column; gap:16px;">
            <div class="card" style="text-align:center; padding:30px 20px;">
              <div style="width:120px; height:120px; border-radius:50%; background:linear-gradient(135deg, #3370ff, #06b6d4); color:#fff; font-size:48px; font-weight:700; display:flex; align-items:center; justify-content:center; margin:0 auto 16px;">
                ${firstLetter}
              </div>
              <div style="font-size:18px; font-weight:600; margin-bottom:4px;">${emp.real_name || '-'}</div>
              <div style="font-size:12px; color:var(--text-secondary); margin-bottom:12px;">账号: ${accountMasked}</div>
              <div style="font-size:12px; color:var(--text-secondary); margin-bottom:16px;">LenovoID: ${emp.lenovo_id || '-'}</div>
              <div style="font-size:12px; color:var(--text-secondary); margin-bottom:16px;">联想账号</div>
              <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
                <span style="display:inline-block; padding:4px 8px; background:#34c72408; color:#34c724; border-radius:3px; font-size:12px;">✓ 已实名</span>
                <span style="display:inline-block; padding:4px 8px; background:#3370ff08; color:#3370ff; border-radius:3px; font-size:12px;">${emp.dept_status || '-'}</span>
              </div>
            </div>
          </div>

          <!-- 右侧信息区域 -->
          <div style="display:flex; flex-direction:column; gap:20px;">
            <!-- 个人基本信息 -->
            <div class="card">
              <div class="card-header">
                <span class="card-title">个人基本信息</span>
              </div>
              <div style="padding:20px;">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                  <div>
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">真实姓名</div>
                    <div style="font-size:14px;">${emp.real_name || '-'}</div>
                  </div>
                  <div>
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">岗位</div>
                    <div style="font-size:14px;">${emp.position || '-'}</div>
                  </div>
                  <div>
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">性别</div>
                    <div style="font-size:14px;">${emp.gender || '-'}</div>
                  </div>
                  <div>
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">生日</div>
                    <div style="font-size:14px;">${emp.birthday || '-'}</div>
                  </div>
                  <div>
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">关联手机号</div>
                    <div style="font-size:14px;">${emp.phone || '-'}</div>
                  </div>
                  <div>
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">居住地</div>
                    <div style="font-size:14px;">${emp.address || '-'}</div>
                  </div>
                  <div>
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">注册时间</div>
                    <div style="font-size:14px;">${emp.register_time || '-'}</div>
                  </div>
                  <div>
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">用户类型</div>
                    <div style="font-size:14px;">${emp.user_type || '-'}</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 会员信息 -->
            <div class="card">
              <div class="card-header">
                <span class="card-title">会员信息</span>
              </div>
              <div style="padding:20px;">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                  <div>
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">成为企业会员时间</div>
                    <div style="font-size:14px;">${emp.register_time?.split(' ')[0] || '-'}</div>
                  </div>
                  <div>
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">会员等级</div>
                    <div style="font-size:14px;">
                      <span style="display:inline-block; padding:2px 6px; background:#3370ff08; color:#3370ff; border-radius:3px; font-size:12px;">${emp.member_level || '-'}</span>
                    </div>
                  </div>
                  <div>
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">企业等级</div>
                    <div style="font-size:14px;">
                      <span style="display:inline-block; padding:2px 6px; background:#f5a62408; color:#f5a624; border-radius:3px; font-size:12px;">黄金会员</span>
                    </div>
                  </div>
                  <div>
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">激活状态</div>
                    <div style="font-size:14px;">
                      <span style="display:inline-block; padding:2px 6px; background:#34c72408; color:#34c724; border-radius:3px; font-size:12px;">${emp.activation_status || '-'}</span>
                    </div>
                  </div>
                  <div>
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">黑金VIP</div>
                    <div style="font-size:14px;">${emp.vip_status || '-'}</div>
                  </div>
                  <div>
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">注册渠道</div>
                    <div style="font-size:14px;">LENOVO_SHOP_PC</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 企业信息 -->
            <div class="card">
              <div class="card-header">
                <span class="card-title">企业信息</span>
              </div>
              <div style="padding:20px;">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                  <div>
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">所属企业</div>
                    <div style="font-size:14px;">${emp.company_name || '-'}</div>
                  </div>
                  <div>
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">企业号</div>
                    <div style="font-size:14px;">${emp.company_code || '-'}</div>
                  </div>
                  <div style="grid-column:1/-1;">
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">企业邮箱</div>
                    <div style="font-size:14px;">${emp.email || '-'}</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 职员认证信息 -->
            <div class="card">
              <div class="card-header">
                <span class="card-title">职员认证信息</span>
              </div>
              <div style="padding:20px;">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:20px;">
                  <div>
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">职员认证状态</div>
                    <div style="font-size:14px;">
                      <span style="display:inline-block; padding:4px 8px; background:#3370ff08; color:#3370ff; border-radius:3px; font-size:12px;">${emp.dept_status || '-'}</span>
                    </div>
                  </div>
                  <div>
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">职员认证方式</div>
                    <div style="font-size:14px;">${emp.cert_method || '-'}</div>
                  </div>
                  <div>
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">认证职员信息时间</div>
                    <div style="font-size:14px;">${emp.cert_start_date || '-'}</div>
                  </div>
                  <div>
                    <div style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">认证失效时间</div>
                    <div style="font-size:14px;">${emp.cert_end_date || '-'}</div>
                  </div>
                </div>

                <div style="border-top:1px solid var(--border); padding-top:16px;">
                  <div style="color:var(--text-secondary); font-size:12px; margin-bottom:12px;">企业邮箱验证记录</div>
                  <div style="display:flex; flex-direction:column; gap:8px; font-size:12px;">
                    <div>✓ 邮箱: ${emp.email || '-'}</div>
                    <div>✓ 验证状态: ${emp.cert_verified || '-'}</div>
                    <div>✓ 验证时间: ${emp.cert_start_date || '-'}</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 认证材料 -->
            <div class="card">
              <div class="card-header">
                <span class="card-title">认证材料</span>
              </div>
              <div style="padding:20px;">
                <div style="color:var(--text-secondary); font-size:12px; margin-bottom:12px;">上传的认证材料</div>
                <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:12px;">
                  <div style="aspect-ratio:1; background:var(--border); border-radius:6px; display:flex; align-items:center; justify-content:center; color:var(--text-secondary); font-size:12px; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='var(--border)'" onclick="showMaterialPreview('劳动合同', '📄')">
                    📄 劳动合同
                  </div>
                  <div style="aspect-ratio:1; background:var(--border); border-radius:6px; display:flex; align-items:center; justify-content:center; color:var(--text-secondary); font-size:12px; cursor:pointer; transition:all 0.2s;" onmouseover="this.style.background='#d1d5db'" onmouseout="this.style.background='var(--border)'" onclick="showMaterialPreview('在职证明', '📄')">
                    📄 在职证明
                  </div>
                </div>
                <div style="color:var(--text-secondary); font-size:12px; margin-top:12px;">点击图围可查看大图</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },
};
