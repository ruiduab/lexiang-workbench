// ===== DEMO MODE MOCK =====
// 所有 /api/* 和 /aiadmin/proxy/* 请求返回假数据，对外展示使用
// 真实数据仍在后端数据库，直接走后端可拿到
(function() {
  if (window.__DEMO_MOCK_INSTALLED__) return;
  window.__DEMO_MOCK_INSTALLED__ = true;

  const _origFetch = window.fetch.bind(window);
  const now = new Date();
  const daysAgo = n => { const d = new Date(now); d.setDate(d.getDate() - n); return d.toISOString().slice(0,10); };
  const trend7 = base => Array.from({length:7}, (_,i) => ({ day: daysAgo(6-i), n: base + Math.floor(Math.random()*50) }));

  const FAKE_NAMES = ['张三','李四','王五','赵六','钱七','孙八','周九','吴十','郑十一','王十二'];
  const FAKE_PRODUCTS = ['演示笔记本A1','演示台式机B2','演示一体机C3','演示显示器D4','演示键盘E5','演示鼠标F6','演示耳机G7','演示平板H8','演示路由器I9','演示摄像头J10'];
  const FAKE_CATS = ['演示分类甲','演示分类乙','演示分类丙'];

  function mock(rawUrl, method, body) {
    const u = rawUrl.split('?')[0];
    const q = rawUrl.includes('?') ? rawUrl.split('?')[1] : '';

    // ==== Auth / 菜单 ====
    if (u === '/api/admin/login') return { success: true, username: 'demo' };
    if (u === '/api/admin/logout') return { success: true };
    if (u === '/api/admin/me') return { admin: { username: 'demo', id: 1 }, username: 'demo' };
    // 返回 __NOT_OK__ 特殊标记，让 mock 走 500 status，触发前端 fallback 使用全量 MENU_TREE
    if (u === '/api/harness/menu') return { __NOT_OK__: true };
    if (u === '/api/harness/roles') return [];
    if (u === '/api/harness/skills/grouped') return {};
    if (u === '/api/harness/chat') return { reply: '演示模式：此处为模拟回复，未连接真实后端。', toolsUsed: [] };
    if (u === '/health') return { status: 'ok' };

    // ==== 概览 / 统计 ====
    if (u === '/api/admin/stats') return {
      overview: { totalConvs: 1234, todayConvs: 56, totalUserMsgs: 8900, satisfaction: 94 },
      knowledge: { docs: 500, vectors: 12000, qaPairs: 800, kgEntities: 300 },
      trend: trend7(80),
      badFeedback: [
        { question: '演示差评问题1', created_at: daysAgo(1) },
        { question: '演示差评问题2', created_at: daysAgo(2) },
        { question: '演示差评问题3', created_at: daysAgo(3) }
      ],
      docCount: 500
    };

    if (u === '/api/admin/query-analysis') return {
      totalQueries: 10000, todayQueries: 234, totalConvs: 3456, likes: 800, dislikes: 20,
      trend: trend7(300),
      topQueries: [
        { content: '演示热门问题一', freq: 150 },
        { content: '演示热门问题二', freq: 120 },
        { content: '演示热门问题三', freq: 90 },
        { content: '演示热门问题四', freq: 60 }
      ],
      badQueries: []
    };

    // ==== 知识库 ====
    if (u.startsWith('/api/knowledge/qa/list')) return {
      items: Array.from({length: 5}, (_,i) => ({
        id: i+1, question: '演示问题 #'+(i+1), answer: '演示答案 #'+(i+1), source: 'demo'
      })),
      total: 5
    };
    if (u === '/api/admin/kg-stats') return { entities: [], entityCount: 0, relationCount: 0 };
    if (u.startsWith('/api/knowledge/')) return {
      docs: Array.from({length: 8}, (_,i) => ({
        id: i+1, title: '演示文档 '+String.fromCharCode(65+i),
        source_type: 'demo', chunk_count: 5+i, created_at: daysAgo(i+1)
      })),
      total: 8
    };
    if (u === '/api/knowledge/upload') return { success: true, title: '演示上传文档', chunkCount: 10 };
    if (u === '/api/admin/manual-qa') return { success: true };

    // ==== 对话管理 ====
    if (u.match(/^\/api\/admin\/conversations\/\d+$/)) return {
      id: 1,
      messages: [
        { role: 'user', content: '这是演示用户消息', created_at: daysAgo(1) },
        { role: 'assistant', content: '这是演示助手回复', created_at: daysAgo(1) }
      ]
    };
    if (u === '/api/admin/conversations') return {
      conversations: Array.from({length: 12}, (_,i) => ({
        id: i+1,
        first_msg: '演示对话消息 #'+(i+1),
        session_id: 'demo-session-'+i,
        created_at: daysAgo(i)
      }))
    };

    // ==== 客户画像 / 员工 ====
    if (u === '/api/admin/staff/stats') return { total: 10, effective: 8, invalid: 2 };
    if (u.startsWith('/api/admin/staff')) return {
      staff: FAKE_NAMES.slice(0, 8).map((n, i) => ({
        name: n, userid: 'demo-u-'+i, phone: '13800000' + String(i).padStart(3, '0'),
        email: 'demo' + i + '@example.com', type: (i % 3) + 1,
        account_status: i < 6 ? 'EFFECTIVE' : 'INVALID',
        created_at: daysAgo(i * 3)
      })),
      total: 8, page: 1, pages: 1
    };
    if (u === '/api/admin/user-profiles') return {
      profileCount: 5, totalUsers: 10,
      profiles: [
        { user_id: 1, budget: '5000-10000', product_prefs: ['笔记本','外设'], use_cases: ['办公','学习'], occupation: '演示职业A', updated_at: daysAgo(1) },
        { user_id: 2, budget: '10000+', product_prefs: ['台式机'], use_cases: ['设计'], occupation: '演示职业B', updated_at: daysAgo(2) },
        { user_id: 3, budget: '3000-5000', product_prefs: ['平板'], use_cases: ['娱乐'], occupation: '演示职业C', updated_at: daysAgo(3) }
      ]
    };

    // ==== 账号 ====
    if (u === '/api/admin/users') return {
      users: [
        { id: 1, username: 'admin', created_at: daysAgo(30) },
        { id: 2, username: 'demo', created_at: daysAgo(5) }
      ]
    };

    // ==== Persona ====
    if (u === '/api/admin/personas') return [
      { id: 1, name: '演示角色甲', description: '演示系统提示词', is_active: true },
      { id: 2, name: '演示角色乙', description: '演示系统提示词', is_active: false }
    ];

    // ==== 监控 / 指标 ====
    if (u === '/api/admin/metrics') return {
      latest: {
        msg_count_1h: { metric_value: 42 },
        satisfaction_rate: { metric_value: 95 },
        knowledge_hit_rate: { metric_value: 0.87 }
      },
      alerts: []
    };
    if (u === '/api/admin/metrics/collect') return { success: true };

    // ==== 进化 / 反思 / 回归 ====
    if (u === '/api/admin/evolution-notes') return [];
    if (u === '/api/admin/reflections') return [];
    if (u.startsWith('/api/admin/reflections')) return [];
    if (u === '/api/admin/learning-status') return { status: 'idle', lastRun: daysAgo(1) };
    if (u === '/api/admin/run-evolution') return { message: '演示模式：进化任务已模拟触发' };
    if (u === '/api/admin/run-learning') return { message: '演示模式：学习任务已模拟触发' };
    if (u === '/api/admin/regression-cases') return [];

    // ==== 电商 ====
    if (u === '/api/admin/products/stats') return { active: 12, offline: 3, draft: 2, total: 17 };
    if (u === '/api/admin/product-categories') return FAKE_CATS.map((n,i) => ({
      id: i+1, name: n, sort_order: i+1, status: 1
    }));
    if (u === '/api/admin/products/category-counts') return { '演示分类甲': 10, '演示分类乙': 5, '演示分类丙': 2 };
    if (u.match(/^\/api\/admin\/products\/\d+$/)) return {
      id: 1, name: FAKE_PRODUCTS[0], sku: 'DEMO-SKU-1', category: '演示分类甲',
      price: 1999, original_price: 2499, stock: 50, status: 'active',
      description: '这是演示商品描述，非真实数据'
    };
    if (u === '/api/admin/products') return {
      products: FAKE_PRODUCTS.map((n, i) => ({
        id: i+1, name: n, sku: 'DEMO-SKU-'+(i+1),
        category: FAKE_CATS[i % FAKE_CATS.length],
        price: 1000 + i * 500, stock: 10 + i * 5, status: 'active'
      })),
      total: FAKE_PRODUCTS.length, page: 1, pages: 1
    };

    // ==== 营销 ====
    if (u === '/api/admin/marketing-tasks') return [
      { id: 1, name: '演示营销任务甲', type: 'push', target_audience: '演示人群', status: 'completed', reach_count: 1000, click_count: 200, convert_count: 50 },
      { id: 2, name: '演示营销任务乙', type: 'email', target_audience: '演示人群', status: 'scheduled', reach_count: 0, click_count: 0, convert_count: 0 },
      { id: 3, name: '演示营销任务丙', type: 'sms', target_audience: '演示人群', status: 'draft', reach_count: 0, click_count: 0, convert_count: 0 }
    ];

    // ==== AB 实验 ====
    if (u === '/api/admin/experiments') return [
      { id: 1, name: '演示实验A', description: '演示描述', variant_a: '对照组', variant_b: '实验组', traffic_split: 0.5, status: 'running' },
      { id: 2, name: '演示实验B', description: '演示描述', variant_a: '旧版', variant_b: '新版', traffic_split: 0.3, status: 'completed' }
    ];

    // ==== 联想大屏（付款金额） ====
    if (u === '/aiadmin/proxy/old/cdashboard/dashboard/channel') return {
      status: 200,
      channels: [
        { channel: 'demo-ch-1', total: 10000000, yesHourData: [], todayHourData: [] },
        { channel: 'demo-ch-2', total: 8000000, yesHourData: [], todayHourData: [] },
        { channel: 'demo-ch-3', total: 6000000, yesHourData: [], todayHourData: [] }
      ],
      total: 24000000
    };
    if (u === '/aiadmin/proxy/old/cdashboard/dashboard/area') return {
      status: 200,
      provinceMetric: [
        { province: 'demo-p-1', metricSum: 5000000 },
        { province: 'demo-p-2', metricSum: 4000000 },
        { province: 'demo-p-3', metricSum: 3000000 }
      ],
      cityMetric: [
        { city: '演示城市甲', metricSum: 3000000 },
        { city: '演示城市乙', metricSum: 2500000 },
        { city: '演示城市丙', metricSum: 2000000 }
      ]
    };

    // ==== 联想触达 ====
    if (u === '/aiadmin/proxy/new/smart/touch/transformer/list') return {
      success: true,
      res: {
        total: 20,
        data: Array.from({length: 10}, (_, i) => ({
          planName: '演示触达计划 #' + (i + 1),
          taskTypeName: '演示类型',
          enableStatusName: i < 6 ? '启用' : '停用',
          startTime: daysAgo(10),
          endTime: daysAgo(0),
          creator: 'demo-user-' + (i % 3)
        }))
      }
    };
    if (u === '/aiadmin/proxy/new/smart/touch/user/tag/group/all') return {
      success: true, res: [{ label: '演示群组甲(1000)' }, { label: '演示群组乙(500)' }, { label: '演示群组丙(200)' }]
    };
    if (u === '/aiadmin/proxy/new/smart/touch/user/tag/profile/all') return {
      success: true, res: [1, 2, 3, 4, 5]
    };
    if (u === '/aiadmin/proxy/new/smart/touch/material/event/list') return {
      success: true,
      res: [
        { eventName: '演示事件A', eventId: 'demo_event_a', description: '演示事件描述' },
        { eventName: '演示事件B', eventId: 'demo_event_b', description: '演示事件描述' }
      ]
    };

    // ==== 联想售后 / 订单 / 门店 ====
    if (u === '/api/lenovo/support/articles') return {
      data: Array.from({length: 10}, (_, i) => ({
        doc_code: 'demo-doc-' + i,
        title: '演示支持文章 #' + (i + 1),
        description: '演示描述',
        line_category_name: '演示分类',
        create_time: daysAgo(i)
      }))
    };
    if (u.startsWith('/api/lenovo/support/drivers')) return {
      data: [
        { name: '演示驱动A', version: '1.0.0', size: '10MB' },
        { name: '演示驱动B', version: '2.1.3', size: '25MB' }
      ]
    };
    if (u === '/api/lenovo/user/order/list') return {
      orders: [], note: '演示模式：订单数据需真实 Passport Cookie'
    };
    if (u.startsWith('/api/stores/geocode')) return { lat: 39.9, lng: 116.4, name: '演示地址' };
    if (u.startsWith('/api/stores/nearby')) return {
      stores: [
        { name: '演示门店甲', address: '演示街道1号', tel: '010-00000000', distance: '1.2km' },
        { name: '演示门店乙', address: '演示街道2号', tel: '010-00000000', distance: '2.5km' }
      ]
    };

    // ==== GEO / 点亮 AI ==== (不mock，放行到真实 nginx 代理 → api.dianliang.ai)

    // ==== 其他 admin 端点兜底 ====
    if (u === '/api/admin/backup') return { message: '演示模式：备份已模拟完成' };
    if (u === '/api/admin/restart') return { success: true };
    if (u === '/api/admin/bot-config') return {};
    if (u === '/api/admin/fe-logs') return [];

    // ==== 变更类请求统一返回成功 ====
    if (method && method !== 'GET') return { success: true, id: Date.now() };

    // 默认空
    return {};
  }

  function makeResp(data) {
    if (data && data.__NOT_OK__) {
      return new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  window.fetch = async function(url, options) {
    const method = (options && options.method) || 'GET';
    const urlStr = typeof url === 'string' ? url : (url && url.url) || '';
    // GEO 接口走真实 nginx 代理 → api.dianliang.ai，不 mock
    if (urlStr && urlStr.startsWith('/api/geo/')) {
      return _origFetch(url, options);
    }
    if (urlStr && (urlStr.startsWith('/api/') || urlStr.startsWith('/aiadmin/proxy/') || urlStr === '/health')) {
      try {
        return makeResp(mock(urlStr, method));
      } catch (e) {
        console.warn('[demo-mock]', e.message);
        return makeResp({});
      }
    }
    return _origFetch(url, options);
  };

  // 顶部演示模式横幅
  function addBanner() {
    if (document.getElementById('__demo_banner__')) return;
    const b = document.createElement('div');
    b.id = '__demo_banner__';
    b.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);background:#fff4cc;color:#8a6d3b;padding:4px 14px;border-radius:0 0 8px 8px;font-size:11px;z-index:99999;box-shadow:0 2px 8px rgba(0,0,0,.1);font-family:system-ui';
    b.textContent = '⚠ 演示模式 · 所有数据均为虚构';
    (document.body || document.documentElement).appendChild(b);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addBanner);
  } else {
    addBanner();
  }
})();
