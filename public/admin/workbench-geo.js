// ===== GEO DASHBOARD JS (真实数据来自点亮AI /api/geo/overview) =====
// 项目 project_id=143（联想乐享），通过 sources 参数切片不同站点
const GEO_PROJECT_ID = 143;
// scope → sources 切片：all=不传（整体），leai=乐享站，official=官网
const GEO_SOURCES = {
  all: null,
  leai: ['leai.lenovo.com.cn'],
  official: ['www.lenovo.com.cn', 'shop.lenovo.com.cn'],
};
// 联想乐享项目(143) 点亮AI 实际开启的平台：豆包/DeepSeek/元宝/Kimi（千问/文心/夸克未开启）
const GEO_PLATFORMS = ['doubao','deepseek','yuanbao','kimi'];
const geoState = { scope:'all', platform:'all', period:'30d', questions:[], apiData:null, platData:{} };
const geoPlatNames = { doubao:'豆包', deepseek:'DeepSeek', yuanbao:'元宝', kimi:'Kimi' };
const geoPlatColors = { doubao:'#6366f1', deepseek:'#3b82f6', yuanbao:'#10b981', kimi:'#f59e0b' };

function geoSetScope(el) {
  document.querySelectorAll('.geo-scope-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active'); geoState.scope = el.dataset.scope; geoLoadData();
}
function geoTogglePlatform(el) {
  const m = el.dataset.model;
  if (m === 'all') {
    document.querySelectorAll('.geo-pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active'); geoState.platform = 'all';
  } else {
    document.querySelector('.geo-pill[data-model="all"]').classList.remove('active');
    el.classList.toggle('active');
    const act = document.querySelectorAll('.geo-pill.active:not([data-model="all"])');
    if (!act.length) { document.querySelector('.geo-pill[data-model="all"]').classList.add('active'); geoState.platform = 'all'; }
    else geoState.platform = Array.from(act).map(p => p.dataset.model).join(',');
  }
  geoLoadData();
}
async function geoFetch(models) {
  const body = { project_id: GEO_PROJECT_ID, period: geoState.period || '30d' };
  if (models && models.length) body.models = models;
  const srcs = GEO_SOURCES[geoState.scope];
  if (srcs && srcs.length) body.sources = srcs;
  if (geoState.questions && geoState.questions.length) body.questions = geoState.questions;
  const resp = await fetch('/api/geo/overview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return resp.json();
}

function geoSetPeriod(v) { geoState.period = v; geoLoadData(); }
function geoSetQuestions(text) {
  geoState.questions = (text || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
  geoLoadData();
}

function geoSetStatus(text, isError) {
  const s = document.getElementById('geo-status');
  if (s) { s.textContent = text; s.style.color = isError ? 'var(--red)' : 'var(--text-tertiary)'; }
}
function geoFmtPct(v) { return (v == null || v === '' || isNaN(v)) ? '—' : (+v).toFixed(2) + '%'; }

async function geoLoadData() {
  if (!document.getElementById('gv-brand-visible')) return; // 页面尚未渲染
  geoSetStatus('加载中...');
  const selectedModels = geoState.platform === 'all' ? [] : geoState.platform.split(',');
  try {
    // 第一步：拉总体 overview，先渲染 KPI（最快，~0.2s）
    const data = await geoFetch(selectedModels);
    if (data.code !== 200) throw new Error(data.message || '请求失败');
    geoState.apiData = data;
    geoRenderKpis(data);
    geoRenderEcology(data);

    const scopeLbl = { all:'整体', leai:'联想乐享', official:'联想官网' }[geoState.scope] || '整体';
    geoSetStatus('更新于 ' + new Date().toLocaleTimeString() + ' · 点亮AI · ' + scopeLbl + ' · ' + geoState.period);

    // 第二步：剩余请求全部并发，互不阻塞
    // 平台分布 + sites + questions 同时发出
    const platPromise = Promise.allSettled(GEO_PLATFORMS.map(p => geoFetch([p])));
    const sitesPromise = geoLoadSites();
    const questionsPromise = geoLoadQuestions();

    // 平台分布完成后立即渲染
    platPromise.then(results => {
      geoState.platData = {};
      GEO_PLATFORMS.forEach((p, i) => {
        if (results[i].status === 'fulfilled' && results[i].value.code === 200) {
          geoState.platData[p] = results[i].value;
        }
      });
      geoRenderPlatDist();
    });

    // sites 和 questions 各自内部已有渲染逻辑，无需额外处理
  } catch (e) {
    geoSetStatus('加载失败：' + e.message, true);
    console.error('GEO API error', e);
  }
}

function geoRenderKpis(data) {
  const bcm = data.brand_coverage_metrics || {};
  const cm = data.conversion_metrics || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  // 品牌声量：可见度
  set('gv-brand-visible', geoFmtPct(bcm.brand_exposure_rate));
  set('gv-comp-visible', geoFmtPct(bcm.competitor_exposure_rate));
  // 商品曝光：推荐率/前三率/置顶率
  set('gv-brand-rec', geoFmtPct(cm.brand_priority_rate));
  set('gv-comp-rec', geoFmtPct(cm.competitor_priority_rate));
  set('gv-brand-top3', geoFmtPct(cm.brand_top3_rate));
  set('gv-comp-top3', geoFmtPct(cm.competitor_top3_rate));
  set('gv-brand-top1', geoFmtPct(cm.brand_top1_rate));
  set('gv-comp-top1', geoFmtPct(cm.competitor_top1_rate));
}

function geoRenderEcology(data) {
  const cem = data.content_ecology_metrics || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = (v || 0).toLocaleString(); };
  set('gv-wiki-cite', cem.wiki_citation_count);
  set('gv-lenovo-cite', cem.lenovo_citation_count);
}

function geoRenderPlatDist() {
  const c = document.getElementById('geo-plat-dist'); if (!c) return;
  const pd = geoState.platData;
  const rows = GEO_PLATFORMS.map(p => {
    const d = pd[p];
    if (!d) return { p, cites: 0, brand: 0, missing: true };
    const cem = d.content_ecology_metrics || {};
    const bcm = d.brand_coverage_metrics || {};
    return {
      p,
      cites: (cem.wiki_citation_count || 0) + (cem.lenovo_citation_count || 0),
      brand: bcm.brand_exposure_rate || 0,
      missing: false,
    };
  });
  const mx = Math.max(...rows.map(r => r.cites), 1);
  c.innerHTML = rows.map(r => {
    const color = geoPlatColors[r.p] || '#3b82f6';
    const pct = Math.min(r.brand, 100).toFixed(0);
    if (r.missing) {
      return `<div class="geo-plat-card"><div class="gpc-name">${geoPlatNames[r.p] || r.p}</div><div style="color:#6b7390;font-size:11px">无数据</div></div>`;
    }
    return `<div class="geo-plat-card">
      <div class="gpc-name">${geoPlatNames[r.p] || r.p}</div>
      <div class="gpc-row"><span>引用次数</span><span class="gpc-val">${r.cites.toLocaleString()}</span></div>
      <div class="gpc-row"><span>品牌可见度</span><span class="gpc-val">${r.brand.toFixed(1)}%</span></div>
      <div class="gpc-bar"><div class="gpc-bar-fill" style="width:${pct}%;background:${color}"></div></div>
    </div>`;
  }).join('');
}

// ===== GEO 信源分布 (sites API) =====
const GEO_TREEMAP_COLORS = ['#2563eb','#059669','#d97706','#dc2626','#7c3aed','#0891b2','#be185d','#4f46e5','#15803d','#b45309','#9333ea','#0e7490','#be123c','#6366f1','#047857','#ea580c'];

async function geoLoadSites() {
  try {
    const body = { project_id: GEO_PROJECT_ID };
    const resp = await fetch('/api/geo/sites', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const json = await resp.json();
    if (json.code !== 200) return;
    const d = json.data;
    const sites = d.sites || [];
    geoRenderTreemap(sites);
    geoRenderSiteRank(sites);
    const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    set('gv-sites-total', (d.total_records||0).toLocaleString());
    if (sites.length) { set('gv-sites-top1-name', sites[0].name); set('gv-sites-top1-pct', sites[0].percentage + '%'); }
  } catch(e) { console.error('geoLoadSites', e); }
}

function geoRenderTreemap(sites) {
  const c = document.getElementById('geo-sites-treemap'); if(!c) return;
  const top = sites.slice(0, 20);
  const totalPct = top.reduce((s,x) => s + x.percentage, 0);
  if (!top.length) { c.innerHTML = '<div style="color:#9ca3af;font-size:12px;padding:20px;text-align:center">暂无数据</div>'; return; }
  c.innerHTML = '<div class="geo-treemap">' + top.map((s, i) => {
    const bg = GEO_TREEMAP_COLORS[i % GEO_TREEMAP_COLORS.length];
    const flex = Math.max(s.percentage / totalPct * 100, 3);
    return `<div class="gtm-cell" style="flex:${flex};background:${bg};min-width:60px;min-height:50px" title="${s.domain} · ${s.count.toLocaleString()}次 · ${s.percentage}%"><span class="gtm-name">${s.name}</span><span class="gtm-pct">${s.percentage}%</span></div>`;
  }).join('') + '</div>';
}

function geoRenderSiteRank(sites) {
  const c = document.getElementById('geo-sites-rank'); if(!c) return;
  const top = sites.slice(0, 20);
  if (!top.length) { c.innerHTML = '<div style="color:#9ca3af;font-size:12px;padding:20px;text-align:center">暂无数据</div>'; return; }
  c.innerHTML = '<ol class="geo-rank-list">' + top.map(s =>
    `<li><span class="grl-idx">${s.rank}</span><span class="grl-name" title="${s.domain}">${s.name}</span><span class="grl-count">${s.count.toLocaleString()} · ${s.percentage}%</span></li>`
  ).join('') + '</ol>';
}

// ===== GEO 问题列表 (questions API) =====
const GEO_FIELD_LABELS = { brand_composite_exposure_rate:'品牌综合可见', brand_precise_exposure_rate:'品牌精准可见', competitor_exposure_rate:'竞品可见', brand_exposure_rate:'品牌曝光率', brand_top3_rate:'品牌前三率' };

async function geoLoadQuestions() {
  try {
    const body = { project_id: GEO_PROJECT_ID };
    const resp = await fetch('/api/geo/questions', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const json = await resp.json();
    if (json.code !== 200) return;
    const qs = json.data.questions || [];
    const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    set('gv-q-count', qs.length);
    geoRenderQuestions(qs);
  } catch(e) { console.error('geoLoadQuestions', e); }
}

function geoRenderQuestions(qs) {
  const c = document.getElementById('geo-questions-table'); if(!c) return;
  if (!qs.length) { c.innerHTML = '<div style="color:#9ca3af;font-size:12px;padding:20px;text-align:center">暂无问题</div>'; return; }
  const fieldKeys = [];
  if (qs[0].models && qs[0].models[0] && qs[0].models[0].fields) qs[0].models[0].fields.forEach(f => fieldKeys.push(f.field));
  const models = (qs[0].models || []).map(m => m.model);
  let html = '<table class="geo-intent-table" style="width:100%"><thead><tr><th style="text-align:left;min-width:180px">问题</th>';
  models.forEach(m => { const name = geoPlatNames[m] || m; fieldKeys.forEach(f => { html += `<th>${name}<br><span style="font-size:10px;font-weight:400">${GEO_FIELD_LABELS[f] || f}</span></th>`; }); });
  html += '</tr></thead><tbody>';
  qs.forEach(q => {
    html += `<tr><td class="name" title="${q.question}">${q.question.length > 20 ? q.question.slice(0,20)+'…' : q.question}</td>`;
    models.forEach(m => { const md = (q.models || []).find(x => x.model === m); fieldKeys.forEach(f => { const fd = md && (md.fields || []).find(x => x.field === f); const v = fd ? fd.value : '-'; const cls = v === '是' ? 'yes' : (v === '否' ? 'no' : ''); html += `<td class="${cls}">${v}</td>`; }); });
    html += '</tr>';
  });
  html += '</tbody></table>';
  c.innerHTML = html;
}

// ===== GEO 知识库 tab 切换 =====
function switchKbTab(tab, el) {
  ['upload','qa','docs','qalist'].forEach(t => { const d = document.getElementById('kb-tab-' + t); if (d) d.style.display = t === tab ? '' : 'none'; });
  if (el) { el.parentElement.querySelectorAll('.tab-item').forEach(t => { t.style.borderBottomColor = 'transparent'; t.style.color = 'var(--text-tertiary)'; }); el.style.borderBottomColor = 'var(--primary)'; el.style.color = 'var(--primary)'; }
  if (tab === 'docs') loadKnowledgeDocs();
  if (tab === 'qalist') loadKnowledgeQA();
}

// ===== GEO 各平台信源分布子页 =====
let geoSourcePage = 1;
async function geoLoadSourcePage(page) {
  geoSourcePage = page || 1;
  const modelSel = document.getElementById('geo-source-model');
  const model = modelSel ? modelSel.value : 'all';
  const st = document.getElementById('geo-source-status');
  const c = document.getElementById('geo-source-list');
  if (st) st.textContent = '加载中...';
  try {
    const body = { project_id: GEO_PROJECT_ID, model: model === 'all' ? '' : model, page: geoSourcePage };
    const resp = await fetch('/api/geo/sites', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const json = await resp.json();
    if (json.code !== 200) throw new Error(json.message);
    const d = json.data; const sites = d.sites || []; const pg = d.pagination || {};
    if (st) st.textContent = `共 ${(d.total_records||0).toLocaleString()} 个站点 · 第 ${pg.current_page}/${pg.total_pages} 页`;
    if (!c) return;
    c.innerHTML = '<table class="geo-intent-table" style="width:100%"><thead><tr><th style="width:50px">排名</th><th style="text-align:left">站点</th><th style="text-align:left">域名</th><th>引用次数</th><th>占比</th></tr></thead><tbody>' +
      sites.map(s => `<tr><td>${s.rank}</td><td class="name">${s.name}</td><td class="name" style="font-size:11px;color:#6b7280">${s.domain}</td><td>${s.count.toLocaleString()}</td><td>${s.percentage}%</td></tr>`).join('') + '</tbody></table>';
    const pager = document.getElementById('geo-source-pager');
    if (pager && pg.total_pages > 1) {
      let ph = '';
      if (pg.has_prev) ph += `<button onclick="geoLoadSourcePage(${pg.prev_page})" style="margin:0 4px;padding:4px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:12px">上一页</button>`;
      ph += `<span style="font-size:12px;color:#6b7280;margin:0 8px">第 ${pg.current_page} / ${pg.total_pages} 页</span>`;
      if (pg.has_next) ph += `<button onclick="geoLoadSourcePage(${pg.next_page})" style="margin:0 4px;padding:4px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:12px">下一页</button>`;
      pager.innerHTML = ph;
    } else if (pager) { pager.innerHTML = ''; }
  } catch(e) { if (st) st.textContent = '加载失败：' + e.message; console.error('geoLoadSourcePage', e); }
}
