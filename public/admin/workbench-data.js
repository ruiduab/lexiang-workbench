// ===== DATA LOADERS =====
async function loadSkills() {
  try {
    const res = await fetch('/api/harness/skills/grouped');
    const data = await res.json();
    const container = document.getElementById('skills-list');
    if (!container) return;

    let html = '';
    for (const [ns, skills] of Object.entries(data.grouped)) {
      html += `<div class="card"><div class="card-header"><div class="card-title">📦 ${ns}</div><div style="font-size:11px;color:var(--text-tertiary)">${skills.length} 个技能</div></div>`;
      html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">`;
      for (const skill of skills) {
        html += `<div class="skill-card">
          <div class="sc-icon">⚡</div>
          <div><div class="sc-name">${skill.name}</div><div class="sc-ns">${skill.description || ''}</div></div>
          <div class="skill-toggle">
            <label class="toggle"><input type="checkbox" ${skill.enabled ? 'checked' : ''} onchange="toggleSkill('${skill.name}',this.checked)"><span class="slider"></span></label>
          </div>
        </div>`;
      }
      html += `</div></div>`;
    }
    container.innerHTML = html || '<div class="empty-state"><div class="title">暂无 Skill</div></div>';
  } catch (e) {
    const c = document.getElementById('skills-list');
    if (c) c.innerHTML = `<div style="color:var(--red);padding:20px">加载失败: ${e.message}</div>`;
  }
}

async function toggleSkill(name, enabled) {
  await fetch(`/api/admin/skills/${name}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled })
  });
}

async function loadRoles() {
  try {
    const res = await fetch('/api/harness/roles');
    const data = await res.json();
    const container = document.getElementById('roles-list');
    if (!container) return;

    let html = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">';
    for (const role of data.roles) {
      const perms = Array.isArray(role.permissions) ? role.permissions : [];
      const menus = Array.isArray(role.menu_tree) ? role.menu_tree : [];
      html += `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div class="card-title">${role.display_name}</div>
          ${role.is_system ? '<span class="badge status-on" style="font-size:10px">系统</span>' : '<span class="badge status-off" style="font-size:10px">自定义</span>'}
        </div>
        <div style="font-size:12px;color:var(--text-secondary);margin:8px 0">${role.description || ''}</div>
        <div style="font-size:11px;color:var(--text-tertiary)">
          <div>权限: ${perms.length > 3 ? perms.slice(0,3).join(', ') + '...' : perms.join(', ')}</div>
          <div style="margin-top:2px">菜单: ${menus.join(', ')}</div>
        </div>
      </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
  } catch (e) {
    const c = document.getElementById('roles-list');
    if (c) c.innerHTML = `<div style="color:var(--red);padding:20px">加载失败: ${e.message}</div>`;
  }
}

async function loadServiceStatus() {
  try {
    const res = await fetch('/health');
    const data = await res.json();
    const container = document.getElementById('service-status');
    if (!container) return;

    container.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-label">版本</div><div class="kpi-value" style="font-size:18px">${data.version || '-'}</div></div>
        <div class="kpi-card"><div class="kpi-label">运行时长</div><div class="kpi-value" style="font-size:18px">${data.uptime || '-'}</div></div>
        <div class="kpi-card"><div class="kpi-label">内存</div><div class="kpi-value" style="font-size:18px">${data.memory?.rss || '-'}</div></div>
        <div class="kpi-card"><div class="kpi-label">数据库</div><div class="kpi-value" style="font-size:18px"><span class="badge status-on">正常</span></div></div>
      </div>`;
  } catch (e) {
    const c = document.getElementById('service-status');
    if (c) c.innerHTML = `<div style="color:var(--red);padding:20px">加载失败: ${e.message}</div>`;
  }
}

// ===== 通用分页组件 =====
function _renderPager(currentPage, totalPages, total, fnName) {
  if (totalPages <= 1) return '';
  let btns = '';
  btns += `<button class="btn btn-sm btn-secondary" ${currentPage <= 1 ? 'disabled' : ''} onclick="${fnName}(${currentPage - 1})">‹ 上一页</button>`;
  // 显示页码
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);
  if (start > 1) btns += `<button class="btn btn-sm btn-secondary" onclick="${fnName}(1)">1</button>`;
  if (start > 2) btns += `<span style="padding:0 4px;color:var(--text-tertiary)">…</span>`;
  for (let i = start; i <= end; i++) {
    btns += `<button class="btn btn-sm ${i === currentPage ? 'btn-primary' : 'btn-secondary'}" onclick="${fnName}(${i})">${i}</button>`;
  }
  if (end < totalPages - 1) btns += `<span style="padding:0 4px;color:var(--text-tertiary)">…</span>`;
  if (end < totalPages) btns += `<button class="btn btn-sm btn-secondary" onclick="${fnName}(${totalPages})">${totalPages}</button>`;
  btns += `<button class="btn btn-sm btn-secondary" ${currentPage >= totalPages ? 'disabled' : ''} onclick="${fnName}(${currentPage + 1})">下一页 ›</button>`;
  return `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;font-size:12px">
    <span style="color:var(--text-tertiary)">共 ${total} 条，${totalPages} 页</span>
    <div style="display:flex;gap:4px;align-items:center">${btns}</div>
  </div>`;
}

async function loadKnowledgeStats() {
  try {
    const res = await fetch('/api/admin/stats');
    if (!res.ok) return;
    const data = await res.json();
    const kb = data.knowledge || {};
    const s = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    s('stat-docs', (kb.docs || data.docCount || 0).toLocaleString());
    s('stat-vectors', (kb.vectors || 0).toLocaleString());
    s('stat-qa', (kb.qaPairs || 0).toLocaleString());
    s('stat-kg', (kb.kgEntities || 0).toLocaleString());
    // 加载三个tab数据
    loadKnowledgeDocs();
    loadKnowledgeQA();
    loadKnowledgeGraph();
  } catch {}
}

let _kbDocsPage = 1;
const _kbPageSize = 30;

async function loadKnowledgeDocs(page) {
  if (page !== undefined) _kbDocsPage = page;
  const container = document.getElementById('kb-docs');
  if (!container) return;
  try {
    const res = await fetch('/api/knowledge/?limit=' + _kbPageSize + '&page=' + _kbDocsPage);
    if (!res.ok) {
      container.innerHTML = '<div class="card"><table><tr><td style="text-align:center;color:var(--text-tertiary)">暂无文档</td></tr></table></div>';
      return;
    }
    const data2 = await res.json();
    const docs = data2.docs || [];
    const total = data2.total || docs.length;
    const totalPages = Math.ceil(total / _kbPageSize) || 1;
    if (!docs.length && _kbDocsPage === 1) {
      container.innerHTML = '<div class="card"><table><tr><td style="text-align:center;color:var(--text-tertiary)">暂无文档，请上传知识库文件</td></tr></table></div>';
      return;
    }
    container.innerHTML = '<div class="card" style="margin-bottom:0"><table><tr><th>标题</th><th>来源</th><th>分块数</th><th>创建时间</th></tr>' +
      docs.map(d => `<tr><td>${d.title || '-'}</td><td>${d.source_type || '-'}</td><td>${d.chunk_count || 0}</td><td>${(d.created_at || '').slice(0,10)}</td></tr>`).join('') +
      '</table></div>' + _renderPager(_kbDocsPage, totalPages, total, 'loadKnowledgeDocs');
  } catch {
    container.innerHTML = '<div class="card"><table><tr><td style="text-align:center;color:var(--text-tertiary)">加载失败</td></tr></table></div>';
  }
}

// ===== 上传文档（内联在"上传知识"tab中） =====
function handleKBFileSelect(input) {
  const file = input.files[0];
  if (!file) return;
  const status = document.getElementById('kb-upload-status');
  const btn = document.getElementById('kb-upload-btn');
  if (status) { status.style.display = 'block'; status.textContent = '已选择: ' + file.name + ' (' + (file.size/1024).toFixed(1) + 'KB)'; status.style.color = 'var(--text-secondary)'; }
  if (btn) btn.disabled = false;
}

async function submitKBUpload() {
  const input = document.getElementById('kb-file-input');
  if (!input || !input.files[0]) return;
  const btn = document.getElementById('kb-upload-btn');
  const status = document.getElementById('kb-upload-status');
  if (btn) { btn.disabled = true; btn.textContent = '上传中...'; }
  if (status) { status.style.display = 'block'; status.textContent = '正在上传并处理...'; status.style.color = 'var(--primary)'; }
  try {
    const fd = new FormData();
    fd.append('file', input.files[0]);
    fd.append('source', 'workbench_upload');
    const res = await fetch('/api/knowledge/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (res.ok) {
      if (status) { status.textContent = '上传成功！' + (data.title || '') + '，共 ' + (data.chunkCount || 0) + ' 个分块'; status.style.color = 'var(--green)'; }
      if (btn) { btn.textContent = '上传并处理'; }
      input.value = '';
      setTimeout(() => loadKnowledgeStats(), 1000);
    } else {
      if (status) { status.textContent = '上传失败: ' + (data.error || '未知错误'); status.style.color = 'var(--red)'; }
      if (btn) { btn.disabled = false; btn.textContent = '上传并处理'; }
    }
  } catch (e) {
    if (status) { status.textContent = '上传失败: ' + e.message; status.style.color = 'var(--red)'; }
    if (btn) { btn.disabled = false; btn.textContent = '上传并处理'; }
  }
}

// ===== 手动添加QA对（存入knowledge_qa，source标记为workbench_manual，不污染wiki） =====
async function submitManualQA() {
  const q = document.getElementById('manual-qa-q')?.value?.trim();
  const a = document.getElementById('manual-qa-a')?.value?.trim();
  const scene = document.getElementById('manual-qa-scene')?.value || '';
  const status = document.getElementById('manual-qa-status');
  if (!q || !a) { if (status) { status.style.display = 'block'; status.textContent = '问题和答案不能为空'; status.style.color = 'var(--red)'; } return; }
  if (status) { status.style.display = 'block'; status.textContent = '保存中...'; status.style.color = 'var(--primary)'; }
  try {
    const res = await fetch('/api/admin/manual-qa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, answer: a, source: 'workbench_manual:' + scene })
    });
    const data = await res.json();
    if (res.ok) {
      if (status) { status.textContent = '保存成功！'; status.style.color = 'var(--green)'; }
      document.getElementById('manual-qa-q').value = '';
      document.getElementById('manual-qa-a').value = '';
      loadKnowledgeStats();
    } else {
      if (status) { status.textContent = '保存失败: ' + (data.error || '未知错误'); status.style.color = 'var(--red)'; }
    }
  } catch (e) {
    if (status) { status.textContent = '保存失败: ' + e.message; status.style.color = 'var(--red)'; }
  }
}

// ===== QA 管理 =====
let _kbQaPage = 1;

async function loadKnowledgeQA(page) {
  if (page !== undefined) _kbQaPage = page;
  const table = document.getElementById('qa-table');
  const label = document.getElementById('qa-count-label');
  if (!table) return;
  const offset = (_kbQaPage - 1) * _kbPageSize;
  try {
    const res = await fetch('/api/knowledge/qa/list?limit=' + _kbPageSize + '&offset=' + offset);
    if (!res.ok) { table.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-tertiary)">暂无QA数据</td></tr>'; if (label) label.textContent = '共 0 条'; return; }
    const data = await res.json();
    const qas = data.items || data.qas || data || [];
    const total = data.total || qas.length;
    const totalPages = Math.ceil(total / _kbPageSize) || 1;
    if (label) label.textContent = '共 ' + total + ' 条';
    if (!qas.length && _kbQaPage === 1) { table.innerHTML = '<tr><th style="width:35%">问题</th><th style="width:50%">答案</th><th>来源</th><th>操作</th></tr><tr><td colspan="4" style="text-align:center;color:var(--text-tertiary)">暂无QA数据，点击顶部"AI 生成 QA"自动生成</td></tr>'; return; }
    const pager = _renderPager(_kbQaPage, totalPages, total, 'loadKnowledgeQA');
    table.outerHTML = '<table id="qa-table"><tr><th style="width:35%">问题</th><th style="width:50%">答案</th><th>来源</th><th>操作</th></tr>' +
      qas.map(q => `<tr>
        <td style="font-size:12px">${escapeHtml((q.question||'').slice(0,80))}</td>
        <td style="font-size:12px;color:var(--text-secondary)">${escapeHtml((q.answer||'').slice(0,100))}</td>
        <td style="font-size:11px">${q.source || '-'}</td>
        <td><a style="color:var(--red);cursor:pointer;font-size:12px" onclick="deleteQA(${q.id})">删除</a></td>
      </tr>`).join('') + '</table>' + pager;
  } catch { table.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--red)">加载失败</td></tr>'; }
}

async function deleteQA(id) {
  if (!confirm('确定删除此QA对？')) return;
  try {
    await fetch('/api/knowledge/qa/' + id, { method: 'DELETE' });
    loadKnowledgeQA();
  } catch {}
}

// ===== 知识图谱 =====
let _kbKgPage = 1;

async function loadKnowledgeGraph(page) {
  if (page !== undefined) _kbKgPage = page;
  const table = document.getElementById('kg-table');
  const label = document.getElementById('kg-count-label');
  if (!table) return;
  const offset = (_kbKgPage - 1) * _kbPageSize;
  try {
    const res = await fetch('/api/admin/kg-stats?limit=' + _kbPageSize + '&offset=' + offset);
    if (!res.ok) { table.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-tertiary)">暂无图谱数据</td></tr>'; return; }
    const data = await res.json();
    const entities = data.entities || [];
    const total = data.entityCount || entities.length;
    const relCount = data.relationCount || 0;
    const totalPages = Math.ceil(total / _kbPageSize) || 1;
    if (label) label.textContent = '共 ' + total + ' 个实体，' + relCount + ' 条关系';
    if (!entities.length && _kbKgPage === 1) { table.innerHTML = '<tr><th>实体名</th><th>类型</th><th>别名</th><th>关联文档</th><th>创建时间</th></tr><tr><td colspan="5" style="text-align:center;color:var(--text-tertiary)">暂无图谱数据，需先构建知识图谱</td></tr>'; return; }
    const pager = _renderPager(_kbKgPage, totalPages, total, 'loadKnowledgeGraph');
    table.outerHTML = '<table id="kg-table"><tr><th>实体名</th><th>类型</th><th>别名</th><th>关联文档</th><th>创建时间</th></tr>' +
      entities.map(e => `<tr>
        <td style="font-weight:500">${escapeHtml(e.name||'')}</td>
        <td><span style="background:var(--primary-light);color:var(--primary);padding:2px 6px;border-radius:4px;font-size:11px">${e.type||'-'}</span></td>
        <td style="font-size:12px;color:var(--text-secondary)">${e.aliases||'-'}</td>
        <td style="font-size:11px">${e.doc_ids ? e.doc_ids.split(',').length + '篇' : '-'}</td>
        <td style="font-size:12px">${(e.created_at||'').slice(0,10)}</td>
      </tr>`).join('') + '</table>' + pager;
  } catch { table.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--red)">加载失败</td></tr>'; }
}

// ===== 对话管理 =====
async function loadConversations() {
  const q = document.getElementById('conv-search')?.value?.trim() || '';
  try {
    const res = await fetch('/api/admin/conversations?limit=50');
    const data = await res.json();
    let convs = data.conversations || data || [];
    if (q) convs = convs.filter(c => (c.first_msg||'').includes(q) || (c.session_id||'').includes(q));
    const el = document.getElementById('conv-list');
    const detailEl = document.getElementById('conv-detail');
    if (detailEl) detailEl.style.display = 'none';
    if (!el) return;
    if (!convs.length) { el.innerHTML = '<div class="card"><div style="text-align:center;padding:20px;color:var(--text-tertiary)">暂无对话</div></div>'; return; }
    el.innerHTML = `<div class="card"><table><tr><th>对话ID</th><th>首条消息</th><th>用户</th><th>创建时间</th><th>操作</th></tr>` +
      convs.map(c => `<tr>
        <td style="font-family:monospace;font-size:11px">${(c.id||'').toString().slice(-6)}</td>
        <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.first_msg || c.title || '-'}</td>
        <td style="font-size:11px">${c.session_id ? c.session_id.slice(0,12)+'...' : '-'}</td>
        <td style="white-space:nowrap">${(c.created_at||'').slice(0,16)}</td>
        <td><a style="color:var(--primary);cursor:pointer;font-size:12px" onclick="viewConversation('${c.id}')">查看</a></td>
      </tr>`).join('') + '</table></div>';
  } catch (e) { const el = document.getElementById('conv-list'); if (el) el.innerHTML = `<div style="color:var(--red);padding:20px">加载失败: ${e.message}</div>`; }
}

async function viewConversation(convId) {
  try {
    const res = await fetch(`/api/admin/conversations/${convId}`);
    if (!res.ok) { alert('无法加载对话详情'); return; }
    const data = await res.json();
    const msgs = data.messages || [];
    const detailEl = document.getElementById('conv-detail');
    if (!detailEl) return;
    detailEl.style.display = 'block';
    detailEl.innerHTML = `<div class="card" style="margin-top:12px">
      <div class="card-header"><div class="card-title">对话 #${convId} (${msgs.length}条消息)</div><button class="btn btn-sm" onclick="document.getElementById('conv-detail').style.display='none'">关闭</button></div>
      <div style="max-height:400px;overflow-y:auto;padding:8px">
        ${msgs.map(m => `<div style="margin-bottom:8px;${m.role==='user'?'text-align:right':''}">
          <span style="display:inline-block;max-width:80%;padding:6px 10px;border-radius:10px;font-size:13px;white-space:pre-wrap;${m.role==='user'?'background:var(--primary);color:#fff':'background:#f0f0f0'}">${escapeHtml((m.content||'').slice(0,500))}</span>
          <div style="font-size:10px;color:var(--text-tertiary);margin-top:2px">${m.role} · ${(m.created_at||'').slice(11,19)}</div>
        </div>`).join('')}
      </div>
    </div>`;
    detailEl.scrollIntoView({behavior:'smooth'});
  } catch (e) { alert('加载失败: ' + e.message); }
}

// ===== Query 分析 =====
async function loadQueryAnalysis() {
  try {
    const res = await fetch('/api/admin/query-analysis');
    const data = await res.json();
    const s = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    s('qa-total', (data.totalQueries || 0).toLocaleString());
    s('qa-today', (data.todayQueries || 0).toLocaleString());
    s('qa-convs', (data.totalConvs || 0).toLocaleString());
    s('qa-likes', (data.likes || 0).toLocaleString());
    s('qa-dislikes', (data.dislikes || 0).toLocaleString());

    // 7日趋势
    const trendEl = document.getElementById('qa-trend');
    if (trendEl) {
      const trend = data.trend || [];
      if (!trend.length) { trendEl.innerHTML = '<div style="text-align:center;width:100%;color:var(--text-tertiary)">暂无数据</div>'; }
      else {
        const maxN = Math.max(...trend.map(t => t.n), 1);
        trendEl.innerHTML = trend.map(t => {
          const pct = Math.max(t.n / maxN * 100, 4);
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px"><span style="font-size:12px;font-weight:600">${t.n}</span><div style="width:100%;max-width:40px;height:${pct}px;background:var(--primary);border-radius:4px 4px 0 0;min-height:4px"></div><span style="font-size:11px;color:var(--text-tertiary)">${(t.day||'').slice(5)}</span></div>`;
        }).join('');
      }
    }

    // 热门query
    const topEl = document.getElementById('qa-top');
    if (topEl) {
      const top = data.topQueries || [];
      if (!top.length) { topEl.innerHTML = '<div style="text-align:center;padding:10px;color:var(--text-tertiary)">暂无数据</div>'; }
      else { topEl.innerHTML = `<table><tr><th>Query</th><th>频次</th></tr>` + top.map(q => `<tr><td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${q.content}</td><td>${q.freq}</td></tr>`).join('') + '</table>'; }
    }

    // 差评query
    const badEl = document.getElementById('qa-bad');
    if (badEl) {
      const bad = data.badQueries || [];
      if (!bad.length) { badEl.innerHTML = '<div style="text-align:center;padding:10px;color:var(--green)">暂无差评</div>'; }
      else { badEl.innerHTML = `<table><tr><th>Query</th><th>时间</th></tr>` + bad.map(q => `<tr><td>${q.content||'-'}</td><td>${(q.created_at||'').slice(0,10)}</td></tr>`).join('') + '</table>'; }
    }
  } catch (e) { console.error('[QueryAnalysis]', e.message); }
}

