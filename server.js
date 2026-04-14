require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const { rateLimit } = require('express-rate-limit');
const versionInfo = require('./core/version');

// Init DB first
require('./db/schema');

// Load skill registry
const registry = require('./core/skill-registry');
registry.load();

const app = express();
const PORT = 3001;

app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => { req.rawBody = buf; }  // GitHub webhook HMAC 校验需要原始 body
}));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(session({
  secret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

// Rate limiting：每个 IP 每分钟最多 30 次对话请求
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' }
});

// Admin login rate limiting：每个 IP 每15分钟最多 10 次登录尝试（防暴力破解）
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '登录尝试过于频繁，请15分钟后再试' }
});
// Admin API 通用限流：每个 IP 每分钟 200 次（正常使用不会触发）
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '管理接口请求过于频繁，请稍后再试' }
});

// UID 中间件：匿名用户用 lexiang-uid，登录用户用 lx-token 解析出 user_id
const UID_MAX_AGE = 365 * 24 * 60 * 60 * 1000; // 1年
const db = require('./db/schema');
app.use((req, res, next) => {
  // 优先判断登录态
  const token = req.cookies?.['lx-token'];
  if (token) {
    const session = db.prepare(
      `SELECT user_id FROM user_sessions WHERE id = ? AND expires_at > datetime('now')`
    ).get(token);
    if (session) {
      req.lexiangUid = `uid-${session.user_id}`;
      req.userId = session.user_id;
      return next();
    }
    // token 无效，清除
    res.clearCookie('lx-token');
  }

  // 匿名用户
  const fromHeader = req.headers['x-session-id'];
  const fromCookie = req.cookies?.['lexiang-uid'];
  let uid = fromHeader || fromCookie;
  if (!uid || uid === 'anon') {
    uid = 'u-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }
  res.cookie('lexiang-uid', uid, { maxAge: UID_MAX_AGE, httpOnly: false, path: '/', sameSite: 'lax' });
  req.lexiangUid = uid;
  req.userId = null;
  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Health check routes（无需鉴权）
const healthRouter = require('./routes/health');
app.use('/health', healthRouter);

// Prometheus metrics（无需鉴权）
app.get('/metrics', (req, res) => {
  // 复用 health router 的 metrics-export
  req.url = '/metrics-export';
  healthRouter(req, res, () => {
    res.status(404).send('Not found');
  });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/chat', chatLimiter, require('./routes/chat'));
app.use('/api/knowledge', require('./routes/knowledge'));
app.post('/api/admin/login', adminLoginLimiter); // 登录接口严格限流
app.use('/api/admin', adminLimiter, require('./routes/admin'));
app.use('/api/harness', adminLimiter, require('./routes/harness'));
app.use('/api/uploader', require('./routes/uploader'));
app.use('/api/log', require('./routes/log'));
app.use('/api/stores', require('./routes/stores'));
app.use('/api/leai', require('./routes/leai'));
app.use('/api/lenovo', require('./routes/lenovo-proxy'));
app.use('/api/webhook', require('./routes/webhook'));
app.use('/api/workbench', require('./routes/workbench'));

// SPA fallback
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin/index.html'));
});
app.get('/admin/*path', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin/index.html'));
});
// Share page
app.get('/share/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/share.html'));
});
app.get('/*path', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// 记录活跃请求数量，用于优雅关闭
let activeRequests = 0;
app.use((req, res, next) => {
  activeRequests++;
  res.on('finish', () => { activeRequests--; });
  res.on('close', () => { activeRequests--; });
  next();
});

const server = app.listen(PORT, () => {
  console.log(`\n🚀 LeAI Agent Platform running on http://localhost:${PORT}`);
  console.log(`📚 Admin panel: http://localhost:${PORT}/admin`);
  console.log(`🔑 Default admin: admin / admin123`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`📊 Metrics: http://localhost:${PORT}/metrics`);
  console.log(`📦 Version: ${versionInfo.version} (${versionInfo.commitHash})\n`);

  // L3.4 监控采集：启动时立即采集一次，之后每小时一次
  const { collectMetrics } = require('./core/monitor');
  collectMetrics().catch(e => console.error('[Monitor] 初始采集失败:', e.message));
  setInterval(() => {
    collectMetrics().catch(e => console.error('[Monitor] 定时采集失败:', e.message));
  }, 60 * 60 * 1000);
});

// 优雅关闭
function gracefulShutdown(signal) {
  console.log(`\n[Shutdown] 收到 ${signal} 信号，开始优雅关闭...`);

  // 停止接收新连接
  server.close(() => {
    console.log('[Shutdown] HTTP server 已关闭');
  });

  const deadline = 10000; // 最多等10秒
  const start = Date.now();

  function checkAndExit() {
    if (activeRequests <= 0 || Date.now() - start >= deadline) {
      if (activeRequests > 0) {
        console.log(`[Shutdown] 超时（${deadline}ms），强制退出（仍有 ${activeRequests} 个活跃请求）`);
      } else {
        console.log('[Shutdown] 所有请求已完成，关闭 DB 连接...');
      }
      try {
        const db = require('./db/schema');
        if (db && typeof db.close === 'function') db.close();
        console.log('[Shutdown] DB 已关闭');
      } catch (e) {
        console.error('[Shutdown] 关闭 DB 出错:', e.message);
      }
      console.log('[Shutdown] 进程退出');
      process.exit(0);
    } else {
      console.log(`[Shutdown] 等待 ${activeRequests} 个请求完成...`);
      setTimeout(checkAndExit, 500);
    }
  }

  setTimeout(checkAndExit, 100);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
