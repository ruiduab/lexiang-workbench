#!/bin/bash
# 数据库备份脚本
BACKUP_DIR="/root/lexiang-backups"
mkdir -p "$BACKUP_DIR"
DATE=$(date +%Y%m%d_%H%M%S)
cp /root/lexiang/lexiang.db "$BACKUP_DIR/lexiang_$DATE.db"
# 只保留最近7个备份
ls -t "$BACKUP_DIR"/*.db | tail -n +8 | xargs rm -f 2>/dev/null || true
echo "✅ 备份完成: lexiang_$DATE.db"