// ===== Agent 控制台（调试对话） =====
async function consoleSend() {
  const input = document.getElementById('console-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  const msgsEl = document.getElementById('console-msgs');
  const debugEl = document.getElementById('console-debug');
  msgsEl.innerHTML += `<div style="margin-bottom:8px;text-align:right"><span style="background:var(--primary);color:#fff;padding:4px 10px;border-radius:12px;display:inline-block;max-width:80%">${escapeHtml(msg)}</span></div>`;
  msgsEl.scrollTop = msgsEl.scrollHeight;
  debugEl.textContent += `[${new Date().toLocaleTimeString()}] → 发送: ${msg}\n`;
  try {
    const res = await fetch('/api/harness/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message:msg,currentPage:'ai.console'}) });
    const data = await res.json();
    msgsEl.innerHTML += `<div style="margin-bottom:8px"><span style="background:#f0f0f0;padding:4px 10px;border-radius:12px;display:inline-block;max-width:80%;white-space:pre-wrap">${escapeHtml(data.reply||'无回复')}</span></div>`;
    msgsEl.scrollTop = msgsEl.scrollHeight;
    debugEl.textContent += `[${new Date().toLocaleTimeString()}] ← 回复: ${(data.reply||'').slice(0,100)}...\n`;
    if (data.toolsUsed) debugEl.textContent += `[${new Date().toLocaleTimeString()}] 🔧 使用工具: ${data.toolsUsed.join(', ')}\n`;
  } catch (e) {
    msgsEl.innerHTML += `<div style="margin-bottom:8px"><span style="background:var(--red-light);color:var(--red);padding:4px 10px;border-radius:12px;display:inline-block">错误: ${e.message}</span></div>`;
    debugEl.textContent += `[${new Date().toLocaleTimeString()}] ❌ 错误: ${e.message}\n`;
  }
}

// ===== 客户画像 =====
let _staffPage = 1;
async function loadStaff(page) {
  if (page !== undefined) _staffPage = page;
  const status = document.getElementById('staff-status-filter')?.value || '';
  const q = document.getElementById('staff-search')?.value || '';
  const params = new URLSearchParams({ limit: 50, page: _staffPage });
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  try {
    const [listRes, statsRes] = await Promise.all([
      fetch('/api/admin/staff?' + params),
      fetch('/api/admin/staff/stats')
    ]);
    const data = await listRes.json();
    const stats = await statsRes.json();
    const s = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    s('staff-total', stats.total);
    s('staff-effective', stats.effective);
    s('staff-invalid', stats.invalid);
    const staff = data.staff || [];
    const el = document.getElementById('staff-list');
    if (!el) return;
    if (!staff.length) { el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary)">暂无数据</div>'; return; }
    const statusBadge = s => s === 'EFFECTIVE' ? '<span class="badge status-on">有效</span>' : '<span class="badge status-off">已失效</span>';
    const typeMap = { 1: '超级管理员', 2: '门店账号', 3: '渠道账号' };
    const maskPhone = p => p ? p.slice(0,3) + '****' + p.slice(7) : '-';
    const maskEmail = e => { if (!e) return '-'; const [n,d] = e.split('@'); return n.slice(0,2) + '***@' + (d||''); };
    el.innerHTML = `<table><tr><th>姓名</th><th>UserID</th><th>手机</th><th>邮箱</th><th>类型</th><th>状态</th><th>创建时间</th></tr>` +
      staff.map(s => `<tr>
        <td>${s.name || '-'}</td><td style="font-size:11px;color:var(--text-tertiary)">${s.userid || '-'}</td>
        <td>${maskPhone(s.phone)}</td><td style="font-size:11px">${maskEmail(s.email)}</td>
        <td><span class="badge">${typeMap[s.type] || '未知'}</span></td>
        <td>${statusBadge(s.account_status)}</td>
        <td style="font-size:11px;color:var(--text-tertiary)">${(s.created_at||'').slice(0,10)}</td>
      </tr>`).join('') + '</table>';
    // Pagination
    if (data.pages > 1) {
      let pager = '<div style="display:flex;justify-content:center;align-items:center;gap:8px;padding:12px 0;font-size:13px">';
      pager += data.page > 1 ? `<a onclick="loadStaff(${data.page-1})" style="color:var(--primary);cursor:pointer">上一页</a>` : '';
      pager += `<span style="color:var(--text-tertiary)">第${data.page}/${data.pages}页 共${data.total}条</span>`;
      pager += data.page < data.pages ? `<a onclick="loadStaff(${data.page+1})" style="color:var(--primary);cursor:pointer">下一页</a>` : '';
      pager += '</div>';
      el.innerHTML += pager;
    }
  } catch (e) {
    const el = document.getElementById('staff-list');
    if (el) el.innerHTML = `<div style="color:var(--red);padding:20px">加载失败: ${e.message}</div>`;
  }
}

async function loadProfiles() {
  try {
    const res = await fetch('/api/admin/user-profiles');
    const data = await res.json();
    const s = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    s('profile-count', data.profileCount || 0);
    s('profile-total', data.totalUsers || 0);
    s('profile-rate', data.totalUsers > 0 ? Math.round(data.profileCount / data.totalUsers * 100) + '%' : '-');
    const el = document.getElementById('profile-list');
    if (!el) return;
    const profiles = data.profiles || [];
    if (!profiles.length) { el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary)">暂无画像数据</div>'; return; }
    el.innerHTML = `<table><tr><th>用户ID</th><th>预算</th><th>产品偏好</th><th>使用场景</th><th>职业</th><th>更新时间</th></tr>` +
      profiles.map(p => `<tr><td>用户 #${p.user_id}</td><td>${p.budget||'-'}</td><td>${Array.isArray(p.product_prefs)?p.product_prefs.join(', '):'-'}</td><td>${Array.isArray(p.use_cases)?p.use_cases.join(', '):'-'}</td><td>${p.occupation||'-'}</td><td>${(p.updated_at||'').slice(0,10)}</td></tr>`).join('') + '</table>';
  } catch (e) { const el = document.getElementById('profile-list'); if (el) el.innerHTML = `<div style="color:var(--red);padding:20px">加载失败: ${e.message}</div>`; }
}

// ===== 账号管理 =====
async function loadAccounts() {
  try {
    const res = await fetch('/api/admin/users');
    if (!res.ok) return;
    const data = await res.json();
    const users = data.users || data || [];
    const el = document.getElementById('accounts-list');
    if (!el) return;
    if (!users.length) { el.innerHTML = '<div class="card"><div style="text-align:center;padding:20px;color:var(--text-tertiary)">暂无账号</div></div>'; return; }
    el.innerHTML = `<div class="card"><table><tr><th>用户名</th><th>创建时间</th><th>操作</th></tr>` +
      users.map(u => `<tr><td>${u.username}</td><td>${(u.created_at||'').slice(0,10)}</td><td>${u.username==='admin'?'<span style="color:var(--text-tertiary);font-size:12px">系统账号</span>':`<a style="color:var(--red);cursor:pointer;font-size:12px" onclick="deleteAccount(${u.id},'${u.username}')">删除</a>`}</td></tr>`).join('') + '</table></div>';
  } catch (e) { const el = document.getElementById('accounts-list'); if (el) el.innerHTML = `<div style="color:var(--red);padding:20px">加载失败: ${e.message}</div>`; }
}
function showAddAccount() {
  const username = prompt('用户名:'); if (!username) return;
  const password = prompt('密码(至少6位):'); if (!password || password.length < 6) return alert('密码至少6位');
  fetch('/api/admin/users', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,password}) })
    .then(r => { if (!r.ok) return r.json().then(d => { throw new Error(d.error); }); loadAccounts(); })
    .catch(e => alert('创建失败: ' + e.message));
}
async function deleteAccount(id, name) {
  if (!confirm(`确认删除账号「${name}」？`)) return;
  try { const r = await fetch(`/api/admin/users/${id}`, {method:'DELETE'}); if (!r.ok) { const d = await r.json(); throw new Error(d.error); } loadAccounts(); }
  catch (e) { alert('删除失败: ' + e.message); }
}

