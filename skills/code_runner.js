'use strict';

// Skill: 代码沙箱执行器（安全 JS 计算）
const { runSandbox } = require('../core/sandbox');

module.exports = {
  name: 'code_runner',
  description: '在安全沙箱中执行简单的 JavaScript 计算代码，适用于数学计算、数据处理、分期付款计算等场景。不支持网络请求、文件操作、或复杂程序。',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: '要执行的 JavaScript 计算代码，可以用 console.log() 输出结果'
      },
      description: {
        type: 'string',
        description: '计算目的的简要说明，帮助理解结果'
      }
    },
    required: ['code']
  },
  execute: async ({ code, description }) => {
    if (!code || typeof code !== 'string') {
      return { success: false, output: '', error: '代码不能为空' };
    }

    const { output, error } = runSandbox(code, 2000);

    if (error) {
      return {
        success: false,
        output: output || '',
        error,
        description: description || ''
      };
    }

    return {
      success: true,
      output: output || '（代码执行完毕，无 console.log 输出）',
      error: null,
      description: description || ''
    };
  }
};
