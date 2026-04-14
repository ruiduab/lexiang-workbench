#!/bin/bash
# 零停机部署脚本
set -e
cd /root/lexiang
git pull origin master
npm install --production
node --check server.js  # 语法检查
pm2 reload lexiang --update-env
echo "✅ 部署完成"