// ===== Persona 管理 =====
async function loadPersonas() {
  try {
    const res = await fetch('/api/admin/personas');
    const data = await res.json();
    const el = document.getElementById('personas-list');
    if (!el) return;
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) { el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-tertiary)">暂无 Persona，点击上方按钮创建</div>'; return; }
    el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">' + rows.map(p => `
      <div class="card">
        <div class="card-title">${p.name}</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">${p.description || ''}</div>
        <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center">
          ${p.is_active ? '<span class="badge status-on">激活中</span>' : '<span class="badge status-off">未激活</span>'}
          <div style="display:flex;gap:8px">
            ${!p.is_active ? `<a style="color:var(--primary);cursor:pointer;font-size:12px" onclick="activatePersona(${p.id})">激活</a>` : ''}
            <a style="color:var(--red);cursor:pointer;font-size:12px" onclick="deletePersona(${p.id},'${(p.name||'').replace(/'/g,"\\'")}')">删除</a>
          </div>
        </div>
      </div>`).join('') + '</div>';
  } catch (e) { const el = document.getElementById('personas-list'); if (el) el.innerHTML = `<div style="color:var(--red);padding:20px">加载失败: ${e.message}</div>`; }
}
function showAddPersona() {
  const name = prompt('Persona 名称:'); if (!name) return;
  const desc = prompt('描述:') || '';
  const prompt_text = prompt('System Prompt:') || '';
  fetch('/api/admin/personas', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name,description:desc,system_prompt:prompt_text}) })
    .then(r => { if (!r.ok) return r.json().then(d => { throw new Error(d.error); }); loadPersonas(); })
    .catch(e => alert('创建失败: ' + e.message));
}
async function activatePersona(id) {
  await fetch(`/api/admin/personas/${id}/activate`, {method:'PUT'}); loadPersonas();
}
async function deletePersona(id, name) {
  if (!confirm(`删除 Persona「${name}」？`)) return;
  await fetch(`/api/admin/personas/${id}`, {method:'DELETE'}); loadPersonas();
}

// ===== 监控告警 =====
async function loadMonitor() {
  try {
    const res = await fetch('/api/admin/metrics');
    if (!res.ok) throw new Error('API ' + res.status);
    const data = await res.json();
    const raw = data.latest || data.metrics || {};
    // API returns {metric_value, snapshot_at} objects or plain values
    const mv = (key) => { const v = raw[key]; return v && typeof v === 'object' ? v.metric_value : v; };
    const s = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    s('mon-convs', mv('msg_count_1h') || mv('conv_count_1h') || 0);
    const sat = mv('satisfaction_rate');
    s('mon-satisfaction', sat != null ? sat + '%' : '-');
    const hit = mv('knowledge_hit_rate');
    s('mon-hit', hit != null ? (hit < 1 ? (hit * 100).toFixed(0) + '%' : hit + '%') : '-');
    const alerts = data.alerts || [];
    s('mon-alerts', alerts.length);
    const el = document.getElementById('mon-alert-list');
    if (el) {
      if (!alerts.length) { el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--green)">无活跃告警</div>'; }
      else { el.innerHTML = alerts.map(a => `<div class="action-card" style="border-color:var(--orange)"><div class="ac-icon" style="background:var(--orange-light);color:var(--orange)">⚠️</div><div><div class="ac-title">${a.message || a.key}</div><div class="ac-desc">${a.detail || ''}</div></div></div>`).join(''); }
    }
  } catch (e) {
    console.error('[Monitor]', e.message);
    const s = (id, v) => { const e2 = document.getElementById(id); if (e2) e2.textContent = v; };
    s('mon-convs', '0'); s('mon-satisfaction', '-'); s('mon-hit', '-'); s('mon-alerts', '0');
    const el = document.getElementById('mon-alert-list');
    if (el) el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary)">暂无数据（API 未连接）</div>';
  }
}
async function collectMetrics() {
  try { await fetch('/api/admin/metrics/collect', {method:'POST'}); alert('采集完成'); loadMonitor(); }
  catch (e) { alert('采集失败: ' + e.message); }
}

// ===== 进化系统 =====
async function loadEvolution() {
  try {
    const [evoRes, refRes, learnRes] = await Promise.all([
      fetch('/api/admin/evolution-notes'), fetch('/api/admin/reflections?limit=10'), fetch('/api/admin/learning-status')
    ]);
    // 进化记录
    const evoEl = document.getElementById('evo-notes');
    if (evoEl) {
      const evoData = await evoRes.json();
      const notesRaw = evoData.notes || evoData || '';
      if (typeof notesRaw === 'string' && notesRaw) {
        // notes 是一段文本，按换行分条显示
        const lines = notesRaw.split(/\n/).filter(l => l.trim());
        evoEl.innerHTML = '<div style="font-size:12px">' + lines.slice(0,8).map(l => `<div style="padding:6px 0;border-bottom:1px solid var(--border-light)">${l.replace(/^\d+\.\s*/, '')} <span class="badge status-on" style="float:right">已应用</span></div>`).join('') + '</div>';
      } else if (Array.isArray(notesRaw) && notesRaw.length) {
        evoEl.innerHTML = '<div style="font-size:12px">' + notesRaw.slice(0,8).map(n => `<div style="padding:6px 0;border-bottom:1px solid var(--border-light)">${n.instruction || n.content || n.note || JSON.stringify(n).slice(0,80)} <span class="badge ${n.applied?'status-on':'status-warn'}" style="float:right">${n.applied?'已应用':'待验证'}</span></div>`).join('') + '</div>';
      } else { evoEl.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary);padding:8px">暂无进化记录</div>'; }
    }
    // 反思日志
    const refEl = document.getElementById('evo-reflections');
    if (refEl) {
      const refData = await refRes.json();
      const refs = refData.rows || refData.reflections || (refData.stats && refData.stats.recent) || (Array.isArray(refData) ? refData : []);
      if (!refs.length) { refEl.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary);padding:8px">暂无反思日志</div>'; }
      else { refEl.innerHTML = '<div style="font-size:12px">' + refs.slice(0,8).map(r => `<div style="padding:6px 0;border-bottom:1px solid var(--border-light)"><span class="badge ${r.score > 50 ? 'status-warn' : 'badge-red'}" style="margin-right:4px">${r.issue_type || '反思'}</span>${(r.detail || r.insight || r.content || '').slice(0,80)}...</div>`).join('') + '</div>'; }
    }
    // 学习状态
    const statusEl = document.getElementById('evo-status');
    if (statusEl) {
      const learnData = await learnRes.json();
      statusEl.innerHTML = `<div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)"><div class="kpi-card"><div class="kpi-label">回归用例数</div><div class="kpi-value" style="font-size:18px">${learnData.regressionCaseCount || 0}</div></div><div class="kpi-card"><div class="kpi-label">Few-shot 示例</div><div class="kpi-value" style="font-size:18px">${learnData.fewShotDemos ? '已生成' : '未生成'}</div></div><div class="kpi-card"><div class="kpi-label">上次学习</div><div class="kpi-value" style="font-size:18px">${learnData.lastLearningAt ? new Date(learnData.lastLearningAt).toLocaleDateString('zh-CN') : '未运行'}</div></div></div>`;
    }
  } catch (e) {
    console.error('[Evolution]', e.message);
    const show = (id, msg) => { const el = document.getElementById(id); if (el) el.innerHTML = `<div style="font-size:12px;color:var(--text-tertiary);padding:8px">${msg}</div>`; };
    show('evo-notes', '暂无数据（API 未连接）');
    show('evo-reflections', '暂无数据（API 未连接）');
    const statusEl = document.getElementById('evo-status');
    if (statusEl) statusEl.innerHTML = '<div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)"><div class="kpi-card"><div class="kpi-label">学习周期</div><div class="kpi-value" style="font-size:18px">0</div></div><div class="kpi-card"><div class="kpi-label">经验模式</div><div class="kpi-value" style="font-size:18px">0</div></div><div class="kpi-card"><div class="kpi-label">状态</div><div class="kpi-value" style="font-size:18px">未连接</div></div></div>';
  }
}
async function triggerEvolution() {
  try { const r = await fetch('/api/admin/run-evolution', {method:'POST'}); const d = await r.json(); alert(d.message || '进化分析已触发'); loadEvolution(); }
  catch (e) { alert('触发失败: ' + e.message); }
}
async function triggerLearning() {
  try { const r = await fetch('/api/admin/run-learning', {method:'POST'}); const d = await r.json(); alert(d.message || '学习周期已触发'); loadEvolution(); }
  catch (e) { alert('触发失败: ' + e.message); }
}

// ===== 回归测试 =====
async function loadRegression() {
  try {
    const res = await fetch('/api/admin/regression-cases');
    const rows = await res.json();
    const el = document.getElementById('regression-list');
    if (!el) return;
    if (!rows.length) { el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary)">暂无测试用例</div>'; return; }
    el.innerHTML = `<table><tr><th>问题</th><th>期望关键词</th><th>分类</th><th>上次结果</th><th>操作</th></tr>` +
      rows.map(r => {
        const statusBadge = r.last_result === 'pass' ? '<span class="badge status-on">通过</span>' : r.last_result === 'partial' ? '<span class="badge status-warn">部分</span>' : r.last_result === 'fail' ? '<span class="badge badge-red">失败</span>' : '<span class="badge">未测</span>';
        return `<tr><td>${r.question}</td><td>${r.expected_keywords||''}</td><td>${r.category||'-'}</td><td>${statusBadge}</td><td><a style="color:var(--red);cursor:pointer;font-size:12px" onclick="deleteRegressionCase(${r.id})">删除</a></td></tr>`;
      }).join('') + '</table>';
  } catch (e) { const el = document.getElementById('regression-list'); if (el) el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary)">暂无测试用例（API 未连接）</div>'; }
}
function showAddRegression() {
  const question = prompt('测试问题:'); if (!question) return;
  const keywords = prompt('期望关键词(逗号分隔):') || '';
  const category = prompt('分类(product/service/general):') || 'general';
  fetch('/api/admin/regression-cases', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({question,expected_keywords:keywords,category}) })
    .then(r => { if (!r.ok) return r.json().then(d => { throw new Error(d.error); }); loadRegression(); })
    .catch(e => alert('添加失败: ' + e.message));
}
async function deleteRegressionCase(id) {
  if (!confirm('删除此测试用例？')) return;
  await fetch(`/api/admin/regression-cases/${id}`, {method:'DELETE'}); loadRegression();
}
async function runRegression() {
  if (!confirm('运行全部回归测试？可能需要几分钟。')) return;
  try { const r = await fetch('/api/admin/regression-cases/run', {method:'POST'}); const d = await r.json(); alert(d.message || '测试已启动'); setTimeout(loadRegression, 3000); }
  catch (e) { alert('运行失败: ' + e.message); }
}

// ===== CMS 页面编辑器 =====
const PAGE_COMPONENTS = {
  'hero-banner': {
    label:'轮播横幅', icon:'🖼️',
    defaults: { imageUrl:'https://p1.lefile.cn/fes/cms/2025/01/04/m1g9tq5hr8xekovb0zi3dlpna2fuwj.jpg', title:'618 年中盛典', subtitle:'全场低至5折', buttonText:'立即抢购', buttonLink:'#', height:320, bgColor:'#1a1a2e' },
    render: p => `<div style="background:${p.bgColor};color:#fff;height:${p.height}px;display:flex;flex-direction:column;align-items:center;justify-content:center;background-image:url(${p.imageUrl});background-size:cover;background-position:center;border-radius:8px;text-align:center">
      <div style="font-size:32px;font-weight:800;text-shadow:0 2px 8px rgba(0,0,0,0.3)">${p.title}</div>
      <div style="font-size:16px;margin-top:8px;opacity:0.9">${p.subtitle}</div>
      ${p.buttonText ? `<div style="margin-top:20px;padding:10px 28px;background:#fff;color:${p.bgColor};border-radius:24px;font-weight:600;font-size:14px">${p.buttonText}</div>` : ''}
    </div>`,
    props: [
      {key:'title',label:'标题',type:'text'},{key:'subtitle',label:'副标题',type:'text'},
      {key:'imageUrl',label:'背景图URL',type:'text'},{key:'buttonText',label:'按钮文字',type:'text'},
      {key:'bgColor',label:'背景色',type:'color'},{key:'height',label:'高度(px)',type:'number'}
    ]
  },
  'product-grid': {
    label:'商品网格', icon:'🛍️',
    defaults: { title:'爆款推荐', columns:4, products:[
      {name:'ThinkPad X9-14',price:'6,999',image:''},
      {name:'YOGA Air 14s',price:'5,999',image:''},
      {name:'小新Pro 16',price:'4,999',image:''},
      {name:'拯救者 Y9000P',price:'8,999',image:''}
    ]},
    render: p => `<div style="padding:24px">
      <div style="font-size:18px;font-weight:700;margin-bottom:16px">${p.title}</div>
      <div style="display:grid;grid-template-columns:repeat(${p.columns},1fr);gap:12px">
        ${(p.products||[]).map(pr => `<div style="border:1px solid #eee;border-radius:8px;padding:12px;text-align:center">
          <div style="height:100px;background:#f5f5f5;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#ccc;font-size:24px">${pr.image ? `<img src="${pr.image}" style="max-height:100%;max-width:100%">` : '📦'}</div>
          <div style="margin-top:8px;font-size:13px;font-weight:500">${pr.name}</div>
          <div style="color:var(--red);font-weight:700;margin-top:4px">¥${pr.price}</div>
        </div>`).join('')}
      </div>
    </div>`,
    props: [{key:'title',label:'标题',type:'text'},{key:'columns',label:'列数',type:'number'}]
  },
  'text-block': {
    label:'富文本', icon:'📝',
    defaults: { content:'在此输入内容，支持产品介绍、活动规则等文本内容...', fontSize:14, padding:24 },
    render: p => `<div style="padding:${p.padding}px;font-size:${p.fontSize}px;line-height:1.8;color:#333">${p.content}</div>`,
    props: [{key:'content',label:'内容',type:'textarea'},{key:'fontSize',label:'字号',type:'number'},{key:'padding',label:'内边距',type:'number'}]
  },
  'cta-button': {
    label:'行动按钮', icon:'👆',
    defaults: { text:'立即购买', link:'#', style:'primary', align:'center' },
    render: p => {
      const colors = {primary:'var(--primary)',red:'var(--red)',green:'var(--green)',dark:'#1f2329'};
      return `<div style="padding:20px;text-align:${p.align}"><a style="display:inline-block;padding:12px 36px;background:${colors[p.style]||colors.primary};color:#fff;border-radius:24px;font-weight:600;font-size:15px;text-decoration:none">${p.text}</a></div>`;
    },
    props: [{key:'text',label:'按钮文字',type:'text'},{key:'link',label:'链接',type:'text'},
      {key:'style',label:'样式',type:'select',options:['primary','red','green','dark']},
      {key:'align',label:'对齐',type:'select',options:['left','center','right']}]
  },
  'image-text': {
    label:'图文组合', icon:'📰',
    defaults: { imageUrl:'', imagePosition:'left', title:'功能亮点', description:'高性能处理器，轻薄设计，长续航体验', link:'#' },
    render: p => {
      const dir = p.imagePosition === 'right' ? 'row-reverse' : 'row';
      return `<div style="display:flex;flex-direction:${dir};gap:20px;padding:24px;align-items:center">
        <div style="flex:1;height:160px;background:#f0f0f0;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#ccc;font-size:32px">${p.imageUrl ? `<img src="${p.imageUrl}" style="max-height:100%;max-width:100%;border-radius:8px">` : '🖼️'}</div>
        <div style="flex:1"><div style="font-size:18px;font-weight:700">${p.title}</div><div style="margin-top:8px;font-size:13px;color:#666;line-height:1.6">${p.description}</div></div>
      </div>`;
    },
    props: [{key:'title',label:'标题',type:'text'},{key:'description',label:'描述',type:'textarea'},
      {key:'imageUrl',label:'图片URL',type:'text'},{key:'imagePosition',label:'图片位置',type:'select',options:['left','right']}]
  },
  'spacer': {
    label:'间距', icon:'↕️',
    defaults: { height:40, bgColor:'transparent' },
    render: p => `<div style="height:${p.height}px;background:${p.bgColor}"></div>`,
    props: [{key:'height',label:'高度(px)',type:'number'},{key:'bgColor',label:'背景色',type:'color'}]
  },
  'activity-countdown': {
    label:'活动倒计时', icon:'⏰',
    defaults: { title:'限时抢购', endTime:'2026-06-18T00:00:00', bgColor:'#ff6b35', textColor:'#fff' },
    render: p => {
      const remain = Math.max(0, new Date(p.endTime) - new Date());
      const d = Math.floor(remain/86400000), h = Math.floor(remain%86400000/3600000), m = Math.floor(remain%3600000/60000);
      return `<div style="background:${p.bgColor};color:${p.textColor};padding:20px;text-align:center;border-radius:8px">
        <div style="font-size:18px;font-weight:700">${p.title}</div>
        <div style="font-size:28px;font-weight:800;margin-top:8px;letter-spacing:2px">${d}天 ${h}时 ${m}分</div>
      </div>`;
    },
    props: [{key:'title',label:'标题',type:'text'},{key:'endTime',label:'结束时间',type:'text'},{key:'bgColor',label:'背景色',type:'color'},{key:'textColor',label:'文字色',type:'color'}]
  }
};

