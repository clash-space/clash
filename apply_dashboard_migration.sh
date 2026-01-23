#!/bin/bash
# 应用任务看板数据库迁移到 PostgreSQL

# PostgreSQL 连接字符串
POSTGRES_URL="postgresql://neondb_owner:npg_m3AkdLlHMv9i@ep-restless-fog-a1orav9n-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"

# 迁移文件路径
MIGRATION_FILE="/Users/xiaoyang/Proj/clash/apps/api/src/master_clash/migrations/postgres/0004_add_retry_fields.sql"

echo "========================================="
echo "应用任务看板数据库迁移"
echo "========================================="
echo ""
echo "迁移文件: $MIGRATION_FILE"
echo "数据库: Neon PostgreSQL"
echo ""

# 检查 psql 是否可用
if ! command -v psql &> /dev/null; then
    echo "❌ 错误: psql 命令未找到"
    echo "请安装 PostgreSQL 客户端："
    echo "  brew install postgresql"
    exit 1
fi

# 应用迁移
echo "正在应用迁移..."
psql "$POSTGRES_URL" -f "$MIGRATION_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo "========================================="
    echo "✅ 迁移应用成功"
    echo "========================================="
    echo ""
    echo "现在可以："
    echo "1. 重启 FastAPI 服务"
    echo "2. 访问 http://localhost:8888/dashboard"
    echo ""
else
    echo ""
    echo "❌ 迁移应用失败"
    echo "请检查错误信息"
    exit 1
fi
