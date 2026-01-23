#!/usr/bin/env python3
"""
应用任务看板数据库迁移到 PostgreSQL
"""

import sys
from pathlib import Path

# PostgreSQL 连接字符串
POSTGRES_URL = "postgresql://neondb_owner:npg_m3AkdLlHMv9i@ep-restless-fog-a1orav9n-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

# 迁移文件路径
MIGRATION_FILE = Path(__file__).parent / "apps" / "api" / "src" / "master_clash" / "migrations" / "postgres" / "0004_add_retry_fields.sql"

print("=" * 70)
print("  应用任务看板数据库迁移")
print("=" * 70)
print()
print(f"迁移文件: {MIGRATION_FILE}")
print(f"数据库: Neon PostgreSQL")
print()

# 读取迁移 SQL
if not MIGRATION_FILE.exists():
    print(f"❌ 错误: 迁移文件不存在: {MIGRATION_FILE}")
    sys.exit(1)

migration_sql = MIGRATION_FILE.read_text()
print("迁移内容:")
print("-" * 70)
print(migration_sql)
print("-" * 70)
print()

# 尝试导入 psycopg
try:
    import psycopg
    print("✅ 使用 psycopg 连接数据库...")
except ImportError:
    print("❌ 错误: psycopg 未安装")
    print("请安装: pip install psycopg[binary]")
    sys.exit(1)

# 连接数据库并应用迁移
try:
    print("正在连接数据库...")
    with psycopg.connect(POSTGRES_URL) as conn:
        print("✅ 数据库连接成功")

        with conn.cursor() as cur:
            print("正在执行迁移 SQL...")
            cur.execute(migration_sql)
            conn.commit()
            print("✅ 迁移执行成功")

        # 验证字段是否已添加
        with conn.cursor() as cur:
            cur.execute("""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = 'aigc_tasks'
                  AND column_name IN ('retry_count', 'next_retry_at', 'last_retry_at', 'retry_strategy')
                ORDER BY column_name
            """)
            columns = cur.fetchall()

            print()
            print("验证新字段:")
            print("-" * 70)
            if columns:
                for col_name, col_type in columns:
                    print(f"  ✅ {col_name}: {col_type}")
            else:
                print("  ⚠️ 未找到新字段（可能字段已存在）")
            print("-" * 70)

    print()
    print("=" * 70)
    print("  ✅ 迁移应用成功")
    print("=" * 70)
    print()
    print("现在可以:")
    print("1. 重启 FastAPI 服务（或等待自动重新加载）")
    print("2. 访问 http://localhost:8888/dashboard")
    print("3. 测试 API: curl http://localhost:8888/api/tasks/stats")
    print()

    sys.exit(0)

except Exception as e:
    print()
    print("❌ 迁移应用失败")
    print(f"错误: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