let _pb = { page:null, selectedId:null, dirty:false };
let _pagesList = JSON.parse(localStorage.getItem('lexiang_cms_pages') || 'null') || [
  {id:'p1',title:'ThinkPad X9 产品页',slug:'/products/thinkpad-x9',status:'published',updatedAt:'2026-04-08',components:[]},
  {id:'p2',title:'618 活动专题页',slug:'/campaign/618',status:'draft',updatedAt:'2026-04-08',components:[]},
  {id:'p3',title:'服务政策说明',slug:'/support/policy',status:'published',updatedAt:'2026-03-20',components:[]}
];

function loadPagesList() {
  const el = document.getElementById('pages-list');
  if (!el) return;
  if (!_pagesList.length) { el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-tertiary)">暂无页面，点击上方按钮创建</div>'; return; }
  el.innerHTML = `<div class="card"><table><tr><th>页面标题</th><th>路径</th><th>状态</th><th>更新时间</th><th>操作</th></tr>` +
    _pagesList.map(p => `<tr>
      <td><a style="color:var(--primary);cursor:pointer" onclick="openPageBuilder('${p.id}')">${p.title}</a></td>
      <td style="font-size:12px;color:var(--text-tertiary)">${p.slug}</td>
      <td><span class="badge ${p.status==='published'?'status-on':'status-warn'}">${p.status==='published'?'已发布':'草稿'}</span></td>
      <td style="font-size:12px">${p.updatedAt}</td>
      <td><a style="color:var(--primary);cursor:pointer;font-size:12px;margin-right:8px" onclick="openPageBuilder('${p.id}')">编辑</a><a style="color:var(--red);cursor:pointer;font-size:12px" onclick="deletePage('${p.id}')">删除</a></td>
    </tr>`).join('') + '</table></div>';
}

function deletePage(id) {
  if (!confirm('确定删除该页面？')) return;
  _pagesList = _pagesList.filter(p => p.id !== id);
  localStorage.setItem('lexiang_cms_pages', JSON.stringify(_pagesList));
  loadPagesList();
}

function openPageBuilder(pageId, aiPrompt) {
  let page;
  if (pageId) {
    page = _pagesList.find(p => p.id === pageId);
    if (!page) return;
    page = JSON.parse(JSON.stringify(page));
  } else {
    page = { id:'p_'+Date.now(), title:'新页面', slug:'/new-page', status:'draft', updatedAt:new Date().toISOString().slice(0,10), components:[] };
  }
  _pb = { page, selectedId:null, dirty:false };
  renderPageBuilder();
  if (aiPrompt) setTimeout(() => { document.getElementById('pb-ai-input').value = aiPrompt; pbAiGenerate(); }, 300);
}

function renderPageBuilder() {
  const p = _pb.page;
  document.getElementById('page-content').innerHTML = `
    <div class="pb-editor">
      <div class="pb-palette">
        <div class="pb-palette-title">组件库</div>
        <div id="pb-palette-list" style="flex:1;overflow-y:auto;padding:4px 0"></div>
      </div>
      <div class="pb-canvas-wrap">
        <div class="pb-toolbar">
          <button class="btn btn-sm btn-secondary" onclick="closePageBuilder()" style="padding:4px 10px">← 返回</button>
          <div class="pb-title"><input id="pb-page-title" value="${p.title}" onchange="_pb.page.title=this.value;_pb.dirty=true"></div>
          <button class="btn btn-sm btn-secondary" id="pb-preview-mode-btn" onclick="pbTogglePreviewMode()" style="font-size:11px">🖥️ desktop</button>
          <button class="btn btn-sm btn-secondary" onclick="pbPreview()">↗ 预览</button>
          <button class="btn btn-sm btn-primary" onclick="pbSave()">保存</button>
          <button class="btn btn-sm btn-primary" style="background:var(--green)" onclick="pbPublish()">发布</button>
        </div>
        <div class="pb-canvas" id="pb-canvas"></div>
        <div class="pb-ai-chips" id="pb-ai-chips">
          <span class="pb-ai-chip" onclick="document.getElementById('pb-ai-input').value='618大促页面，横幅+爆品+倒计时';pbAiGenerate()">618大促页面</span>
          <span class="pb-ai-chip" onclick="document.getElementById('pb-ai-input').value='ThinkPad新品发布页';pbAiGenerate()">新品发布页</span>
          <span class="pb-ai-chip" onclick="document.getElementById('pb-ai-input').value='企业购专享优惠页';pbAiGenerate()">企业购优惠</span>
          <span class="pb-ai-chip" onclick="document.getElementById('pb-ai-input').value='双11活动页，倒计时+商品推荐';pbAiGenerate()">双11活动页</span>
        </div>
        <div class="pb-ai-bar">
          <input id="pb-ai-input" placeholder="描述你想要的页面，如：帮我做一个YOGA系列促销页..." onkeydown="if(event.key==='Enter')pbAiGenerate()">
          <button class="btn btn-sm btn-primary" onclick="pbAiGenerate()">🤖 生成</button>
        </div>
      </div>
      <div class="pb-props">
        <div class="pb-props-title">属性面板</div>
        <div id="pb-props-content"><div class="pb-props-empty">选择一个组件<br>查看和编辑属性</div></div>
      </div>
    </div>`;
  // Render palette
  const pal = document.getElementById('pb-palette-list');
  pal.innerHTML = Object.entries(PAGE_COMPONENTS).map(([type, c]) =>
    `<div class="pb-palette-item" draggable="true" data-comp-type="${type}"><span class="pi-icon">${c.icon}</span>${c.label}</div>`
  ).join('');
  // Setup palette drag
  pal.querySelectorAll('.pb-palette-item').forEach(el => {
    el.addEventListener('dragstart', e => { e.dataTransfer.setData('comp-type', el.dataset.compType); e.dataTransfer.effectAllowed='copy'; });
  });
  pbRenderCanvas();
}

function pbRenderCanvas() {
  const canvas = document.getElementById('pb-canvas');
  const comps = _pb.page.components;
  if (!comps.length) {
    canvas.innerHTML = `<div class="pb-canvas-inner"><div class="pb-empty-canvas">
      <div class="pb-empty-icon">📄</div>
      <p style="font-size:15px;font-weight:600">开始创建页面</p>
      <p>从左侧拖入组件，或用底部 AI 输入框描述你想要的页面</p>
    </div></div>`;
    // Empty canvas is also a drop zone
    const inner = canvas.querySelector('.pb-canvas-inner');
    inner.addEventListener('dragover', e => { e.preventDefault(); inner.style.background='var(--primary-light)'; });
    inner.addEventListener('dragleave', () => { inner.style.background='#fff'; });
    inner.addEventListener('drop', e => { e.preventDefault(); inner.style.background='#fff';
      const type = e.dataTransfer.getData('comp-type');
      if (type) pbInsertComponent(type, 0);
    });
    return;
  }
  let html = '<div class="pb-canvas-inner">';
  html += pbDropZoneHtml(0);
  comps.forEach((comp, i) => {
    const def = PAGE_COMPONENTS[comp.type];
    if (!def) return;
    const sel = comp.id === _pb.selectedId ? ' selected' : '';
    html += `<div class="pb-comp${sel}" data-comp-id="${comp.id}" draggable="true" onclick="pbSelectComponent('${comp.id}')">
      <div class="pb-comp-actions">
        <button onclick="event.stopPropagation();pbMoveComponent('${comp.id}',-1)" title="上移">↑</button>
        <button onclick="event.stopPropagation();pbMoveComponent('${comp.id}',1)" title="下移">↓</button>
        <button onclick="event.stopPropagation();pbDuplicateComponent('${comp.id}')" title="复制">📋</button>
        <button onclick="event.stopPropagation();pbRemoveComponent('${comp.id}')" title="删除" style="color:var(--red)">✕</button>
      </div>
      ${def.render(comp.props)}
    </div>`;
    html += pbDropZoneHtml(i + 1);
  });
  html += '</div>';
  canvas.innerHTML = html;
  // Setup drop zones
  canvas.querySelectorAll('.pb-drop-zone').forEach(zone => {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('active'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('active'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('active');
      const type = e.dataTransfer.getData('comp-type');
      const moveId = e.dataTransfer.getData('comp-id');
      const idx = parseInt(zone.dataset.index);
      if (type) pbInsertComponent(type, idx);
      else if (moveId) pbReorderComponent(moveId, idx);
    });
  });
  // Setup component drag for reorder
  canvas.querySelectorAll('.pb-comp').forEach(el => {
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('comp-id', el.dataset.compId);
      e.dataTransfer.effectAllowed = 'move';
      el.style.opacity = '0.4';
    });
    el.addEventListener('dragend', () => { el.style.opacity = '1'; });
  });
}

function pbDropZoneHtml(index) {
  return `<div class="pb-drop-zone" data-index="${index}"></div>`;
}

function pbInsertComponent(type, atIndex) {
  const def = PAGE_COMPONENTS[type];
  if (!def) return;
  const comp = { id:'c_'+Date.now()+'_'+Math.random().toString(36).slice(2,6), type, props:JSON.parse(JSON.stringify(def.defaults)) };
  _pb.page.components.splice(atIndex, 0, comp);
  _pb.selectedId = comp.id;
  _pb.dirty = true;
  pbRenderCanvas();
  pbRenderProps();
}

function pbRemoveComponent(id) {
  _pb.page.components = _pb.page.components.filter(c => c.id !== id);
  if (_pb.selectedId === id) _pb.selectedId = null;
  _pb.dirty = true;
  pbRenderCanvas();
  pbRenderProps();
}

function pbMoveComponent(id, dir) {
  const comps = _pb.page.components;
  const idx = comps.findIndex(c => c.id === id);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= comps.length) return;
  [comps[idx], comps[newIdx]] = [comps[newIdx], comps[idx]];
  _pb.dirty = true;
  pbRenderCanvas();
}

function pbReorderComponent(id, toIndex) {
  const comps = _pb.page.components;
  const fromIdx = comps.findIndex(c => c.id === id);
  if (fromIdx < 0) return;
  const [comp] = comps.splice(fromIdx, 1);
  const insertAt = toIndex > fromIdx ? toIndex - 1 : toIndex;
  comps.splice(insertAt, 0, comp);
  _pb.dirty = true;
  pbRenderCanvas();
}

function pbDuplicateComponent(id) {
  const comps = _pb.page.components;
  const idx = comps.findIndex(c => c.id === id);
  if (idx < 0) return;
  const clone = JSON.parse(JSON.stringify(comps[idx]));
  clone.id = 'c_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
  comps.splice(idx + 1, 0, clone);
  _pb.selectedId = clone.id;
  _pb.dirty = true;
  pbRenderCanvas();
  pbRenderProps();
}

function pbSelectComponent(id) {
  _pb.selectedId = id;
  // Update selection visually without full re-render
  document.querySelectorAll('.pb-comp').forEach(el => el.classList.toggle('selected', el.dataset.compId === id));
  pbRenderProps();
}

function pbRenderProps() {
  const el = document.getElementById('pb-props-content');
  if (!el) return;
  if (!_pb.selectedId) { el.innerHTML = '<div class="pb-props-empty">选择一个组件<br>查看和编辑属性</div>'; return; }
  const comp = _pb.page.components.find(c => c.id === _pb.selectedId);
  if (!comp) return;
  const def = PAGE_COMPONENTS[comp.type];
  if (!def) return;
  let html = `<div class="pb-prop-group"><div style="font-size:13px;font-weight:600;margin-bottom:12px">${def.icon} ${def.label}</div>`;
  (def.props || []).forEach(prop => {
    html += `<div class="pb-prop-label">${prop.label}</div>`;
    if (prop.type === 'textarea') {
      html += `<textarea class="pb-prop-input" rows="4" onchange="pbUpdateProp('${comp.id}','${prop.key}',this.value)">${comp.props[prop.key]||''}</textarea>`;
    } else if (prop.type === 'select') {
      html += `<select class="pb-prop-input" onchange="pbUpdateProp('${comp.id}','${prop.key}',this.value)">` +
        prop.options.map(o => `<option ${comp.props[prop.key]===o?'selected':''}>${o}</option>`).join('') + '</select>';
    } else if (prop.type === 'color') {
      html += `<input type="color" class="pb-prop-input" value="${comp.props[prop.key]||'#ffffff'}" onchange="pbUpdateProp('${comp.id}','${prop.key}',this.value)" style="height:32px;padding:2px">`;
    } else {
      html += `<input class="pb-prop-input" type="${prop.type||'text'}" value="${comp.props[prop.key]||''}" onchange="pbUpdateProp('${comp.id}','${prop.key}',${prop.type==='number'?'Number(this.value)':'this.value'})">`;
    }
  });
  html += '</div>';
  el.innerHTML = html;
}

function pbUpdateProp(compId, key, value) {
  const comp = _pb.page.components.find(c => c.id === compId);
  if (!comp) return;
  comp.props[key] = value;
  _pb.dirty = true;
  // Re-render just the component in canvas
  const el = document.querySelector(`.pb-comp[data-comp-id="${compId}"]`);
  if (el) {
    const def = PAGE_COMPONENTS[comp.type];
    const actionsHtml = el.querySelector('.pb-comp-actions').outerHTML;
    el.innerHTML = actionsHtml + def.render(comp.props);
  }
}

