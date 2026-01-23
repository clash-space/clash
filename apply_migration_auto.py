#!/usr/bin/env python3
"""
应用数据库迁移 - 使用项目内部连接
"""

import sys
from pathlib import Path

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent / "apps" / "api" / "src"))

print("=" * 70)
print("  应用任务看板数据库迁移")
print("=" * 70)
print()

try:
    from master_clash.database.connection import get_database
    from master_clash.config import get_settings

    settings = get_settings()

    # 检测数据库类型
    db = get_database()
    db_type = "sqlite"  # Default

    # 尝试检测是否是 PostgreSQL
    if hasattr(db, 'connection'):
        conn_str = str(type(db.connection).__module__)
        if 'psycopg' in conn_str or 'postgres' in conn_str:
            db_type = "postgres"

    print(f"检测到数据库类型: {db_type}")
    print()

    # 读取迁移文件
    migration_file = Path(__file__).parent / "apps" / "api" / "src" / "master_clash" / "migrations" / db_type / "0004_add_retry_fields.sql"

    if not migration_file.exists():
        print(f"❌ 迁移文件不存在: {migration_file}")
        sys.exit(1)

    migration_sql = migration_file.read_text()
    print("迁移文件:", migration_file.name)
    print("-" * 70)

    # 应用迁移
    try:
        # SQLite 需要逐条执行
        if db_type == "sqlite":
            statements = [s.strip() for s in migration_sql.split(';') if s.strip() and not s.strip().startswith('--')]

            for i, statement in enumerate(statements, 1):
                if statement:
                    try:
                        print(f"执行语句 {i}/{len(statements)}...")
                        db.execute(statement)
                        db.commit()
                    except Exception as e:
                        # 如果是字段已存在的错误，忽略
                        if "duplicate column" in str(e).lower() or "already exists" in str(e).lower():
                            print(f"  ⚠️  字段已存在，跳过")
                        else:
                            raise
        else:
            # PostgreSQL 可以一次执行全部
            db.execute(migration_sql)
            db.commit()

        print("✅ 迁移执行成功")

        # 验证字段
        print()
        print("验证新字段:")
        print("-" * 70)

        if db_type == "sqlite":
            cursor = db.execute("PRAGMA table_info(aigc_tasks)")
            columns = cursor.fetchall()

            new_fields = ['retry_count', 'last_retry_at', 'next_retry_at', 'retry_strategy']
            for col in columns:
                col_name = col[1] if isinstance(col, (list, tuple)) else col.get('name', col.get('column_name'))
                if col_name in new_fields:
                    print(f"  ✅ {col_name}")
        else:
            row = db.fetchall("""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = 'aigc_tasks'
                  AND column_name IN ('retry_count', 'next_retry_at', 'last_retry_at', 'retry_strategy')
                ORDER BY column_name
            """)
            for col_name, col_type in row:
                print(f"  ✅ {col_name}: {col_type}")

        print()
        print("=" * 70)
        print("  ✅ 迁移应用成功！")
        print("=" * 70)
        print()
        print("现在可以:")
        print("1. 访问任务看板: http://localhost:8888/dashboard")
        print("2. 测试 API: curl http://localhost:8888/api/tasks/stats")
        print()

    except Exception as e:
        print(f"❌ 执行迁移失败: {e}")
        import traceback
        traceback.print_exc()
        db.rollback()
        sys.exit(1)

    finally:
        db.close()

    sys.exit(0)

except Exception as e:
    print(f"❌ 初始化失败: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
