#!/bin/bash
# 零停机部署脚本（被 GitHub webhook 调用）
set -e
LOGFILE=/tmp/lexiang-deploy.log
exec >> "$LOGFILE" 2>&1
echo ""
echo "===== $(date '+%F %T') deploy start ====="
cd /root/lexiang
git fetch origin main
git reset --hard origin/main
npm install --production --no-audit --no-fund || true
node --check server.js
pm2 reload lexiang --update-env
echo "===== $(date '+%F %T') deploy done ====="