let _pbPreviewMode = 'desktop'; // desktop|tablet|mobile
function pbPreview() {
  const comps = _pb.page.components;
  const body = comps.map(c => { const def = PAGE_COMPONENTS[c.type]; return def ? def.render(c.props) : ''; }).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${_pb.page.title} - 预览</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fff;color:#333}</style></head>
    <body>${body}</body></html>`;
  const blob = new Blob([html], {type:'text/html'});
  window.open(URL.createObjectURL(blob), '_blank');
}

function pbTogglePreviewMode() {
  const modes = ['desktop', 'tablet', 'mobile'];
  const sizes = { desktop: '100%', tablet: '768px', mobile: '375px' };
  const icons = { desktop: '🖥️', tablet: '📱', mobile: '📲' };
  const idx = (modes.indexOf(_pbPreviewMode) + 1) % modes.length;
  _pbPreviewMode = modes[idx];
  const canvas = document.querySelector('.pb-canvas');
  if (canvas) {
    canvas.style.maxWidth = sizes[_pbPreviewMode];
    canvas.style.margin = _pbPreviewMode === 'desktop' ? '0' : '0 auto';
  }
  const btn = document.getElementById('pb-preview-mode-btn');
  if (btn) btn.textContent = icons[_pbPreviewMode] + ' ' + _pbPreviewMode;
}

async function pbSave() {
  const idx = _pagesList.findIndex(p => p.id === _pb.page.id);
  _pb.page.updatedAt = new Date().toISOString().slice(0,10);
  if (idx >= 0) _pagesList[idx] = JSON.parse(JSON.stringify(_pb.page));
  else _pagesList.unshift(JSON.parse(JSON.stringify(_pb.page)));
  _pb.dirty = false;
  // 持久化到后端
  try {
    await fetch('/api/admin/pages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_pb.page)
    });
  } catch(e) { /* 后端暂未实现，仅本地保存 */ }
  // 保存到localStorage
  localStorage.setItem('lexiang_cms_pages', JSON.stringify(_pagesList));
  alert('页面已保存');
}

function pbPublish() {
  _pb.page.status = 'published';
  pbSave();
}

function closePageBuilder() {
  if (_pb.dirty && !confirm('有未保存的更改，确定离开？')) return;
  switchPage('content.pages');
}

// AI 页面生成
async function pbAiGenerate() {
  const input = document.getElementById('pb-ai-input');
  const prompt = (input.value || '').trim();
  if (!prompt) return;
  const btn = input.nextElementSibling;
  const origBtn = btn.innerHTML;
  btn.innerHTML = '⏳ 生成中...'; btn.disabled = true;
  input.disabled = true;

  const COMP_TYPES = Object.keys(PAGE_COMPONENTS).join(', ');
  const sysPrompt = `你是一个CMS页面布局生成器。用户会描述想要的页面，你需要返回一个JSON数组，每个元素代表一个页面组件。

可用组件类型: ${COMP_TYPES}

每个组件的props结构：
- hero-banner: {title, subtitle, buttonText, bgColor, height(默认320)}  bgColor推荐：深蓝#1a1a2e 科技蓝#0052cc 渐变紫#4a0e8f 品牌橙#ff6600 墨绿#1a5c3a
- product-grid: {title, columns(2-4), products:[{name,price,image}]}
- text-block: {content, fontSize(默认14), padding(默认24)}
- cta-button: {text, style(primary/red/green/dark), align(center/left/right)}
- image-text: {title, description, imagePosition(left/right)}
- spacer: {height}
- activity-countdown: {title, endTime(ISO格式), bgColor, textColor}

规则：
1. 根据用户描述智能选择合适的组件组合，通常3-6个组件
2. 横幅标题要有创意和吸引力，不要直接复制用户输入
3. 商品名和价格要合理（联想电脑产品线）
4. 只返回JSON数组，不要其他文字。格式：[{"type":"xxx","props":{...}}, ...]`;

  try {
    const res = await fetch('/api/harness/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `[页面生成指令] ${sysPrompt}\n\n用户需求: ${prompt}`, currentPage: 'cms.pagebuilder' })
    });
    const data = await res.json();
    const reply = data.reply || '';
    // 从回复中提取JSON数组
    const jsonMatch = reply.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const uid = () => 'c_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
      const comps = parsed.filter(c => PAGE_COMPONENTS[c.type]).map(c => {
        const defaults = PAGE_COMPONENTS[c.type].defaults;
        const props = {...(typeof defaults === 'object' ? JSON.parse(JSON.stringify(defaults)) : {}), ...(c.props || {})};
        return { id: uid(), type: c.type, props };
      });
      if (comps.length > 0) {
        _pb.page.components = comps;
        _pb.dirty = true; _pb.selectedId = null;
        pbRenderCanvas(); pbRenderProps();
        input.value = '';
        return;
      }
    }
    // JSON解析失败，用AI回复做智能fallback
    pbAiFallback(prompt);
    input.value = '';
  } catch (e) {
    console.warn('AI生成失败，使用本地模板:', e);
    pbAiFallback(prompt);
    input.value = '';
  } finally {
    btn.innerHTML = origBtn; btn.disabled = false; input.disabled = false;
  }
}

function pbAiFallback(prompt) {
  // 智能本地模板 - 解析用户意图而非直接复制文字
  const uid = () => 'c_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
  const comps = [];
  const is618 = /618/.test(prompt), is11 = /双11|双十一/.test(prompt);
  const isTP = /ThinkPad|thinkpad/i.test(prompt), isYoga = /YOGA|yoga/i.test(prompt);
  const isXinPro = /小新|xiaoxin/i.test(prompt), isLegion = /拯救者|Legion|游戏/i.test(prompt);
  const isEnterprise = /企业|B2B|政企|集团/.test(prompt);
  const isPromo = /促销|优惠|打折|特惠|限时|秒杀|抢购/.test(prompt) || is618 || is11;
  const isNewProduct = /新品|发布|上市|首发/.test(prompt);
  // 确定主题色
  let themeColor = '#1a1a2e';
  if (is618) themeColor = '#ff6600'; else if (is11) themeColor = '#c41a30';
  else if (isTP) themeColor = '#1a1a2e'; else if (isYoga) themeColor = '#4a0e8f';
  else if (isLegion) themeColor = '#00a650'; else if (isEnterprise) themeColor = '#0052cc';
  else if (isPromo) themeColor = '#ff6b35'; else if (isNewProduct) themeColor = '#2d3436';
  // 生成创意标题
  let title = '联想智能好物推荐', subtitle = '科技赋能生活，智享品质体验';
  if (is618) { title = '618 年中盛典'; subtitle = '全场笔记本低至5折，限时抢购'; }
  else if (is11) { title = '双11 狂欢购物节'; subtitle = '全年最低价，错过等一年'; }
  else if (isTP && isNewProduct) { title = 'ThinkPad 新品重磅发布'; subtitle = 'AI PC 时代，商务旗舰全面进化'; }
  else if (isTP) { title = 'ThinkPad 商务精选'; subtitle = '三十年匠心，值得信赖的商务伙伴'; }
  else if (isYoga) { title = 'YOGA 创意无界'; subtitle = '轻薄翻转，灵感随行'; }
  else if (isXinPro) { title = '小新 Pro 高能来袭'; subtitle = '高性价比之选，学生党办公族首选'; }
  else if (isLegion) { title = '拯救者 决战巅峰'; subtitle = '旗舰性能释放，征服每一帧画面'; }
  else if (isEnterprise) { title = '企业购 专属优惠'; subtitle = '批量采购一站式方案，专属折扣专人服务'; }
  else if (isPromo) { title = '限时特惠专场'; subtitle = '精选爆品，超值来袭'; }
  else if (isNewProduct) { title = '新品首发 · 抢先体验'; subtitle = '联想最新力作，引领科技新潮流'; }
  // 横幅
  comps.push({id:uid(),type:'hero-banner',props:{...JSON.parse(JSON.stringify(PAGE_COMPONENTS['hero-banner'].defaults)), title, subtitle, bgColor:themeColor, buttonText:isEnterprise?'立即咨询':'立即抢购'}});
  // 倒计时（促销类）
  if (isPromo) {
    comps.push({id:uid(),type:'activity-countdown',props:{...PAGE_COMPONENTS['activity-countdown'].defaults, title:is618?'距618开抢':is11?'双11倒计时':'限时特惠倒计时', bgColor:'#ff6b35'}});
  }
  // 商品网格
  let products = [{name:'ThinkPad X1 Carbon',price:'9,999',image:''},{name:'YOGA Air 14s',price:'5,999',image:''},{name:'小新Pro 16',price:'4,999',image:''},{name:'拯救者Y9000P',price:'8,999',image:''}];
  if (isTP) products = [{name:'X1 Carbon Gen12',price:'12,999',image:''},{name:'ThinkPad X9-14',price:'6,999',image:''},{name:'T14s Gen6',price:'7,499',image:''},{name:'X1 Nano Gen3',price:'9,999',image:''}];
  else if (isYoga) products = [{name:'YOGA Pro 14s',price:'7,999',image:''},{name:'YOGA Air 14s',price:'5,999',image:''},{name:'YOGA Book 9i',price:'12,999',image:''},{name:'YOGA Slim 7',price:'4,999',image:''}];
  else if (isLegion) products = [{name:'拯救者Y9000P',price:'9,999',image:''},{name:'拯救者R9000P',price:'7,999',image:''},{name:'拯救者Y7000P',price:'6,499',image:''},{name:'拯救者Y9000K',price:'14,999',image:''}];
  comps.push({id:uid(),type:'product-grid',props:{title:isEnterprise?'企业热门产品':'爆款推荐',columns:4,products}});
  // 图文亮点
  comps.push({id:uid(),type:'image-text',props:{...PAGE_COMPONENTS['image-text'].defaults, title:isTP?'商务旗舰 · 性能巅峰':isYoga?'创意设计 · 灵感无界':isLegion?'电竞级散热 · 满血释放':'AI智能芯片 · 旗舰体验', description:isTP?'搭载Intel Ultra处理器，32GB大内存，2.8K OLED屏幕，1.08kg超轻机身。':isLegion?'全新散热架构，NVIDIA RTX独显满血释放，240Hz电竞屏，畅快游戏体验。':'AI芯片加持，智能降噪长续航，轻至1.08kg，满足全天候移动办公需求。'}});
  // CTA
  comps.push({id:uid(),type:'cta-button',props:{...PAGE_COMPONENTS['cta-button'].defaults, text:isEnterprise?'立即咨询':'立即选购', style:isLegion?'green':isEnterprise?'primary':'dark'}});
  _pb.page.components = comps;
  _pb.dirty = true; _pb.selectedId = null;
  pbRenderCanvas(); pbRenderProps();
}

// ===== AI 配置 =====
let _botConfig = {};
async function loadBotConfig() {
  try {
    const res = await fetch('/api/admin/bot-config');
    const data = await res.json();
    _botConfig = data.config || data || {};
    const el = document.getElementById('bot-config-area');
    if (!el) return;
    const cfg = _botConfig;
    el.innerHTML = `
      <div class="card"><div class="card-header"><div class="card-title">System Prompt</div></div>
        <textarea id="cfg-prompt" rows="6" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:monospace;resize:vertical;background:#f5f6f7">${cfg.system_prompt || ''}</textarea>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-title">模型配置</div><div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;align-items:center;gap:8px"><label style="width:100px;font-size:12px">主模型:</label><input id="cfg-model" value="${cfg.model || 'qwen-plus'}" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:#f5f6f7"></div>
          <div style="display:flex;align-items:center;gap:8px"><label style="width:100px;font-size:12px">Temperature:</label><input id="cfg-temp" type="number" step="0.1" min="0" max="2" value="${cfg.temperature || 0.7}" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:#f5f6f7"></div>
          <div style="display:flex;align-items:center;gap:8px"><label style="width:100px;font-size:12px">Max Tokens:</label><input id="cfg-tokens" type="number" value="${cfg.max_tokens || 1024}" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:#f5f6f7"></div>
        </div></div>
        <div class="card"><div class="card-title">检索配置</div><div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;align-items:center;gap:8px"><label style="width:100px;font-size:12px">Top-K:</label><input id="cfg-topk" type="number" value="${cfg.top_k || 5}" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:#f5f6f7"></div>
          <div style="display:flex;align-items:center;gap:8px"><label style="width:100px;font-size:12px">欢迎语:</label><input id="cfg-welcome" value="${cfg.welcome_message || ''}" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:#f5f6f7"></div>
        </div></div>
      </div>`;
  } catch (e) { const el = document.getElementById('bot-config-area'); if (el) el.innerHTML = `<div style="color:var(--red);padding:20px">加载失败: ${e.message}</div>`; }
}
async function saveBotConfig() {
  const updates = {};
  const promptEl = document.getElementById('cfg-prompt');
  if (promptEl) updates.system_prompt = promptEl.value;
  const modelEl = document.getElementById('cfg-model');
  if (modelEl) updates.model = modelEl.value;
  const tempEl = document.getElementById('cfg-temp');
  if (tempEl) updates.temperature = tempEl.value;
  const tokensEl = document.getElementById('cfg-tokens');
  if (tokensEl) updates.max_tokens = tokensEl.value;
  const topkEl = document.getElementById('cfg-topk');
  if (topkEl) updates.top_k = topkEl.value;
  const welcomeEl = document.getElementById('cfg-welcome');
  if (welcomeEl) updates.welcome_message = welcomeEl.value;
  try {
    const r = await fetch('/api/admin/bot-config', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(updates) });
    if (!r.ok) throw new Error('保存失败');
    alert('配置已保存');
  } catch (e) { alert(e.message); }
}

// ===== 操作日志 =====
async function loadFeLogs() {
  try {
    const res = await fetch('/api/admin/logs?limit=50');
    const data = await res.json();
    const logs = data.logs || data || [];
    const el = document.getElementById('fe-logs-area');
    if (!el) return;
    if (!logs.length) { el.innerHTML = '<div class="card"><div style="text-align:center;padding:20px;color:var(--text-tertiary)">暂无日志</div></div>'; return; }
    el.innerHTML = `<div class="card"><table><tr><th>时间</th><th>类型</th><th>消息</th><th>页面</th></tr>` +
      logs.map(l => `<tr><td style="white-space:nowrap">${(l.created_at||'').slice(0,19)}</td><td><span class="badge ${l.type==='error'?'badge-red':l.type==='api_error'?'badge-orange':''}">${l.type||'-'}</span></td><td style="max-width:400px;overflow:hidden;text-overflow:ellipsis">${l.message||'-'}</td><td>${l.page||'-'}</td></tr>`).join('') + '</table></div>';
  } catch (e) { const el = document.getElementById('fe-logs-area'); if (el) el.innerHTML = `<div style="color:var(--red);padding:20px">加载失败: ${e.message}</div>`; }
}

// ===== 电商：商品 CRUD =====
let _prodCategories = [];

let _prodPage = 1;
async function loadProducts(page) {
  if (page !== undefined) _prodPage = page;
  const cat = document.getElementById('prod-cat-filter')?.value || '';
  const status = document.getElementById('prod-status-filter')?.value || '';
  const q = document.getElementById('prod-search')?.value || '';
  const params = new URLSearchParams({ limit: 50, page: _prodPage });
  if (cat) params.set('category', cat);
  if (status) params.set('status', status);
  if (q) params.set('q', q);

  try {
    const [prodRes, catRes, statsRes] = await Promise.all([
      fetch('/api/admin/products?' + params),
      _prodCategories.length ? null : fetch('/api/admin/product-categories'),
      fetch('/api/admin/products/stats')
    ]);
    const data = await prodRes.json();
    if (catRes) {
      _prodCategories = await catRes.json();
      const sel = document.getElementById('prod-cat-filter');
      if (sel && sel.options.length <= 1) {
        _prodCategories.forEach(c => { const o = document.createElement('option'); o.value = c.name; o.textContent = c.name; sel.appendChild(o); });
      }
    }
    const stats = await statsRes.json();
    const s = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    s('prod-active', stats.active);
    s('prod-offline', stats.offline);
    s('prod-draft', stats.draft);
    s('prod-total', stats.total);

    const products = data.products || [];
    const el = document.getElementById('prod-list');
    if (!el) return;
    if (!products.length) {
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary)">暂无商品</div>';
      return;
    }
    const statusMap = { active: '<span class="badge status-on">在售</span>', offline: '<span class="badge status-off">已下架</span>', draft: '<span class="badge">草稿</span>' };
    const tableHtml = `<table><tr><th>商品名称</th><th>SKU</th><th>分类</th><th>价格</th><th>库存</th><th>状态</th><th>操作</th></tr>` +
      products.map(p => `<tr>
        <td>${p.name}</td><td>${p.sku || '-'}</td><td>${p.category || '-'}</td>
        <td>¥${Number(p.price).toLocaleString()}</td><td>${p.stock}</td>
        <td>${statusMap[p.status] || p.status}</td>
        <td style="white-space:nowrap">
          <a style="color:var(--primary);cursor:pointer;font-size:12px;margin-right:8px" onclick="showProductForm(${p.id})">编辑</a>
          <a style="color:var(--red);cursor:pointer;font-size:12px" onclick="deleteProduct(${p.id},'${p.name.replace(/'/g,"\\'")}')">删除</a>
        </td></tr>`).join('') + '</table>';

    // Pagination
    const totalPages = data.pages || 1;
    const curPage = data.page || 1;
    let pager = '';
    if (totalPages > 1) {
      pager = '<div style="display:flex;justify-content:center;align-items:center;gap:8px;padding:12px 0;font-size:13px">';
      pager += curPage > 1 ? `<a onclick="loadProducts(${curPage-1})" style="color:var(--primary);cursor:pointer">上一页</a>` : '<span style="color:var(--text-tertiary)">上一页</span>';
      // Show page numbers: first, ..., cur-1, cur, cur+1, ..., last
      const pages = new Set([1, totalPages, curPage, curPage-1, curPage+1].filter(p => p >= 1 && p <= totalPages));
      const sorted = [...pages].sort((a,b) => a-b);
      let last = 0;
      sorted.forEach(p => {
        if (p - last > 1) pager += '<span style="color:var(--text-tertiary)">...</span>';
        pager += p === curPage
          ? `<span style="background:var(--primary);color:#fff;padding:2px 8px;border-radius:4px">${p}</span>`
          : `<a onclick="loadProducts(${p})" style="color:var(--primary);cursor:pointer;padding:2px 8px">${p}</a>`;
        last = p;
      });
      pager += curPage < totalPages ? `<a onclick="loadProducts(${curPage+1})" style="color:var(--primary);cursor:pointer">下一页</a>` : '<span style="color:var(--text-tertiary)">下一页</span>';
      pager += `<span style="color:var(--text-tertiary);margin-left:8px">共${data.total}条</span></div>`;
    }
    el.innerHTML = tableHtml + pager;
  } catch (e) {
    const el = document.getElementById('prod-list');
    if (el) el.innerHTML = `<div style="color:var(--red);padding:20px">加载失败: ${e.message}</div>`;
  }
}

async function showProductForm(editId) {
  let prod = { name: '', sku: '', category: '', price: '', original_price: '', status: 'draft', stock: 0, description: '' };
  if (editId) {
    try { prod = await (await fetch(`/api/admin/products/${editId}`)).json(); } catch {}
  }
  const catOptions = _prodCategories.map(c => `<option value="${c.name}" ${c.name === prod.category ? 'selected' : ''}>${c.name}</option>`).join('');
  const html = `<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center" id="prod-modal" onclick="if(event.target===this)this.remove()">
    <div style="background:#fff;border-radius:12px;padding:24px;width:520px;max-width:90vw;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.2)">
      <h3 style="margin:0 0 16px">${editId ? '编辑商品' : '新增商品'}</h3>
      <div style="display:flex;flex-direction:column;gap:10px">
        <input id="pf-name" value="${prod.name}" placeholder="商品名称 *" style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:#f5f6f7">
        <div style="display:flex;gap:8px">
          <input id="pf-sku" value="${prod.sku || ''}" placeholder="SKU" style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:#f5f6f7">
          <select id="pf-cat" style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:#f5f6f7"><option value="">选择分类</option>${catOptions}</select>
        </div>
        <div style="display:flex;gap:8px">
          <input id="pf-price" type="number" value="${prod.price || ''}" placeholder="售价" style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:#f5f6f7">
          <input id="pf-oprice" type="number" value="${prod.original_price || ''}" placeholder="原价" style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:#f5f6f7">
        </div>
        <div style="display:flex;gap:8px">
          <input id="pf-stock" type="number" value="${prod.stock || 0}" placeholder="库存" style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:#f5f6f7">
          <select id="pf-status" style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:#f5f6f7">
            <option value="draft" ${prod.status==='draft'?'selected':''}>草稿</option>
            <option value="active" ${prod.status==='active'?'selected':''}>在售</option>
            <option value="offline" ${prod.status==='offline'?'selected':''}>已下架</option>
          </select>
        </div>
        <textarea id="pf-desc" placeholder="商品描述" rows="3" style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:#f5f6f7;resize:vertical">${prod.description || ''}</textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
          <button class="btn btn-sm" onclick="document.getElementById('prod-modal').remove()">取消</button>
          <button class="btn btn-sm btn-primary" onclick="submitProduct(${editId || 'null'})">保存</button>
        </div>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

