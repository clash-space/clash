#!/usr/bin/env python3
"""
应用 PostgreSQL 数据库迁移
"""

import sys

# PostgreSQL 连接字符串（从 .env 文件中读取）
POSTGRES_URL = "postgresql://neondb_owner:npg_m3AkdLlHMv9i@ep-restless-fog-a1orav9n-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"

# 迁移 SQL
MIGRATION_SQL = """
-- Add retry management fields for persistent retry mechanism
-- Migration: 0004_add_retry_fields (PostgreSQL)

-- Add retry tracking fields
ALTER TABLE aigc_tasks ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
ALTER TABLE aigc_tasks ADD COLUMN IF NOT EXISTS last_retry_at BIGINT;
ALTER TABLE aigc_tasks ADD COLUMN IF NOT EXISTS next_retry_at BIGINT;
ALTER TABLE aigc_tasks ADD COLUMN IF NOT EXISTS retry_strategy TEXT DEFAULT 'exponential';

-- Index for retry scheduler to efficiently find tasks needing retry
CREATE INDEX IF NOT EXISTS idx_aigc_tasks_retry ON aigc_tasks(status, next_retry_at)
WHERE status = 'failed' AND retry_count < max_retries;

-- Comments for documentation
COMMENT ON COLUMN aigc_tasks.retry_count IS 'Number of times this task has been retried';
COMMENT ON COLUMN aigc_tasks.last_retry_at IS 'Timestamp (ms) of last retry attempt';
COMMENT ON COLUMN aigc_tasks.next_retry_at IS 'Timestamp (ms) when task should be retried next';
COMMENT ON COLUMN aigc_tasks.retry_strategy IS 'Retry strategy: exponential (default), linear, or fixed';
"""

print("=" * 70)
print("  应用 PostgreSQL 数据库迁移")
print("=" * 70)
print()

# 尝试使用 psycopg (already installed in the project)
try:
    import psycopg
    print("✅ 使用 psycopg 连接 PostgreSQL...")

    # 连接数据库
    print(f"连接: {POSTGRES_URL.split('@')[1].split('/')[0]}...")

    with psycopg.connect(POSTGRES_URL) as conn:
        print("✅ 连接成功")

        with conn.cursor() as cur:
            print("\n执行迁移 SQL...")
            cur.execute(MIGRATION_SQL)
            conn.commit()
            print("✅ 迁移执行成功")

        # 验证字段
        with conn.cursor() as cur:
            cur.execute("""
                SELECT column_name, data_type, column_default
                FROM information_schema.columns
                WHERE table_name = 'aigc_tasks'
                  AND column_name IN ('retry_count', 'next_retry_at', 'last_retry_at', 'retry_strategy')
                ORDER BY column_name
            """)
            columns = cur.fetchall()

            print("\n" + "=" * 70)
            print("验证新字段:")
            print("=" * 70)
            for col_name, col_type, col_default in columns:
                print(f"  ✅ {col_name:20s} {col_type:15s} (default: {col_default})")

    print("\n" + "=" * 70)
    print("  ✅ 迁移应用成功！")
    print("=" * 70)
    print()
    print("现在可以访问任务看板:")
    print("  🌐 http://localhost:8888/dashboard")
    print()
    print("测试 API:")
    print("  curl http://localhost:8888/api/tasks/stats")
    print("  curl http://localhost:8888/api/tasks/dashboard")
    print()

    sys.exit(0)

except ImportError:
    print("❌ psycopg 未安装")
    print("\n请在项目虚拟环境中安装:")
    print("  cd apps/api")
    print("  pip install psycopg[binary]")
    sys.exit(1)

except Exception as e:
    print(f"\n❌ 迁移失败: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
