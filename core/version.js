/**
 * 版本管理模块
 * 提供 version, commitHash, startTime, getUptime()
 */
const path = require('path');
const { execSync } = require('child_process');

const pkg = require(path.join(__dirname, '../package.json'));
const version = pkg.version || '1.0.0';

let commitHash = 'unknown';
try {
  commitHash = execSync('git rev-parse --short HEAD', {
    cwd: path.join(__dirname, '..'),
    timeout: 3000,
    stdio: ['ignore', 'pipe', 'ignore']
  }).toString().trim();
} catch (_) {
  // git 不可用时忽略
}

const startTime = new Date();

function getUptime() {
  return Math.floor((Date.now() - startTime.getTime()) / 1000);
}

module.exports = { version, commitHash, startTime, getUptime };