async function submitProduct(editId) {
  const body = {
    name: document.getElementById('pf-name').value.trim(),
    sku: document.getElementById('pf-sku').value.trim(),
    category: document.getElementById('pf-cat').value,
    price: document.getElementById('pf-price').value,
    original_price: document.getElementById('pf-oprice').value,
    stock: document.getElementById('pf-stock').value,
    status: document.getElementById('pf-status').value,
    description: document.getElementById('pf-desc').value.trim()
  };
  if (!body.name) return alert('商品名称不能为空');
  try {
    const url = editId ? `/api/admin/products/${editId}` : '/api/admin/products';
    const method = editId ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    document.getElementById('prod-modal').remove();
    loadProducts();
  } catch (e) { alert('保存失败: ' + e.message); }
}

async function deleteProduct(id, name) {
  if (!confirm(`确认删除商品「${name}」？`)) return;
  try {
    const res = await fetch(`/api/admin/products/${id}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    loadProducts();
  } catch (e) { alert('删除失败: ' + e.message); }
}

// ===== 电商：分类管理 =====
async function loadCategories() {
  try {
    const res = await fetch('/api/admin/product-categories');
    const rows = await res.json();
    const el = document.getElementById('cat-list');
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary)">暂无分类</div>';
      return;
    }
    // count products per category (server-side aggregation)
    const countRes = await fetch('/api/admin/products/category-counts');
    const countMap = await countRes.json();

    el.innerHTML = `<table><tr><th>分类名称</th><th>商品数</th><th>排序</th><th>状态</th><th>操作</th></tr>` +
      rows.map(c => `<tr>
        <td>${c.name}</td>
        <td>${countMap[c.name] || 0}</td>
        <td>${c.sort_order}</td>
        <td>${c.status ? '<span class="badge status-on">启用</span>' : '<span class="badge status-off">禁用</span>'}</td>
        <td><a style="color:var(--red);cursor:pointer;font-size:12px" onclick="deleteCategory(${c.id},'${c.name.replace(/'/g,"\\'")}')">删除</a></td>
      </tr>`).join('') + '</table>';
  } catch (e) {
    const el = document.getElementById('cat-list');
    if (el) el.innerHTML = `<div style="color:var(--red);padding:20px">加载失败: ${e.message}</div>`;
  }
}

function showAddCategory() {
  const name = prompt('输入分类名称:');
  if (!name || !name.trim()) return;
  fetch('/api/admin/product-categories', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name: name.trim() }) })
    .then(r => { if (!r.ok) return r.json().then(d => { throw new Error(d.error); }); loadCategories(); })
    .catch(e => alert('添加失败: ' + e.message));
}

async function deleteCategory(id, name) {
  if (!confirm(`确认删除分类「${name}」？`)) return;
  try {
    const res = await fetch(`/api/admin/product-categories/${id}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    loadCategories();
  } catch (e) { alert('删除失败: ' + e.message); }
}

// ===== 营销任务 =====
async function loadMarketingTasks() {
  try {
    const res = await fetch('/api/admin/marketing-tasks');
    const rows = await res.json();
    const s = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    s('mkt-pending', rows.filter(r => r.status === 'scheduled' || r.status === 'running').length);
    s('mkt-completed', rows.filter(r => r.status === 'completed').length);
    s('mkt-draft', rows.filter(r => r.status === 'draft').length);
    s('mkt-total', rows.length);

    const el = document.getElementById('mkt-list');
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary)">暂无任务，点击上方按钮创建</div>';
      return;
    }
    const statusMap = { draft: '<span class="badge">草稿</span>', scheduled: '<span class="badge status-warn">待执行</span>', running: '<span class="badge status-on">运行中</span>', completed: '<span class="badge status-off">已完成</span>' };
    const typeMap = { push: '推送通知', email: '邮件', sms: '短信', precision: '精准营销', recall: '召回' };
    el.innerHTML = `<table><tr><th>任务名称</th><th>类型</th><th>目标客群</th><th>状态</th><th>触达/点击/转化</th><th>操作</th></tr>` +
      rows.map(r => {
        const stats = r.status === 'completed' ? `${r.reach_count}/${r.click_count}/${r.convert_count}` : '-';
        let actions = '';
        if (r.status === 'draft' || r.status === 'scheduled') {
          actions = `<a style="color:var(--primary);cursor:pointer;font-size:12px;margin-right:8px" onclick="showMarketingForm(${r.id})">编辑</a>
            <a style="color:var(--green);cursor:pointer;font-size:12px;margin-right:8px" onclick="executeMarketingTask(${r.id})">执行</a>
            <a style="color:var(--red);cursor:pointer;font-size:12px" onclick="deleteMarketingTask(${r.id},'${r.name.replace(/'/g,"\\'")}')">删除</a>`;
        } else {
          actions = `<a style="color:var(--red);cursor:pointer;font-size:12px" onclick="deleteMarketingTask(${r.id},'${r.name.replace(/'/g,"\\'")}')">删除</a>`;
        }
        return `<tr><td>${r.name}</td><td>${typeMap[r.type] || r.type}</td><td>${r.target_audience || '-'}</td><td>${statusMap[r.status] || r.status}</td><td>${stats}</td><td style="white-space:nowrap">${actions}</td></tr>`;
      }).join('') + '</table>';
  } catch (e) {
    const el = document.getElementById('mkt-list');
    if (el) el.innerHTML = `<div style="color:var(--red);padding:20px">加载失败: ${e.message}</div>`;
  }
}

function showMarketingForm(editId) {
  const html = `<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center" id="mkt-modal" onclick="if(event.target===this)this.remove()">
    <div style="background:#fff;border-radius:12px;padding:24px;width:500px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,0.2)">
      <h3 style="margin:0 0 16px">${editId ? '编辑任务' : '创建营销任务'}</h3>
      <div style="display:flex;flex-direction:column;gap:10px">
        <input id="mkt-name" placeholder="任务名称 *" style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:#f5f6f7">
        <div style="display:flex;gap:8px">
          <select id="mkt-type" style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:#f5f6f7">
            <option value="push">推送通知</option><option value="email">邮件</option><option value="sms">短信</option><option value="precision">精准营销</option><option value="recall">召回</option>
          </select>
          <select id="mkt-status" style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:#f5f6f7">
            <option value="draft">草稿</option><option value="scheduled">待执行</option>
          </select>
        </div>
        <input id="mkt-audience" placeholder="目标客群（如：活跃用户、30天未活跃）" style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:#f5f6f7">
        <textarea id="mkt-content" placeholder="推送内容/文案" rows="3" style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:#f5f6f7;resize:vertical"></textarea>
        <input id="mkt-schedule" type="datetime-local" style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:#f5f6f7">
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
          <button class="btn btn-sm" onclick="document.getElementById('mkt-modal').remove()">取消</button>
          <button class="btn btn-sm btn-primary" onclick="submitMarketingTask(${editId || 'null'})">保存</button>
        </div>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);

  if (editId) {
    fetch(`/api/admin/marketing-tasks`).then(r => r.json()).then(rows => {
      const t = rows.find(r => r.id === editId);
      if (!t) return;
      document.getElementById('mkt-name').value = t.name;
      document.getElementById('mkt-type').value = t.type;
      document.getElementById('mkt-status').value = t.status;
      document.getElementById('mkt-audience').value = t.target_audience || '';
      document.getElementById('mkt-content').value = t.content || '';
      if (t.scheduled_at) document.getElementById('mkt-schedule').value = t.scheduled_at.slice(0, 16);
    });
  }
}

async function submitMarketingTask(editId) {
  const body = {
    name: document.getElementById('mkt-name').value.trim(),
    type: document.getElementById('mkt-type').value,
    status: document.getElementById('mkt-status').value,
    target_audience: document.getElementById('mkt-audience').value.trim(),
    content: document.getElementById('mkt-content').value.trim(),
    scheduled_at: document.getElementById('mkt-schedule').value || null
  };
  if (!body.name) return alert('任务名称不能为空');
  try {
    const url = editId ? `/api/admin/marketing-tasks/${editId}` : '/api/admin/marketing-tasks';
    const method = editId ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    document.getElementById('mkt-modal').remove();
    loadMarketingTasks();
  } catch (e) { alert('保存失败: ' + e.message); }
}

async function executeMarketingTask(id) {
  if (!confirm('确认执行此营销任务？（模拟执行）')) return;
  try {
    await fetch(`/api/admin/marketing-tasks/${id}/execute`, { method: 'PUT' });
    loadMarketingTasks();
  } catch (e) { alert('执行失败: ' + e.message); }
}

async function deleteMarketingTask(id, name) {
  if (!confirm(`确认删除任务「${name}」？`)) return;
  try {
    const res = await fetch(`/api/admin/marketing-tasks/${id}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    loadMarketingTasks();
  } catch (e) { alert('删除失败: ' + e.message); }
}

