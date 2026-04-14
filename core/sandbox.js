'use strict';

const vm = require('vm');

// 拒绝的关键词列表（防止逃逸）
const BLOCKED_KEYWORDS = [
  'require', 'import', 'process', 'global', 'globalThis',
  'fetch', 'XMLHttpRequest', 'eval', 'Function', '__proto__',
  'constructor', 'prototype', '__defineGetter__', '__defineSetter__',
  '__lookupGetter__', '__lookupSetter__', 'Buffer', 'setInterval',
  'setTimeout', 'clearInterval', 'clearTimeout', 'setImmediate',
  'queueMicrotask', 'module', 'exports', '__dirname', '__filename',
  'Reflect', 'Proxy', 'Symbol', 'WeakRef', 'FinalizationRegistry'
];

/**
 * 检查表达式/代码是否包含危险关键词
 * @param {string} code
 * @returns {string|null} 被拒绝的关键词，null 表示安全
 */
function checkBlocked(code) {
  for (const kw of BLOCKED_KEYWORDS) {
    // 用 word boundary 检测（JS 里用正则）
    const re = new RegExp('(?<![\\w$])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w$])');
    if (re.test(code)) return kw;
  }
  return null;
}

/**
 * 安全的表达式求值
 * @param {string} expression 数学/逻辑表达式
 * @param {Object} variables 变量映射，如 {principal: 100000, rate: 0.005}
 * @returns {{ result: *, error: string|null }}
 */
function safeEval(expression, variables = {}) {
  if (!expression || typeof expression !== 'string') {
    return { result: null, error: '表达式不能为空' };
  }
  if (expression.length > 500) {
    return { result: null, error: '表达式过长（最多500字符）' };
  }

  const blocked = checkBlocked(expression);
  if (blocked) {
    return { result: null, error: `禁止使用关键词：${blocked}` };
  }

  try {
    // 构建沙箱上下文
    const sandbox = Object.create(null);
    // 只暴露 Math
    sandbox.Math = Math;
    // 注入变量
    for (const [k, v] of Object.entries(variables)) {
      if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k)) {
        sandbox[k] = v;
      }
    }

    const ctx = vm.createContext(sandbox);
    const result = vm.runInContext(expression, ctx, { timeout: 50 });
    return { result, error: null };
  } catch (e) {
    return { result: null, error: e.message };
  }
}

/**
 * 在安全沙箱中执行一段计算脚本（支持多行、变量赋值、console.log 输出）
 * @param {string} code JS 代码
 * @param {number} timeout 超时毫秒，默认 2000
 * @returns {{ output: string, error: string|null }}
 */
function runSandbox(code, timeout = 2000) {
  if (!code || typeof code !== 'string') {
    return { output: '', error: '代码不能为空' };
  }
  if (code.length > 5000) {
    return { output: '', error: '代码过长（最多5000字符）' };
  }

  const blocked = checkBlocked(code);
  if (blocked) {
    return { output: '', error: `禁止使用关键词：${blocked}` };
  }

  const outputLines = [];

  try {
    // 构建安全沙箱上下文
    const sandbox = Object.create(null);
    sandbox.Math = Math;
    sandbox.parseInt = parseInt;
    sandbox.parseFloat = parseFloat;
    sandbox.isNaN = isNaN;
    sandbox.isFinite = isFinite;
    sandbox.Number = Number;
    sandbox.String = String;
    sandbox.Boolean = Boolean;
    sandbox.Array = Array;
    sandbox.Object = Object;
    sandbox.JSON = JSON;
    sandbox.Infinity = Infinity;
    sandbox.NaN = NaN;
    sandbox.undefined = undefined;

    // 重定向 console.log 到输出捕获
    sandbox.console = {
      log: (...args) => {
        outputLines.push(args.map(a => {
          if (typeof a === 'object' && a !== null) {
            try { return JSON.stringify(a); } catch (_) { return String(a); }
          }
          return String(a);
        }).join(' '));
      },
      warn: (...args) => {
        outputLines.push('[warn] ' + args.map(a => String(a)).join(' '));
      },
      error: (...args) => {
        outputLines.push('[error] ' + args.map(a => String(a)).join(' '));
      }
    };

    const ctx = vm.createContext(sandbox);
    vm.runInContext(code, ctx, { timeout });

    let output = outputLines.join('\n');
    // 限制输出长度
    if (output.length > 2000) {
      output = output.slice(0, 2000) + '\n...(输出已截断)';
    }
    return { output, error: null };
  } catch (e) {
    let errMsg = e.message || String(e);
    if (e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      errMsg = '执行超时（超过 ' + timeout + 'ms）';
    }
    // 把已有输出也返回
    let output = outputLines.join('\n');
    if (output.length > 2000) output = output.slice(0, 2000) + '\n...(输出已截断)';
    return { output, error: errMsg };
  }
}

module.exports = { safeEval, runSandbox, checkBlocked };
