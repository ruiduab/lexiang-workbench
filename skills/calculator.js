// Skill: 计算器（处理价格计算、配置对比等数值问题）

module.exports = {
  name: 'calculator',
  description: '执行数学计算，适用于价格对比、折扣计算、配置性价比分析等场景。',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: '数学表达式，如 "5999 * 0.85" 或 "8000 / 12"'
      },
      context: {
        type: 'string',
        description: '计算的上下文说明，帮助格式化输出'
      }
    },
    required: ['expression']
  },
  execute: async ({ expression, context }) => {
    try {
      // Strict validation: only allow digits, operators, parentheses, dots, spaces
      const safe = expression.replace(/\s+/g, '');
      if (!/^[0-9+\-*/().%]+$/.test(safe)) {
        throw new Error('Expression contains invalid characters');
      }
      if (!safe) throw new Error('Invalid expression');
      // Reject empty parentheses or dangerous patterns
      if (/\(\)/.test(safe)) throw new Error('Empty parentheses');
      // Evaluate using Function with strict whitelist already enforced
      const result = Function(`'use strict'; return (${safe})`)();
      if (typeof result !== 'number' || !isFinite(result)) {
        throw new Error('Result is not a finite number');
      }
      return {
        expression: safe,
        result: Math.round(result * 100) / 100,
        context: context || ''
      };
    } catch (err) {
      return { error: '计算失败：' + err.message };
    }
  }
};