async function loadOverviewStats() {
  try {
    const res = await fetch('/api/admin/stats');
    if (!res.ok) return;
    const data = await res.json();
    const ov = data.overview || {};
    const kb = data.knowledge || {};
    const s = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };

    s('ov-convs', (ov.totalConvs || 0).toLocaleString());
    s('ov-today', (ov.todayConvs || 0).toLocaleString());
    s('ov-msgs', (ov.totalUserMsgs || 0).toLocaleString());
    s('ov-docs', (kb.docs || 0).toLocaleString());
    s('ov-satisfaction', ov.satisfaction != null ? ov.satisfaction + '%' : '暂无');

    // 差评问题列表
    const bfEl = document.getElementById('ov-bad-feedback');
    if (bfEl) {
      const bf = data.badFeedback || [];
      if (!bf.length) {
        bfEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary)">暂无差评 🎉</div>';
      } else {
        bfEl.innerHTML = bf.slice(0, 10).map(f =>
          `<div style="padding:8px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.question || f.title || '未知问题'}</span>
            <span style="color:var(--text-tertiary);font-size:12px;margin-left:12px;white-space:nowrap">${(f.created_at || '').slice(0, 10)}</span>
          </div>`
        ).join('');
      }
    }

    // 7日对话趋势柱状图
    const trendEl = document.getElementById('ov-trend');
    if (trendEl) {
      const trend = data.trend || [];
      if (!trend.length) {
        trendEl.innerHTML = '<div style="text-align:center;width:100%;color:var(--text-tertiary)">暂无数据</div>';
      } else {
        const maxN = Math.max(...trend.map(t => t.n), 1);
        trendEl.innerHTML = trend.map(t => {
          const pct = Math.max(t.n / maxN * 100, 4);
          const day = (t.day || '').slice(5);
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
            <span style="font-size:12px;font-weight:600">${t.n}</span>
            <div style="width:100%;max-width:40px;height:${pct}px;background:var(--primary);border-radius:4px 4px 0 0;min-height:4px"></div>
            <span style="font-size:11px;color:var(--text-tertiary)">${day}</span>
          </div>`;
        }).join('');
      }
    }
  } catch (e) {
    console.error('[Overview] 加载失败:', e.message);
  }
}

async function loadExperiments() {
  try {
    const res = await fetch('/api/admin/experiments');
    if (!res.ok) return;
    const rows = await res.json();
    const s = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    s('exp-running', rows.filter(r => r.status === 'running').length);
    s('exp-completed', rows.filter(r => r.status === 'completed').length);
    s('exp-other', rows.filter(r => r.status !== 'running' && r.status !== 'completed').length);
    s('exp-total', rows.length);

    const el = document.getElementById('exp-list');
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary)">暂无实验，点击上方按钮创建</div>';
      return;
    }
    const statusMap = { running: '<span class="badge status-on">运行中</span>', completed: '<span class="badge status-off">已结束</span>', paused: '<span class="badge" style="background:var(--orange);color:#fff">暂停</span>', draft: '<span class="badge">草稿</span>' };
    el.innerHTML = `<table><tr><th>实验名称</th><th>描述</th><th>变体 A</th><th>变体 B</th><th>流量</th><th>状态</th><th>操作</th></tr>` +
      rows.map(r => {
        const split = Math.round((r.traffic_split || 0.5) * 100);
        const actions = r.status === 'running'
          ? `<button class="btn btn-sm" onclick="updateExpStatus(${r.id},'paused')">暂停</button> <button class="btn btn-sm" onclick="updateExpStatus(${r.id},'completed')">结束</button>`
          : r.status === 'draft' || r.status === 'paused'
          ? `<button class="btn btn-sm btn-primary" onclick="updateExpStatus(${r.id},'running')">启动</button>`
          : '-';
        return `<tr><td>${r.name}</td><td>${r.description || '-'}</td><td>${r.variant_a || '-'}</td><td>${r.variant_b || '-'}</td><td>${split}/${100-split}</td><td>${statusMap[r.status] || r.status}</td><td>${actions}</td></tr>`;
      }).join('') + '</table>';
  } catch (e) {
    const el = document.getElementById('exp-list');
    if (el) el.innerHTML = `<div style="color:var(--red);padding:20px">加载失败: ${e.message}</div>`;
  }
}

async function updateExpStatus(id, status) {
  try {
    await fetch(`/api/admin/experiments/${id}/status`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({status}) });
    loadExperiments();
  } catch (e) { alert('操作失败: ' + e.message); }
}

function showCreateExperiment() {
  const html = `<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center" id="exp-modal" onclick="if(event.target===this)this.remove()">
    <div style="background:#fff;border-radius:12px;padding:24px;width:480px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,0.2)">
      <h3 style="margin:0 0 16px">创建 AB 实验</h3>
      <div style="display:flex;flex-direction:column;gap:12px">
        <input id="exp-name" placeholder="实验名称" style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:#f5f6f7">
        <input id="exp-desc" placeholder="描述（可选）" style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:#f5f6f7">
        <input id="exp-va" placeholder="变体 A（对照组）" style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:#f5f6f7">
        <input id="exp-vb" placeholder="变体 B（实验组）" style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:#f5f6f7">
        <div style="display:flex;align-items:center;gap:8px"><label style="font-size:13px">流量分配:</label><input id="exp-split" type="number" value="50" min="1" max="99" style="width:60px;padding:8px;border:1px solid var(--border);border-radius:6px;background:#f5f6f7"><span style="font-size:13px">% 给 B 组</span></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
          <button class="btn btn-sm" onclick="document.getElementById('exp-modal').remove()">取消</button>
          <button class="btn btn-sm btn-primary" onclick="submitExperiment()">创建</button>
        </div>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

async function submitExperiment() {
  const name = document.getElementById('exp-name').value.trim();
  const va = document.getElementById('exp-va').value.trim();
  const vb = document.getElementById('exp-vb').value.trim();
  if (!name || !va || !vb) return alert('名称和变体不能为空');
  try {
    const res = await fetch('/api/admin/experiments', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ name, description: document.getElementById('exp-desc').value.trim(), variant_a: va, variant_b: vb, traffic_split: (parseInt(document.getElementById('exp-split').value) || 50) / 100 })
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    document.getElementById('exp-modal').remove();
    loadExperiments();
  } catch (e) { alert('创建失败: ' + e.message); }
}

async function doBackup() {
  if (!confirm('确认备份数据库？')) return;
  try {
    const res = await fetch('/api/admin/backup', { method: 'POST' });
    const data = await res.json();
    alert(data.message || '备份完成');
  } catch (e) { alert('备份失败: ' + e.message); }
}

async function doRestart() {
  if (!confirm('确认重启服务？进程将由 pm2 自动重拉。')) return;
  try {
    await fetch('/api/admin/restart', { method: 'POST' });
    alert('重启指令已发送');
  } catch (e) { alert('发送失败: ' + e.message); }
}

// ===== PAGE LIFECYCLE =====
// 页面切换后自动加载数据
// ===== 联想真实API数据加载 =====

async function loadAftersale() {
  const el = document.getElementById('as-articles');
  if (!el) return;
  try {
    const res = await fetch('/api/lenovo/support/articles');
    const data = await res.json();
    const articles = (data.data || []).slice(0, 10);
    const countEl = document.getElementById('as-article-count');
    if (countEl) countEl.textContent = articles.length + '+';
    if (!articles.length) { el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary)">暂无文章</div>'; return; }
    el.innerHTML = articles.map(a => `<div style="padding:10px 0;border-bottom:1px solid var(--border-light);display:flex;gap:12px;align-items:flex-start">
      ${a.cover_img ? `<img src="${a.cover_img}" style="width:80px;height:50px;object-fit:cover;border-radius:4px;flex-shrink:0" onerror="this.style.display='none'">` : ''}
      <div style="flex:1;min-width:0">
        <a href="https://newsupport.lenovo.com.cn/doc/${a.doc_code}" target="_blank" style="font-size:13px;font-weight:500;color:var(--text);text-decoration:none;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.title || '无标题'}</a>
        <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.description || ''}</div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">${a.line_category_name || ''} · ${(a.create_time || '').slice(0, 10)}</div>
      </div>
    </div>`).join('');
  } catch (e) {
    el.innerHTML = `<div style="color:var(--red);padding:12px">加载失败: ${e.message}</div>`;
  }
}

async function searchDrivers() {
  const kw = document.getElementById('as-driver-kw')?.value?.trim();
  const el = document.getElementById('as-drivers');
  if (!kw || !el) return;
  el.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-tertiary)">搜索中...</div>';
  try {
    const res = await fetch(`/api/lenovo/support/drivers?keyword=${encodeURIComponent(kw)}`);
    const data = await res.json();
    if (data.statusCode === 422 || !data.data || !data.data.length) {
      el.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-tertiary)">未找到相关驱动</div>'; return;
    }
    const drivers = (data.data || []).slice(0, 10);
    el.innerHTML = drivers.map(d => `<div style="padding:8px 0;border-bottom:1px solid var(--border-light);font-size:12px">
      <div style="font-weight:500">${d.name || d.title || '未知驱动'}</div>
      <div style="color:var(--text-tertiary);margin-top:2px">${d.version || ''} ${d.size || ''}</div>
    </div>`).join('');
  } catch (e) {
    el.innerHTML = `<div style="color:var(--red);padding:12px">搜索失败: ${e.message}</div>`;
  }
}

async function loadOrders() {
  const authEl = document.getElementById('order-auth-status');
  const contentEl = document.getElementById('order-content');
  if (!contentEl) return;
  try {
    const res = await fetch('/api/lenovo/user/order/list');
    const data = await res.json();
    if (data.error && data.error.includes('Cookie')) {
      authEl.innerHTML = `<div class="demo-banner" style="border-color:var(--orange);background:var(--orange-light)"><span class="demo-icon">🔐</span> 需要联想Passport Cookie才能查看真实订单。请在系统设置中配置 LENOVO_PASSPORT_COOKIE 环境变量，或<a href="https://reg.lenovo.com.cn/auth/v1/login" target="_blank">登录联想账号</a>后获取Cookie。</div>`;
      contentEl.innerHTML = `<div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-label">数据来源</div><div class="kpi-value" style="font-size:16px">i.lenovo.com.cn</div></div>
        <div class="kpi-card"><div class="kpi-label">API端点</div><div class="kpi-value" style="font-size:14px">/api/order/list</div></div>
        <div class="kpi-card"><div class="kpi-label">认证方式</div><div class="kpi-value" style="font-size:14px">Passport Cookie</div></div>
        <div class="kpi-card"><div class="kpi-label">状态</div><div class="kpi-value" style="font-size:16px;color:var(--orange)">待配置</div></div>
      </div>`;
      return;
    }
    authEl.innerHTML = '';
    contentEl.innerHTML = `<div class="card"><pre style="padding:12px;font-size:12px;overflow:auto;max-height:400px">${JSON.stringify(data, null, 2)}</pre></div>`;
  } catch (e) {
    contentEl.innerHTML = `<div style="color:var(--red);padding:20px">加载失败: ${e.message}</div>`;
  }
}

async function searchStores() {
  const address = document.getElementById('store-address')?.value?.trim();
  const el = document.getElementById('store-results');
  if (!address || !el) return;
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary)">搜索中...</div>';
  try {
    // 先地理编码
    const geoRes = await fetch(`/api/stores/geocode?address=${encodeURIComponent(address)}`);
    const geo = await geoRes.json();
    if (geo.error) { el.innerHTML = `<div style="text-align:center;padding:20px;color:var(--red)">${geo.error}</div>`; return; }
    // 搜索附近门店
    const storeRes = await fetch(`/api/stores/nearby?lat=${geo.lat}&lng=${geo.lng}`);
    const storeData = await storeRes.json();
    if (storeData.error) { el.innerHTML = `<div style="text-align:center;padding:20px;color:var(--red)">${storeData.error}</div>`; return; }
    const stores = storeData.stores || [];
    if (!stores.length) { el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary)">附近20km内未找到联想门店</div>'; return; }
    el.innerHTML = `<div class="card"><div class="card-header"><div class="card-title">📍 "${geo.name || address}" 附近 ${stores.length} 家门店</div></div>
      <table><tr><th>门店名称</th><th>地址</th><th>电话</th><th>距离</th></tr>
      ${stores.map(s => `<tr>
        <td style="font-weight:500">${s.name}</td>
        <td style="font-size:12px;color:var(--text-secondary)">${s.address}</td>
        <td style="font-size:12px">${s.tel || '-'}</td>
        <td style="font-size:12px;white-space:nowrap">${s.dist >= 1000 ? (s.dist/1000).toFixed(1) + 'km' : s.dist + 'm'}</td>
      </tr>`).join('')}
      </table></div>`;
  } catch (e) {
    el.innerHTML = `<div style="color:var(--red);padding:20px">搜索失败: ${e.message}</div>`;
  }
}

const _origSwitch = switchPage;
switchPage = function(pageId) {
  _origSwitch(pageId);
  // peek模式下选完页面，不立即收回，等鼠标离开侧栏后收回
  if (pageId === 'dashboard.overview') loadOverviewStats();
  if (pageId === 'dashboard.query') loadQueryAnalysis();
  if (pageId === 'dashboard.geo') {
    geoState.scope = 'all'; geoState.platform = 'all'; geoState.period = '30d'; geoState.questions = [];
    setTimeout(() => {
      const ps = document.getElementById('geo-period'); if (ps) ps.value = '30d';
      const qi = document.getElementById('geo-questions'); if (qi) qi.value = '';
      geoLoadData();
    }, 50);
  }
  if (pageId === 'dashboard.geoSource') {
    setTimeout(() => geoLoadSourcePage(), 50);
  }
  if (pageId === 'dashboard.geoKnowledge') {
    setTimeout(() => loadKnowledgeStats(), 50);
  }
};

// ===== GLOBAL SEARCH with DROPDOWN =====
function getSearchResults(q) {
  const results = [];
  if (!q) return results;
  for (const [groupKey, group] of Object.entries(MENU_TREE)) {
    for (const [pageId, page] of Object.entries(group.children)) {
      if (page.label.toLowerCase().includes(q) || pageId.includes(q) || group.label.toLowerCase().includes(q)) {
        results.push({ pageId, label: page.label, group: group.label });
      }
    }
  }
  return results;
}

function renderSearchDropdown(q) {
  const dd = document.getElementById('search-dropdown');
  if (!q) { dd.style.display = 'none'; return; }
  const results = getSearchResults(q);
  if (!results.length) {
    dd.innerHTML = `<div style="padding:12px;text-align:center;color:var(--text-tertiary);font-size:12px">按 Enter 发送到 AI 助手</div>`;
  } else {
    dd.innerHTML = results.map((r, i) =>
      `<div class="search-item${i===0?' active':''}" data-page="${r.pageId}" style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;border-bottom:1px solid var(--border-light)" onmouseenter="this.classList.add('active');[...this.parentNode.children].filter(c=>c!==this).forEach(c=>c.classList.remove('active'))" onmouseleave="this.classList.remove('active')" onclick="switchPage('${r.pageId}');document.getElementById('global-search').value='';document.getElementById('search-dropdown').style.display='none'">
        <span style="color:var(--text-tertiary)">${r.group} ›</span> <span style="font-weight:500">${r.label}</span>
      </div>`
    ).join('');
  }
  dd.style.display = 'block';
}

document.getElementById('global-search').addEventListener('input', function(e) {
  renderSearchDropdown(e.target.value.toLowerCase().trim());
});

document.getElementById('global-search').addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    document.getElementById('search-dropdown').style.display = 'none'; return;
  }
  if (e.key === 'Enter') {
    const q = e.target.value.toLowerCase().trim();
    if (!q) return;
    const results = getSearchResults(q);
    if (results.length) {
      switchPage(results[0].pageId);
      e.target.value = '';
      document.getElementById('search-dropdown').style.display = 'none';
      return;
    }
    // 没匹配到菜单，发送到 AI 助手
    if (!STATE.aiOpen) toggleAI();
    document.getElementById('ai-input').value = e.target.value;
    e.target.value = '';
    document.getElementById('search-dropdown').style.display = 'none';
    aiSend();
  }
});

document.getElementById('global-search').addEventListener('blur', function() {
  setTimeout(() => { document.getElementById('search-dropdown').style.display = 'none'; }, 200);
});

// ===== DARK MODE =====
function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark-mode');
  localStorage.setItem('lexiang_dark', isDark ? '1' : '0');
  document.getElementById('dark-mode-btn').textContent = isDark ? '☀️' : '🌙';
}
// 恢复深色模式状态
if (localStorage.getItem('lexiang_dark') === '1') {
  document.body.classList.add('dark-mode');
  document.getElementById('dark-mode-btn').textContent = '☀️';
}

// ===== 外部数据集成 =====
const LENOVO_PROVINCE_MAP = {"010":"北京市","020":"上海市","030":"天津市","040":"内蒙古","050":"山西省","060":"河北省","070":"辽宁省","080":"吉林省","090":"黑龙江省","100":"江苏省","110":"安徽省","120":"山东省","130":"浙江省","140":"江西省","150":"福建省","160":"湖南省","170":"湖北省","180":"河南省","190":"广东省","200":"海南省","210":"广西","220":"贵州省","230":"四川省","240":"云南省","250":"陕西省","260":"甘肃省","270":"宁夏","280":"青海省","290":"新疆","300":"西藏","320":"重庆市"};
const LENOVO_CHANNEL_MAP = {"official":"联想官网","douyin":"抖音","kuaishou":"快手","mobile":"移动端","tmall":"天猫","jd":"京东","Unknown":"其他"};


