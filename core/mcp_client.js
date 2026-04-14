/**
 * MCP 风格工具调用客户端
 * - 支持本地工具（直接执行）和远程工具（HTTP POST）
 * - 懒加载：首次调用 callMCPTool / listMCPTools 时从 DB 初始化
 */

const http = require('http');
const https = require('https');

class MCPClient {
  constructor() {
    this._tools = new Map();  // name -> { meta, handler? }
    this._initialized = false;
  }

  // 注册本地工具（有 handler 函数）
  _registerLocal(name, meta, handler) {
    this._tools.set(name, { meta, handler, remote: false });
  }

  // 注册远程工具（HTTP POST）
  registerMCPTool(name, { url, description, inputSchema }) {
    this._tools.set(name, {
      meta: { name, description, endpoint_url: url, input_schema: inputSchema },
      handler: null,
      remote: true
    });
  }

  // 懒初始化：从 DB 加载已注册工具 + 内置本地工具
  _init() {
    if (this._initialized) return;
    this._initialized = true;

    // 注册3个内置本地工具（包装 skill）
    this._registerBuiltins();

    // 从 DB 加载远程工具
    try {
      const db = require('../db/schema');
      const rows = db.prepare('SELECT * FROM mcp_tools WHERE enabled = 1').all();
      for (const row of rows) {
        if (row.endpoint_url) {
          // 远程工具
          let schema;
          try { schema = JSON.parse(row.input_schema || '{}'); } catch { schema = {}; }
          this._tools.set(row.name, {
            meta: {
              name: row.name,
              description: row.description,
              endpoint_url: row.endpoint_url,
              input_schema: schema
            },
            handler: null,
            remote: true
          });
        }
        // 本地工具已由 _registerBuiltins 注册，DB 中 endpoint_url=NULL 的跳过（已存在）
      }
    } catch (e) {
      console.error('[MCP] DB 加载失败:', e.message);
    }
  }

  _registerBuiltins() {
    // mcp_knowledge_search
    this._registerLocal(
      'mcp_knowledge_search',
      {
        name: 'mcp_knowledge_search',
        description: '在联想知识库中搜索相关文档和产品信息',
        endpoint_url: null,
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            limit: { type: 'integer', description: '返回条数，默认5', default: 5 }
          },
          required: ['query']
        }
      },
      async (input) => {
        const registry = require('./skill-registry');
        return await registry.execute('knowledge_search', input);
      }
    );

    // mcp_product_recommend
    this._registerLocal(
      'mcp_product_recommend',
      {
        name: 'mcp_product_recommend',
        description: '根据用户需求推荐联想产品',
        endpoint_url: null,
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '用户需求描述' },
            budget: { type: 'string', description: '预算范围，如 3000-5000元' },
            use_case: { type: 'string', description: '使用场景，如 办公/游戏/学习' }
          },
          required: ['query']
        }
      },
      async (input) => {
        const registry = require('./skill-registry');
        return await registry.execute('product_recommend', input);
      }
    );

    // mcp_web_search
    this._registerLocal(
      'mcp_web_search',
      {
        name: 'mcp_web_search',
        description: '通过网络搜索获取最新信息',
        endpoint_url: null,
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索内容' }
          },
          required: ['query']
        }
      },
      async (input) => {
        const registry = require('./skill-registry');
        return await registry.execute('web_search', input);
      }
    );
  }

  // 调用工具
  async callMCPTool(name, input) {
    this._init();

    const tool = this._tools.get(name);
    if (!tool) {
      return { error: `MCP 工具不存在: ${name}` };
    }

    try {
      if (tool.remote) {
        return await this._callRemote(tool.meta.endpoint_url, input);
      } else {
        if (!tool.handler) return { error: `本地工具 ${name} 无执行函数` };
        return await tool.handler(input);
      }
    } catch (e) {
      console.error(`[MCP] 工具 ${name} 调用失败:`, e.message);
      return { error: e.message };
    }
  }

  // 发起远程 HTTP POST
  _callRemote(url, input) {
    return new Promise((resolve) => {
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch (e) {
        return resolve({ error: `无效的 URL: ${url}` });
      }

      const body = JSON.stringify(input);
      const isHttps = parsedUrl.protocol === 'https:';
      const lib = isHttps ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + (parsedUrl.search || ''),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      };

      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ result: data });
          }
        });
      });

      req.on('error', (e) => resolve({ error: e.message }));
      req.setTimeout(10000, () => {
        req.destroy();
        resolve({ error: 'MCP 工具调用超时（10s）' });
      });
      req.write(body);
      req.end();
    });
  }

  // 列出所有已注册工具（含元数据）
  listMCPTools() {
    this._init();
    const result = [];
    for (const [name, tool] of this._tools) {
      result.push({
        name,
        description: tool.meta.description,
        endpoint_url: tool.meta.endpoint_url || null,
        input_schema: tool.meta.input_schema,
        remote: tool.remote
      });
    }
    return result;
  }

  // 转换为 LLM tool_calls 格式
  toToolDefinitions() {
    this._init();
    const defs = [];
    for (const [name, tool] of this._tools) {
      defs.push({
        name,
        description: tool.meta.description,
        input_schema: tool.meta.input_schema || { type: 'object', properties: {} }
      });
    }
    return defs;
  }

  // 重新加载（DB 更新后调用）
  reload() {
    this._tools.clear();
    this._initialized = false;
  }
}

module.exports = new MCPClient();
