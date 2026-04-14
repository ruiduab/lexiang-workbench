#!/bin/bash
# 健康检查脚本，供 pm2/cron 调用
response=$(curl -sf http://localhost:3001/health 2>/dev/null)
if [ $? -eq 0 ]; then
  echo "✅ 服务正常: $response"
  exit 0
else
  echo "❌ 服务异常，尝试重启..."
  pm2 restart lexiang
  exit 1
fi