async function loadLenovoBigscreen() {
  const el = document.getElementById('lenovo-bigscreen-content');
  if (!el) return;
  el.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><div>加载中...</div></div>';
  try {
    const [chResp, arResp] = await Promise.all([
      fetch('/aiadmin/proxy/old/cdashboard/dashboard/channel'),
      fetch('/aiadmin/proxy/old/cdashboard/dashboard/area')
    ]);
    const ch = await chResp.json();
    const ar = await arResp.json();

    if (ch.status === 701 || ar.status === 701 || (ch.msg && ch.msg.includes('登录'))) {
      el.innerHTML = `<div class="empty-state"><div class="icon">🔒</div><div style="font-size:15px;font-weight:600;margin:8px 0">会话已过期</div><div style="font-size:13px;color:var(--text-tertiary);max-width:500px;margin:0 auto;line-height:1.8">数据源登录状态已失效，请联系管理员刷新凭证后重试。</div></div>`;
      return;
    }

    const channels = (ch.channels || []).map(c => ({
      channel: c.channel,
      channelName: LENOVO_CHANNEL_MAP[c.channel] || c.channel,
      total: c.total || 0,
      yesHourData: c.yesHourData || [],
      todayHourData: c.todayHourData || [],
    })).sort((a,b) => b.total - a.total);

    const yesHourly = Array(24).fill(0);
    const todayHourly = Array(24).fill(0);
    channels.forEach(c => {
      (c.yesHourData||[]).forEach(h => { yesHourly[h.hour] = (yesHourly[h.hour]||0) + (h.total||0); });
      (c.todayHourData||[]).forEach(h => { todayHourly[h.hour] = (todayHourly[h.hour]||0) + (h.total||0); });
    });
    const todayTotal = todayHourly.reduce((a,b)=>a+b,0);
    const yesTotal = ch.total || 0;
    const hourMax = Math.max(...yesHourly, ...todayHourly, 1);

    const provinces = (ar.provinceMetric || []).map(p => ({
      code: p.province,
      name: LENOVO_PROVINCE_MAP[p.province] || p.province,
      metricSum: p.metricSum || 0,
    })).sort((a,b) => b.metricSum - a.metricSum);
    const provinceTotal = provinces.reduce((a,p) => a + p.metricSum, 0) || 1;
    const cities = (ar.cityMetric || []).map(c => ({ city: c.city, metricSum: c.metricSum || 0 })).sort((a,b) => b.metricSum - a.metricSum);

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:16px">
        <div class="card"><div style="font-size:13px;color:var(--text-tertiary)">昨日付款金额</div><div style="font-size:28px;font-weight:700;color:var(--red)">${(yesTotal/10000).toFixed(1)}<span style="font-size:14px;color:var(--text-tertiary);font-weight:normal"> 万元</span></div><div style="font-size:12px;color:var(--text-tertiary)">昨日数据</div></div>
        <div class="card"><div style="font-size:13px;color:var(--text-tertiary)">今日至今</div><div style="font-size:28px;font-weight:700;color:#1890ff">${(todayTotal/10000).toFixed(1)}<span style="font-size:14px;color:var(--text-tertiary);font-weight:normal"> 万元</span></div><div style="font-size:12px;color:var(--text-tertiary)">占昨日 ${yesTotal?((todayTotal/yesTotal*100).toFixed(1)):'-'}%</div></div>
        <div class="card"><div style="font-size:13px;color:var(--text-tertiary)">覆盖省份</div><div style="font-size:28px;font-weight:700;color:#722ed1">${provinces.length}</div><div style="font-size:12px;color:var(--text-tertiary)">最高: ${provinces[0]?provinces[0].name+' ¥'+(provinces[0].metricSum/10000).toFixed(1)+'万':'-'}</div></div>
        <div class="card"><div style="font-size:13px;color:var(--text-tertiary)">覆盖城市</div><div style="font-size:28px;font-weight:700;color:#13c2c2">${cities.length}</div><div style="font-size:12px;color:var(--text-tertiary)">最高: ${cities[0]?cities[0].city+' ¥'+(cities[0].metricSum/10000).toFixed(1)+'万':'-'}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card"><div class="card-header"><div class="card-title">昨日各渠道付款金额</div></div>
          ${channels.map(c => `
            <div style="margin-bottom:12px">
              <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
                <span style="font-weight:500">${c.channelName}</span>
                <span style="color:var(--red);font-weight:600">¥${(c.total/10000).toFixed(1)}万</span>
              </div>
              <div style="height:10px;background:#f0f0f0;border-radius:5px;overflow:hidden">
                <div style="width:${yesTotal?(c.total/yesTotal*100):0}%;height:100%;background:linear-gradient(90deg,#ff4d4f,#ff7a45)"></div>
              </div>
            </div>`).join('')}
        </div>
        <div class="card"><div class="card-header"><div class="card-title">省份付款金额 Top10</div></div>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="border-bottom:1px solid var(--border-light)"><th style="text-align:left;padding:8px">排名</th><th style="text-align:left;padding:8px">省份</th><th style="text-align:left;padding:8px">金额</th><th style="text-align:left;padding:8px">占比</th></tr></thead>
            <tbody>${provinces.slice(0,10).map((p,i)=>`
              <tr style="border-bottom:1px solid var(--border-light)">
                <td style="padding:8px;font-weight:600;color:#faad14">#${i+1}</td>
                <td style="padding:8px">${p.name}</td>
                <td style="padding:8px;font-weight:600;color:var(--red)">¥${(p.metricSum/10000).toFixed(1)}万</td>
                <td style="padding:8px">${(p.metricSum/provinceTotal*100).toFixed(1)}%</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><div class="card-title">城市付款金额 Top20</div></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">
          ${cities.slice(0,20).map((c,i)=>`
            <div style="border:1px solid var(--border-light);border-radius:6px;padding:10px;background:linear-gradient(135deg,#fff,#fafafa)">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:11px;color:var(--text-tertiary)">#${i+1}</span>
                <span style="font-size:12px;color:var(--red);font-weight:600">¥${(c.metricSum/10000).toFixed(1)}万</span>
              </div>
              <div style="font-weight:600;margin-top:4px">${c.city}</div>
            </div>`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">昨日 vs 今日 24 小时付款趋势</div></div>
        <div style="overflow-x:auto">
          <div style="display:flex;align-items:flex-end;gap:2px;min-width:720px;height:180px;border-bottom:1px solid var(--border-light);padding-bottom:4px">
            ${Array.from({length:24},(_,h)=>`
              <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;height:100%">
                <div style="display:flex;align-items:flex-end;gap:1px;height:150px;width:100%;justify-content:center">
                  <div style="height:${yesHourly[h]/hourMax*150}px;width:45%;background:#8c8c8c;min-height:1px" title="昨日 ${h}点: ¥${(yesHourly[h]/10000).toFixed(1)}万"></div>
                  <div style="height:${todayHourly[h]/hourMax*150}px;width:45%;background:#ff4d4f;min-height:1px" title="今日 ${h}点: ¥${(todayHourly[h]/10000).toFixed(1)}万"></div>
                </div>
                <div style="font-size:9px;color:var(--text-tertiary)">${h}</div>
              </div>`).join('')}
          </div>
          <div style="display:flex;justify-content:center;gap:20px;margin-top:12px;font-size:12px">
            <div><span style="display:inline-block;width:12px;height:12px;background:#8c8c8c;vertical-align:middle;margin-right:4px"></span>昨日 ¥${(yesTotal/10000).toFixed(1)}万</div>
            <div><span style="display:inline-block;width:12px;height:12px;background:#ff4d4f;vertical-align:middle;margin-right:4px"></span>今日 ¥${(todayTotal/10000).toFixed(1)}万</div>
          </div>
        </div>
      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><div>加载失败: ${e.message}</div><div style="font-size:12px;color:var(--text-tertiary);margin-top:8px">请稍后重试或联系管理员</div></div>`;
  }
}

async function loadLenovoTouch() {
  const el = document.getElementById('lenovo-touch-content');
  if (!el) return;
  el.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><div>加载中...</div></div>';

  let stats = { totalPlans: '-', activePlans: '-', statusDist: [], topCreators: [], recentPlans: [], sampleTotal: 0, tagGroups: '-', totalUsers: 0, profileTags: '-', events: [] };
  let cookieExpired = false;

  try {
    const resp = await fetch('/aiadmin/proxy/new/smart/touch/transformer/list', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageNum: 1, pageSize: 500 })
    });
    const data = await resp.json();
    if (data.status === 701 || (data.msg && data.msg.includes('登录'))) cookieExpired = true;
    if (data.success && data.res) {
      const plans = data.res.data || [];
      stats.totalPlans = data.res.total || plans.length;
      stats.sampleTotal = plans.length;

      const statusMap = {}, creatorMap = {};
      plans.forEach(p => {
        const s = p.enableStatusName || '未知';
        statusMap[s] = (statusMap[s] || 0) + 1;
        const c = p.creator || '未知';
        creatorMap[c] = (creatorMap[c] || 0) + 1;
      });
      const statusColors = { '启用':'#52c41a','启用中':'#52c41a','停用':'#ff4d4f','编辑中':'#faad14','待审核':'#1890ff','审核通过':'#13c2c2','审核驳回':'#eb2f96' };
      stats.statusDist = Object.entries(statusMap).sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count,color:statusColors[name]||'#999'}));
      stats.topCreators = Object.entries(creatorMap).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([name,count])=>({name,count}));
      stats.activePlans = (statusMap['启用']||0) + (statusMap['启用中']||0);
      stats.recentPlans = plans.slice(0,20);
    }
  } catch(e) {}

  try {
    const r = await fetch('/aiadmin/proxy/new/smart/touch/user/tag/group/all');
    const d = await r.json();
    if (d.success && d.res) {
      stats.tagGroups = d.res.length;
      let totalUsers = 0;
      d.res.forEach(g => { const m = (g.label||'').match(/\((\d+)\)/); if (m) totalUsers += parseInt(m[1]); });
      stats.totalUsers = totalUsers;
    }
  } catch(e) {}

  try {
    const r = await fetch('/aiadmin/proxy/new/smart/touch/user/tag/profile/all');
    const d = await r.json();
    if (d.success && d.res) stats.profileTags = d.res.length;
  } catch(e) {}

  try {
    const r = await fetch('/aiadmin/proxy/new/smart/touch/material/event/list');
    const d = await r.json();
    if (d.success && d.res) stats.events = d.res;
  } catch(e) {}

  if (cookieExpired) {
    el.innerHTML = `<div class="empty-state"><div class="icon">🔒</div><div style="font-size:15px;font-weight:600;margin:8px 0">会话已过期</div><div style="font-size:13px;color:var(--text-tertiary);max-width:500px;margin:0 auto;line-height:1.8">数据源登录状态已失效，请联系管理员刷新凭证后重试。</div></div>`;
    return;
  }

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:16px">
      <div class="card"><div style="font-size:13px;color:var(--text-tertiary)">触达计划总数</div><div style="font-size:28px;font-weight:700">${stats.totalPlans}</div><div style="font-size:12px;color:var(--text-tertiary)">全量计划</div></div>
      <div class="card"><div style="font-size:13px;color:var(--text-tertiary)">启用中</div><div style="font-size:28px;font-weight:700;color:#52c41a">${stats.activePlans}</div><div style="font-size:12px;color:var(--text-tertiary)">含"启用"+"启用中"</div></div>
      <div class="card"><div style="font-size:13px;color:var(--text-tertiary)">用户标签群组</div><div style="font-size:28px;font-weight:700;color:var(--red)">${stats.tagGroups}</div><div style="font-size:12px;color:var(--text-tertiary)">覆盖 ${stats.totalUsers.toLocaleString()} 人</div></div>
      <div class="card"><div style="font-size:13px;color:var(--text-tertiary)">画像标签 / 事件</div><div style="font-size:28px;font-weight:700">${stats.profileTags} / ${stats.events.length}</div><div style="font-size:12px;color:var(--text-tertiary)">tag / event</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div class="card"><div class="card-header"><div class="card-title">触达计划状态分布</div></div>
        ${stats.statusDist.map(s => `
          <div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>${s.name}</span><span style="color:var(--text-tertiary)">${s.count}</span></div>
            <div style="height:8px;background:#f0f0f0;border-radius:4px;overflow:hidden"><div style="width:${stats.sampleTotal?(s.count/stats.sampleTotal*100):0}%;height:100%;background:${s.color}"></div></div>
          </div>`).join('')}
      </div>
      <div class="card"><div class="card-header"><div class="card-title">Top10 创建人</div></div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="border-bottom:1px solid var(--border-light)"><th style="text-align:left;padding:8px">员工账号</th><th style="text-align:left;padding:8px">计划数</th><th style="text-align:left;padding:8px">占比</th></tr></thead>
          <tbody>${stats.topCreators.map(c=>`
            <tr style="border-bottom:1px solid var(--border-light)">
              <td style="padding:8px;font-family:monospace">${c.name}</td>
              <td style="padding:8px;font-weight:600;color:var(--red)">${c.count}</td>
              <td style="padding:8px">${stats.sampleTotal?(c.count/stats.sampleTotal*100).toFixed(1):'-'}%</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><div class="card-title">最近触达计划</div></div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:1px solid var(--border-light)"><th style="text-align:left;padding:8px">计划名称</th><th style="text-align:left;padding:8px">类型</th><th style="text-align:left;padding:8px">状态</th><th style="text-align:left;padding:8px">时间范围</th><th style="text-align:left;padding:8px">创建人</th></tr></thead>
        <tbody>${stats.recentPlans.map(p=>{
          const isActive = p.enableStatusName==='启用' || p.enableStatusName==='启用中';
          const isPaused = p.enableStatusName==='停用';
          const bg = isActive?'#f6ffed':isPaused?'#fff1f0':'#f0f0f0';
          const fg = isActive?'#52c41a':isPaused?'#ff4d4f':'#666';
          return `<tr style="border-bottom:1px solid var(--border-light)">
            <td style="padding:8px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${p.planName||''}">${p.planName||'未命名'}</td>
            <td style="padding:8px">${p.taskTypeName||'-'}</td>
            <td style="padding:8px"><span style="padding:2px 8px;border-radius:4px;font-size:12px;background:${bg};color:${fg}">${p.enableStatusName||'-'}</span></td>
            <td style="padding:8px;white-space:nowrap;font-size:12px">${(p.startTime||'').slice(0,10)} ~ ${(p.endTime||'').slice(0,10)}</td>
            <td style="padding:8px;font-family:monospace">${p.creator||''}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
    ${stats.events.length?`<div class="card">
      <div class="card-header"><div class="card-title">事件埋点定义</div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px">
        ${stats.events.map(ev=>`
          <div style="border:1px solid var(--border-light);border-radius:6px;padding:10px">
            <div style="font-weight:600">${ev.eventName||''}</div>
            <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">eventId: ${ev.eventId||''}</div>
            ${ev.description?`<div style="font-size:12px;color:var(--text-secondary);margin-top:4px">${ev.description}</div>`:''}
          </div>`).join('')}
      </div>
    </div>`:''}`;
}

// Hook switchPage for new pages
const _origSwitchLenovo = switchPage;
switchPage = function(pageId) {
  _origSwitchLenovo(pageId);
  // 企业认证页面初始化
  if (pageId === 'certify.overview') { setTimeout(loadCertOverview, 0); }
  if (pageId === 'certify.users') { setTimeout(loadCertUsers, 50); }
  if (pageId === 'certify.history') { setTimeout(loadCertHistory, 50); }
};
