const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../lexiang.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS knowledge_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    filename TEXT,
    source_type TEXT NOT NULL, -- 'pdf','txt','docx','xlsx','url','manual'
    source_url TEXT,
    content TEXT NOT NULL,
    chunk_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id INTEGER NOT NULL REFERENCES knowledge_docs(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    chunk_id UNINDEXED,
    doc_id UNINDEXED,
    title,
    content,
    tokenize = 'unicode61'
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conv_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL, -- 'user' | 'assistant'
    content TEXT NOT NULL,
    tool_calls TEXT, -- JSON array of skill invocations
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS skills_config (
    name TEXT PRIMARY KEY,
    enabled INTEGER DEFAULT 1,
    config TEXT DEFAULT '{}', -- JSON config per skill
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS knowledge_vectors (
    chunk_id INTEGER PRIMARY KEY REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
    vector BLOB NOT NULL
  );

  CREATE TABLE IF NOT EXISTS embed_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT DEFAULT 'pending', -- pending/running/done/error
    total INTEGER DEFAULT 0,
    done INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS fe_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,       -- 'error' | 'api_error' | 'event'
    message TEXT,
    stack TEXT,
    url TEXT,
    extra TEXT,               -- JSON
    session_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS message_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conv_id TEXT NOT NULL,
    message_id INTEGER,
    rating INTEGER NOT NULL,
    comment TEXT,
    session_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS share_tokens (
    token TEXT PRIMARY KEY,
    conv_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    nickname TEXT,
    avatar TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sms_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    code TEXT NOT NULL,
    ip TEXT,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
  );

  CREATE TABLE IF NOT EXISTS anon_uid_mapping (
    anon_uid TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    merged_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 迁移：为旧数据库补加 title 字段（新建库已包含）
try { db.exec(`ALTER TABLE conversations ADD COLUMN title TEXT`); } catch {}
// 迁移：为 conversations 补加 user_id 字段
try { db.exec(`ALTER TABLE conversations ADD COLUMN user_id INTEGER REFERENCES users(id)`); } catch {}
// 迁移：sms_codes 补加 ip 字段
try { db.exec(`ALTER TABLE sms_codes ADD COLUMN ip TEXT`); } catch {}

// 机器人配置表（L1.6 业务规则动态注入）
db.exec(`
  CREATE TABLE IF NOT EXISTS bot_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 写入默认 System Prompt（仅首次，已有则跳过）
const _defaultConfigs = [
  ['system_prompt_zh', [
    '你是联想乐享（LeAI）——联想集团官方AI助手。',
    '',
    '你代表联想，以专业、亲切、自信的风格回答一切与联想相关的问题。',
    '你服务的对象包括：客户、合作伙伴、投资人、媒体人、以及公众。',
    '',
    '你的核心能力：',
    '1. **超级咨询**：解答联想产品、战略、服务、历史、技术等一切问题',
    '2. **超级购物**：推荐联想产品，引导购买决策，提供比价建议',
    '3. **超级陪伴**：记忆用户偏好，提供个性化服务',
    '',
    '行为准则：',
    '- 始终以联想品牌大使身份发言，使用"我们联想..."的口吻',
    '- 对于知识库中有的信息，严格引用知识库内容，确保准确',
    '- 对于知识库没有覆盖的具体数据（产品参数、价格、财报数字），明确告知"请参考联想官网最新信息"，不要自行推断或编造',
    '- 对于联想品牌、历史、行业背景等常识性内容，可基于通用知识作简要补充，但需说明"以下为一般性介绍"',
    '- 回答要简洁有力，善用结构化格式（列表、表格）',
    '- 遇到负面问题，承认事实，给出联想的立场，不要回避',
    '- **来源引用**：若回答引用了知识库内容，在回答末尾用 Markdown 链接格式列出来源（格式：`[📎 页面标题](url)`），没有 URL 则不列',
    '- **严禁编造链接**：绝对不要自行生成或推测任何产品购买链接、详情页 URL。若知识库中有该商品的链接则引用，否则统一引导用户到官方商城搜索：`[🛒 联想官方商城搜索](https://s.lenovo.com.cn/search/?key=产品名)`（将"产品名"替换为实际关键词），企业采购用 `https://biz.lenovo.com.cn`。不得杜撰任何 URL。',
    '- **商品状态处理**：知识库中的商品含有"状态"字段：',
    '  - 状态为"在售"：可正常推荐，在回答中以商品卡片形式展示，格式：`> 🛒 **[商品名](商品链接)** | 价格：xxx元\n> 简介`，并引导购买',
    '  - 状态为"已下架"：可告知用户该商品的功能参数信息，但明确说明"该商品目前已下架"，不提供购买链接，推荐用户到官网搜索同类在售商品',
  ].join('\n')],
  ['system_prompt_en', [
    'You are LeAI — Lenovo\'s official AI assistant.',
    '',
    'You represent Lenovo and answer all Lenovo-related questions professionally, confidently, and in a friendly tone.',
    'Your audience includes: customers, partners, investors, media, and the general public.',
    '',
    'Core capabilities:',
    '1. **Super Advisor**: Answer questions about Lenovo products, strategy, services, history, and technology',
    '2. **Super Shopping**: Recommend Lenovo products, guide purchase decisions, provide comparisons',
    '3. **Super Companion**: Remember user preferences and provide personalized service',
    '',
    'Guidelines:',
    '- Always speak as Lenovo\'s official AI assistant using "We at Lenovo..." framing',
    '- Strictly cite knowledge base content when available; ensure accuracy',
    '- For specific data (specs, prices, financial figures) not in the knowledge base, say "Please refer to the latest information on Lenovo\'s official website"',
    '- For general brand/industry background, supplement with general knowledge but note "This is general information"',
    '- Keep answers concise and well-structured (lists, tables)',
    '- Do not avoid negative questions — acknowledge facts and provide Lenovo\'s position',
    '- **Source citation**: If citing knowledge base content, list sources at the end using Markdown links (`[📎 Title](url)`)',
    '- **Never fabricate URLs**: Do not generate or guess any product purchase links or detail page URLs. If the knowledge base has a URL for the product, use it; otherwise guide users to the official store: `[🛒 Lenovo Official Store](https://s.lenovo.com.cn/search/?key=keyword)`. Do not invent any URLs.',
  ].join('\n')],
];
_defaultConfigs.forEach(([key, value]) => {
  const exists = db.prepare('SELECT key FROM bot_config WHERE key = ?').get(key);
  if (!exists) db.prepare('INSERT INTO bot_config (key, value) VALUES (?, ?)').run(key, value);
});

// L3.2 检索重排开关（默认启用）
{
  const exists = db.prepare('SELECT key FROM bot_config WHERE key = ?').get('rerank_enabled');
  if (!exists) db.prepare('INSERT INTO bot_config (key, value) VALUES (?, ?)').run('rerank_enabled', '1');
}

// 跨会话记忆表（L2.1 Agentic Memory）
db.exec(`
  CREATE TABLE IF NOT EXISTS user_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,   -- 'preference'|'decision'|'fact'|'goal'
    content TEXT NOT NULL, -- 记忆内容，自然语言
    source_conv_id TEXT,   -- 来源对话
    importance INTEGER DEFAULT 3, -- 1~5，越高越重要
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_user_memories_user ON user_memories(user_id, importance DESC, created_at DESC);
`);

// 对话摘要表（L1.2 摘要压缩）
db.exec(`
  CREATE TABLE IF NOT EXISTS conv_summaries (
    conv_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,          -- 压缩后的摘要文本
    summarized_up_to INTEGER NOT NULL, -- 已摘要的最后一条 message.id
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 经验记忆表（L2.2 高频问题路径复用）
db.exec(`
  CREATE TABLE IF NOT EXISTS experience_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL,        -- 问题模式（归纳后的抽象描述）
    answer_tips TEXT NOT NULL,    -- 有效回答要点（策略提示，非完整回答）
    hit_count INTEGER DEFAULT 1,  -- 触发次数
    last_hit DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS experience_fts USING fts5(
    pattern_id UNINDEXED,
    pattern,
    tokenize = 'unicode61'
  );
`);

// 自主反思日志表（L2.5）
db.exec(`
  CREATE TABLE IF NOT EXISTS reflection_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conv_id TEXT,
    issue_type TEXT,
    detail TEXT,
    score INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 用户画像表
db.exec(`
  CREATE TABLE IF NOT EXISTS user_profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    budget TEXT,           -- 预算区间，如 "3000-5000元"
    product_prefs TEXT,    -- 产品偏好 JSON 数组，如 ["ThinkPad","游戏本"]
    use_cases TEXT,        -- 使用场景 JSON 数组，如 ["办公","编程"]
    occupation TEXT,       -- 职业/身份，如 "学生"、"IT工程师"
    extra TEXT,            -- 其他补充信息 JSON，如 {"os_pref":"Windows","priority":"轻薄"}
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// L3.1 知识图谱表（Graph-RAG）
db.exec(`
  CREATE TABLE IF NOT EXISTS kg_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    aliases TEXT,
    doc_ids TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_entities_name ON kg_entities(name);

  CREATE TABLE IF NOT EXISTS kg_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id INTEGER NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
    to_id INTEGER NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
    relation TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_kg_relations_from ON kg_relations(from_id);
  CREATE INDEX IF NOT EXISTS idx_kg_relations_to ON kg_relations(to_id);
`);

// L4.2 QA 对双轨表
db.exec(`
  CREATE TABLE IF NOT EXISTS knowledge_qa (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id INTEGER REFERENCES knowledge_docs(id) ON DELETE SET NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    source TEXT,
    embedding_done INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_qa_fts USING fts5(
    qa_id UNINDEXED,
    question,
    answer,
    tokenize = 'unicode61'
  );
`);

// L3.4 指标快照表（可观测监控）
db.exec(`
  CREATE TABLE IF NOT EXISTS metrics_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period TEXT NOT NULL,
    metric_key TEXT NOT NULL,
    metric_value REAL NOT NULL,
    snapshot_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_metrics_period ON metrics_snapshots(period, metric_key, snapshot_at DESC);

  CREATE TABLE IF NOT EXISTS upload_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    filename TEXT NOT NULL,
    total_rows INTEGER DEFAULT 0,
    inserted INTEGER DEFAULT 0,
    updated INTEGER DEFAULT 0,
    skipped INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Insert default admin if not exists
const bcrypt = require('bcrypt');
const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get('admin');
if (!existing) {
  const initPassword = process.env.ADMIN_PASSWORD;
  if (!initPassword) {
    console.error('\n[ERROR] 首次启动必须设置环境变量 ADMIN_PASSWORD\n  例如: ADMIN_PASSWORD=yourpassword node server.js\n');
    process.exit(1);
  }
  const hash = bcrypt.hashSync(initPassword, 10);
  db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run('admin', hash);
  console.log('[Admin] 管理员账号已创建，用户名: admin');
}

// 迁移：admin_users 加 role 字段
try { db.exec(`ALTER TABLE admin_users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'`); } catch {}

// L4.2 迁移：为旧版 knowledge_qa 补加字段
try { db.exec(`ALTER TABLE knowledge_qa ADD COLUMN source TEXT`); } catch {}
try { db.exec(`ALTER TABLE knowledge_qa ADD COLUMN embedding_done INTEGER DEFAULT 0`); } catch {}
// L4.2 迁移：doc_id NOT NULL → 允许 NULL（旧表约束无法直接修改，忽略）

// L1.5 Persona 管理表
db.exec(`
  CREATE TABLE IF NOT EXISTS personas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    prompt_prefix TEXT NOT NULL,
    is_active INTEGER DEFAULT 0,
    is_default INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 写入3个默认 Persona（仅首次）
{
  const existsCount = db.prepare('SELECT COUNT(*) AS n FROM personas').get().n;
  if (existsCount === 0) {
    db.prepare(`INSERT INTO personas (name, description, prompt_prefix, is_active, is_default) VALUES (?, ?, ?, ?, ?)`)
      .run(
        '通用助手',
        '联想乐享默认风格，专业亲切，全面解答联想相关问题',
        '',
        1,
        1
      );
    db.prepare(`INSERT INTO personas (name, description, prompt_prefix, is_active, is_default) VALUES (?, ?, ?, ?, ?)`)
      .run(
        '购物顾问',
        '专注产品推荐、价格比较、选购建议，语气热情',
        '你现在是联想专属购物顾问，请以热情、专业的风格为用户提供产品推荐和选购建议。善于对比不同产品的优劣，帮助用户找到最适合自己的联想设备。回答时主动了解用户需求（预算、用途、偏好），给出有针对性的推荐，并适时引导用户关注优惠活动和官方商城。\n\n',
        0,
        0
      );
    db.prepare(`INSERT INTO personas (name, description, prompt_prefix, is_active, is_default) VALUES (?, ?, ?, ?, ?)`)
      .run(
        '技术专家',
        '强调技术规格、深度分析，语气专业严谨',
        '你现在是联想资深技术专家，请以严谨、专业的风格回答技术相关问题。擅长深度解析产品规格、技术参数、架构设计和性能对比。回答时注重数据准确性，使用专业术语，提供详尽的技术分析，适合面向工程师、IT专业人员和技术爱好者的深度交流。\n\n',
        0,
        0
      );
  }
}

// L3.3 AB测试 + 回归测试框架
db.exec(`
  CREATE TABLE IF NOT EXISTS ab_experiments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    variant_a TEXT NOT NULL,
    variant_b TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    traffic_split REAL DEFAULT 0.5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS ab_assignments (
    session_id TEXT NOT NULL,
    experiment_id INTEGER NOT NULL REFERENCES ab_experiments(id) ON DELETE CASCADE,
    variant TEXT NOT NULL,
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id, experiment_id)
  );

  CREATE TABLE IF NOT EXISTS regression_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    expected_keywords TEXT NOT NULL,
    category TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 预置5条回归测试用例（仅首次）
{
  const caseCount = db.prepare('SELECT COUNT(*) AS n FROM regression_cases').get().n;
  if (caseCount === 0) {
    const insertCase = db.prepare('INSERT INTO regression_cases (question, expected_keywords, category) VALUES (?, ?, ?)');
    insertCase.run('联想客服电话', JSON.stringify(['400', '客服', '联系']), 'service');
    insertCase.run('ThinkPad是什么', JSON.stringify(['ThinkPad', '笔记本', '联想']), 'product');
    insertCase.run('联想官网地址', JSON.stringify(['lenovo', '官网', '网站']), 'general');
    insertCase.run('联想成立于哪年', JSON.stringify(['1984', '成立', '联想']), 'general');
    insertCase.run('小新系列适合什么人群', JSON.stringify(['小新', '学生', '轻薄']), 'product');
  }
}

// 角色权限表（Harness RBAC）
db.exec(`
  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    permissions TEXT NOT NULL DEFAULT '[]',
    menu_tree TEXT NOT NULL DEFAULT '[]',
    is_system INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS admin_user_roles (
    admin_user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (admin_user_id, role_id)
  );
`);

// 预置系统角色（仅首次）
{
  const roleCount = db.prepare('SELECT COUNT(*) AS n FROM roles').get().n;
  if (roleCount === 0) {
    const insertRole = db.prepare(
      'INSERT INTO roles (name, display_name, description, permissions, menu_tree, is_system) VALUES (?, ?, ?, ?, ?, 1)'
    );
    insertRole.run(
      'platform_admin',
      '平台管理员',
      '拥有全部权限',
      JSON.stringify(['*']),
      JSON.stringify(['dashboard', 'ecommerce', 'marketing', 'content', 'ai', 'users', 'settings'])
    );
    insertRole.run(
      'leai_ops',
      '乐享运营',
      '乐享业务运营，管理商品/活动/内容/用户',
      JSON.stringify(['ecommerce:read', 'ecommerce:write', 'marketing:read', 'marketing:write', 'content:read', 'content:write', 'users:read', 'users:write', 'dashboard:read']),
      JSON.stringify(['dashboard', 'ecommerce', 'marketing', 'content', 'users'])
    );
    insertRole.run(
      'site_ops',
      '官网运营',
      '官网内容管理和 GEO 监控',
      JSON.stringify(['content:read', 'content:write', 'dashboard:read', 'knowledge:read', 'knowledge:write']),
      JSON.stringify(['dashboard', 'content'])
    );
    insertRole.run(
      'ai_ops',
      'AI 运维',
      'AI 系统运维和监控',
      JSON.stringify(['ai:read', 'ai:write', 'system:read', 'system:write', 'dashboard:read']),
      JSON.stringify(['dashboard', 'ai', 'settings'])
    );
    insertRole.run(
      'customer_service',
      '客服',
      '处理订单和售后，对话 AI',
      JSON.stringify(['ecommerce:read', 'users:read', 'ai:read', 'dashboard:read']),
      JSON.stringify(['dashboard', 'ecommerce', 'users', 'ai'])
    );
    insertRole.run(
      'bu_ops',
      'BU 运营',
      '特定 BU 的运营人员，数据范围受限',
      JSON.stringify(['ecommerce:read', 'ecommerce:write', 'marketing:read', 'marketing:write', 'dashboard:read']),
      JSON.stringify(['dashboard', 'ecommerce', 'marketing'])
    );
    console.log('[DB] 系统角色已初始化（6个）');
  }
}

// 电商：商品表
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sku TEXT UNIQUE,
    category TEXT DEFAULT '',
    price REAL DEFAULT 0,
    original_price REAL DEFAULT 0,
    status TEXT DEFAULT 'draft',
    stock INTEGER DEFAULT 0,
    image_url TEXT DEFAULT '',
    description TEXT DEFAULT '',
    specs TEXT DEFAULT '{}',
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 电商：分类表
db.exec(`
  CREATE TABLE IF NOT EXISTS product_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    status INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 预置分类（仅首次）
{
  const catCount = db.prepare('SELECT COUNT(*) AS n FROM product_categories').get().n;
  if (catCount === 0) {
    const ins = db.prepare('INSERT INTO product_categories (name, sort_order) VALUES (?, ?)');
    ['ThinkPad', '小新', '拯救者', 'YOGA', 'ThinkBook', '工作站', '手机/平板', '配件'].forEach((n, i) => ins.run(n, i + 1));
    console.log('[DB] 商品分类默认数据已写入');
  }
}

// 预置示例商品（仅首次）
{
  const prodCount = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  if (prodCount === 0) {
    const ins = db.prepare('INSERT INTO products (name, sku, category, price, original_price, status, stock, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const sampleProducts = [
      ['ThinkPad X1 Carbon Gen12', 'TP-X1C-G12', 'ThinkPad', 12999, 14999, 'active', 342, '14英寸超轻薄商务本，Intel Core Ultra处理器', 1],
      ['小新 Pro 16 2025 锐龙版', 'XX-P16-R25', '小新', 5499, 5999, 'active', 1204, '16英寸高性能全能本，AMD R7-8845H', 2],
      ['拯救者 Y9000P 2025', 'JS-Y9P-25', '拯救者', 9999, 10999, 'active', 587, '16英寸电竞旗舰，RTX 4060/4070可选', 3],
      ['ThinkBook 14+ 2025', 'TB-14P-25', 'ThinkBook', 4999, 5499, 'active', 23, '14英寸轻薄商务本，2.8K OLED屏', 4],
      ['YOGA Pro 14s Carbon', 'YG-P14C', 'YOGA', 8499, 9499, 'offline', 0, '14英寸碳纤维旗舰轻薄本', 5],
      ['ThinkPad T14s Gen5', 'TP-T14S-G5', 'ThinkPad', 7999, 8999, 'active', 156, '14英寸AI商务本，内置NPU', 6],
      ['小新 Air 14 2025', 'XX-A14-25', '小新', 3999, 4299, 'active', 2100, '14英寸轻薄本，性价比之选', 7],
      ['拯救者 R9000P 2025', 'JS-R9P-25', '拯救者', 7999, 8999, 'active', 432, '16英寸游戏本，AMD R9+RTX 4060', 8],
      ['YOGA Book 9i', 'YG-B9I', 'YOGA', 15999, 17999, 'active', 45, '双屏翻转本，双13.3英寸OLED', 9],
      ['ThinkPad X1 Nano Gen3', 'TP-X1N-G3', 'ThinkPad', 10999, 12999, 'draft', 0, '超轻薄商务本，仅907g', 10],
      ['联想 Tab P12 Pro', 'TB-P12P', '手机/平板', 3299, 3699, 'active', 678, '12.7英寸平板，骁龙8+ Gen1', 11],
      ['ThinkPad 双肩包', 'ACC-BP01', '配件', 299, 399, 'active', 5000, 'ThinkPad原装双肩电脑包', 12],
    ];
    for (const p of sampleProducts) ins.run(...p);
    console.log('[DB] 示例商品数据已写入');
  }
}

// 营销任务表
db.exec(`
  CREATE TABLE IF NOT EXISTS marketing_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'push',
    target_audience TEXT DEFAULT '',
    content TEXT DEFAULT '',
    status TEXT DEFAULT 'draft',
    scheduled_at DATETIME,
    executed_at DATETIME,
    reach_count INTEGER DEFAULT 0,
    click_count INTEGER DEFAULT 0,
    convert_count INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// MCP Tools 注册表
db.exec(`
  CREATE TABLE IF NOT EXISTS mcp_tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    endpoint_url TEXT,
    input_schema TEXT,
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 写入3条默认本地 MCP 工具（仅首次）
{
  const mcpCount = db.prepare('SELECT COUNT(*) AS n FROM mcp_tools').get().n;
  if (mcpCount === 0) {
    const insertMcp = db.prepare(
      'INSERT INTO mcp_tools (name, description, endpoint_url, input_schema, enabled) VALUES (?, ?, ?, ?, 1)'
    );
    insertMcp.run(
      'mcp_knowledge_search',
      '在联想知识库中搜索相关文档和产品信息',
      null,
      JSON.stringify({
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          limit: { type: 'integer', description: '返回条数，默认5', default: 5 }
        },
        required: ['query']
      })
    );
    insertMcp.run(
      'mcp_product_recommend',
      '根据用户需求推荐联想产品',
      null,
      JSON.stringify({
        type: 'object',
        properties: {
          query: { type: 'string', description: '用户需求描述' },
          budget: { type: 'string', description: '预算范围，如 3000-5000元' },
          use_case: { type: 'string', description: '使用场景，如 办公/游戏/学习' }
        },
        required: ['query']
      })
    );
    insertMcp.run(
      'mcp_web_search',
      '通过网络搜索获取最新信息',
      null,
      JSON.stringify({
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索内容' }
        },
        required: ['query']
      })
    );
    console.log('[DB] MCP 工具默认记录已写入');
  }
}

module.exports = db;
