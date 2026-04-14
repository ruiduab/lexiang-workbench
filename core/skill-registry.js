const fs = require('fs');
const path = require('path');
const db = require('../db/schema');
const mcpClient = require('./mcp_client');

/**
 * Harness Registry — AI 原生统一能力注册中心
 *
 * 所有 Skill 遵循统一接口：
 * - name: 命名空间.技能名（如 marketing.create_task）
 * - description: 技能描述
 * - parameters: JSON Schema
 * - permissions: 所需权限列表（如 ['marketing:write']）
 * - execute(params, context): 执行函数
 */
class HarnessRegistry {
  constructor() {
    this.skills = new Map();
  }

  // Auto-scan and load all skills from /skills/ directory
  load() {
    const skillsDir = path.join(__dirname, '../skills');
    const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.js'));

    for (const file of files) {
      try {
        const skill = require(path.join(skillsDir, file));
        this.register(skill);
        console.log(`[Harness] Loaded: ${skill.name}`);
      } catch (err) {
        console.error(`[Harness] Failed to load ${file}:`, err.message);
      }
    }

    console.log(`[Harness] Registry ready with ${this.skills.size} skills`);
  }

  register(skill) {
    if (!skill.name || !skill.execute) {
      throw new Error(`Skill must have name and execute()`);
    }

    // 标准化：补全默认字段
    if (!skill.namespace) {
      // 从 name 推断命名空间（如 product_recommend → product）
      const parts = skill.name.split('.');
      skill.namespace = parts.length > 1 ? parts[0] : _inferNamespace(skill.name);
    }
    if (!skill.permissions) {
      skill.permissions = [];
    }

    this.skills.set(skill.name, skill);

    // Persist to DB if not already there
    const existing = db.prepare('SELECT name FROM skills_config WHERE name = ?').get(skill.name);
    if (!existing) {
      db.prepare('INSERT INTO skills_config (name, enabled) VALUES (?, 1)').run(skill.name);
    }
  }

  // 获取指定角色可用的 skill 列表
  getToolsForRole(rolePermissions = [], { webSearch = false } = {}) {
    const tools = [];
    for (const [name, skill] of this.skills) {
      if (name === 'web_search' && !webSearch) continue;
      const config = db.prepare('SELECT enabled FROM skills_config WHERE name = ?').get(name);
      if (config && !config.enabled) continue;

      // 权限检查：skill 无权限要求 → 所有角色可用；有要求 → 检查匹配
      if (skill.permissions.length > 0 && rolePermissions.length > 0) {
        const hasPermission = skill.permissions.some(p => rolePermissions.includes(p) || rolePermissions.includes('*'));
        if (!hasPermission) continue;
      }

      tools.push({
        name: skill.name,
        description: skill.description,
        namespace: skill.namespace,
        permissions: skill.permissions,
        input_schema: skill.parameters || { type: 'object', properties: {} }
      });
    }

    // 合并已启用的 MCP 工具
    try {
      const mcpRows = db.prepare('SELECT * FROM mcp_tools WHERE enabled = 1').all();
      for (const row of mcpRows) {
        let schema;
        try { schema = JSON.parse(row.input_schema || '{}'); } catch { schema = { type: 'object', properties: {} }; }
        tools.push({
          name: row.name,
          description: row.description || '',
          namespace: 'mcp',
          permissions: [],
          input_schema: schema
        });
      }
    } catch (e) {
      console.error('[Harness] 合并 MCP 工具失败:', e.message);
    }

    return tools;
  }

  // 兼容旧接口
  getTools(opts = {}) {
    return this.getToolsForRole(['*'], opts);
  }

  // 统一调用入口（Harness invoke）
  async invoke(name, input, context = {}) {
    // MCP 工具走 mcp_client
    if (name.startsWith('mcp_')) {
      console.log(`[Harness] MCP Invoke: ${name}`, JSON.stringify(input).slice(0, 100));
      return await mcpClient.callMCPTool(name, input);
    }
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill not found: ${name}`);

    // 权限检查
    if (skill.permissions.length > 0 && context.permissions) {
      const hasPermission = skill.permissions.some(p =>
        context.permissions.includes(p) || context.permissions.includes('*')
      );
      if (!hasPermission) {
        throw new Error(`Permission denied: ${name} requires [${skill.permissions.join(', ')}]`);
      }
    }

    console.log(`[Harness] Invoke: ${name}`, JSON.stringify(input).slice(0, 100));
    return await skill.execute(input, context);
  }

  // 兼容旧接口
  async execute(name, input) {
    return this.invoke(name, input);
  }

  // 完整 skill 元数据列表（含 schema，供 UI 渲染表单）
  listAll() {
    const all = [];
    for (const [name, skill] of this.skills) {
      const config = db.prepare('SELECT enabled, config FROM skills_config WHERE name = ?').get(name);
      all.push({
        name,
        namespace: skill.namespace,
        description: skill.description,
        permissions: skill.permissions || [],
        parameters: skill.parameters || { type: 'object', properties: {} },
        enabled: config ? Boolean(config.enabled) : true,
        config: config ? JSON.parse(config.config || '{}') : {}
      });
    }
    return all;
  }

  // 兼容旧 list()
  list() {
    return this.listAll();
  }

  // 按命名空间分组返回
  listByNamespace() {
    const grouped = {};
    for (const skill of this.listAll()) {
      const ns = skill.namespace || 'general';
      if (!grouped[ns]) grouped[ns] = [];
      grouped[ns].push(skill);
    }
    return grouped;
  }

  // 获取单个 skill 的完整 schema（供 UI 自动生成表单）
  getSchema(name) {
    const skill = this.skills.get(name);
    if (!skill) return null;
    return {
      name: skill.name,
      namespace: skill.namespace,
      description: skill.description,
      permissions: skill.permissions || [],
      parameters: skill.parameters || { type: 'object', properties: {} }
    };
  }

  setEnabled(name, enabled) {
    db.prepare('UPDATE skills_config SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?')
      .run(enabled ? 1 : 0, name);
  }
}

// 从技能名推断命名空间
function _inferNamespace(name) {
  const map = {
    calculator: 'tools',
    code_runner: 'tools',
    contact_service: 'service',
    knowledge_search: 'knowledge',
    product_recommend: 'ecommerce',
    task_planner: 'tools',
    web_search: 'tools'
  };
  return map[name] || 'general';
}

module.exports = new HarnessRegistry();
