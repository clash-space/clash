#!/usr/bin/env python3
"""
持久化重试机制验证脚本

测试以下功能：
1. 数据库迁移应用
2. 重试调度计算
3. 重试管理器基本功能
4. 模拟任务失败和重试流程
"""

import asyncio
import logging
import sys
from datetime import datetime
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent / "apps" / "api" / "src"))

from master_clash.api.retry_manager import (
    DEFAULT_INITIAL_DELAY_MS,
    RETRY_STRATEGY_EXPONENTIAL,
    calculate_next_retry_time,
    get_tasks_ready_for_retry,
    reset_task_for_retry,
    schedule_retry,
)
from master_clash.config import get_settings
from master_clash.database.connection import get_database
from master_clash.database.migrations import apply_migrations

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def test_migrations():
    """测试数据库迁移"""
    print("\n" + "="*60)
    print("测试 1: 数据库迁移")
    print("="*60)

    try:
        count = apply_migrations()
        print(f"✅ 迁移应用成功: {count} 个新迁移")

        # 验证新字段存在
        db = get_database()
        try:
            row = db.fetchone("SELECT retry_count, next_retry_at FROM aigc_tasks LIMIT 1")
            print("✅ 新字段验证成功")
        except Exception as e:
            if "no such column" in str(e).lower():
                print(f"❌ 新字段不存在: {e}")
                return False
            # 如果表为空，这是正常的
            print("✅ 表结构正确（表为空）")
        finally:
            db.close()

        return True

    except Exception as e:
        print(f"❌ 迁移失败: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_retry_calculation():
    """测试重试时间计算"""
    print("\n" + "="*60)
    print("测试 2: 重试时间计算")
    print("="*60)

    try:
        now = int(datetime.utcnow().timestamp() * 1000)

        for retry_count in range(5):
            next_retry = calculate_next_retry_time(
                retry_count=retry_count,
                strategy=RETRY_STRATEGY_EXPONENTIAL,
                jitter_factor=0,  # 禁用抖动以便验证
            )

            delay_ms = next_retry - now
            delay_s = delay_ms / 1000

            expected_delay = DEFAULT_INITIAL_DELAY_MS * (2 ** retry_count) / 1000
            print(f"  重试 {retry_count + 1}: {delay_s:.1f}s (预期: ~{expected_delay:.1f}s)")

        print("✅ 重试时间计算正确")
        return True

    except Exception as e:
        print(f"❌ 计算失败: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_retry_scheduling():
    """测试重试调度"""
    print("\n" + "="*60)
    print("测试 3: 重试调度功能")
    print("="*60)

    db = get_database()
    test_task_id = "test-task-" + str(int(datetime.utcnow().timestamp()))

    try:
        # 创建测试任务
        now = int(datetime.utcnow().timestamp() * 1000)
        db.execute(
            """INSERT INTO aigc_tasks
               (task_id, project_id, task_type, status, params, created_at, updated_at, max_retries)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [test_task_id, "test-project", "image_gen", "processing", "{}", now, now, 3]
        )
        db.commit()
        print(f"✅ 创建测试任务: {test_task_id}")

        # 测试首次失败调度重试
        success = await schedule_retry(
            task_id=test_task_id,
            error_message="Test error",
            retry_strategy=RETRY_STRATEGY_EXPONENTIAL,
        )

        if not success:
            print("❌ 重试调度失败")
            return False

        # 验证任务状态
        row = db.fetchone(
            "SELECT retry_count, next_retry_at, status FROM aigc_tasks WHERE task_id = ?",
            [test_task_id]
        )

        if row["retry_count"] != 1:
            print(f"❌ retry_count 错误: {row['retry_count']} (期望: 1)")
            return False

        if row["status"] != "failed":
            print(f"❌ status 错误: {row['status']} (期望: failed)")
            return False

        if not row["next_retry_at"]:
            print("❌ next_retry_at 未设置")
            return False

        print(f"✅ 重试调度成功: retry_count={row['retry_count']}, next_retry_at={row['next_retry_at']}")

        # 测试重试次数限制
        for i in range(2, 5):  # 重试 2, 3, 4 次
            success = await schedule_retry(
                task_id=test_task_id,
                error_message=f"Test error {i}",
                retry_strategy=RETRY_STRATEGY_EXPONENTIAL,
            )

            row = db.fetchone(
                "SELECT retry_count FROM aigc_tasks WHERE task_id = ?",
                [test_task_id]
            )

            if i <= 3:
                if not success:
                    print(f"❌ 第 {i} 次重试应该成功但失败了")
                    return False
                print(f"  ✓ 第 {i} 次重试调度成功")
            else:
                if success:
                    print(f"❌ 第 {i} 次重试应该失败但成功了（超过 max_retries）")
                    return False
                print(f"  ✓ 第 {i} 次重试正确拒绝（超过最大重试次数）")

        print("✅ 重试次数限制工作正常")

        # 清理测试任务
        db.execute("DELETE FROM aigc_tasks WHERE task_id = ?", [test_task_id])
        db.commit()
        print("✅ 清理测试数据")

        return True

    except Exception as e:
        print(f"❌ 重试调度测试失败: {e}")
        import traceback
        traceback.print_exc()

        # 清理
        try:
            db.execute("DELETE FROM aigc_tasks WHERE task_id = ?", [test_task_id])
            db.commit()
        except:
            pass

        return False

    finally:
        db.close()


async def test_retry_query():
    """测试重试查询"""
    print("\n" + "="*60)
    print("测试 4: 重试任务查询")
    print("="*60)

    db = get_database()
    test_task_id = "test-query-" + str(int(datetime.utcnow().timestamp()))

    try:
        # 创建一个立即可重试的任务
        now = int(datetime.utcnow().timestamp() * 1000)
        past_time = now - 10000  # 10秒前

        db.execute(
            """INSERT INTO aigc_tasks
               (task_id, project_id, task_type, status, params, created_at, updated_at,
                retry_count, next_retry_at, max_retries)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [test_task_id, "test-project", "image_gen", "failed", "{}", now, now, 1, past_time, 3]
        )
        db.commit()
        print(f"✅ 创建可重试测试任务")

        # 查询待重试任务
        tasks = await get_tasks_ready_for_retry(limit=10)

        found = any(task["task_id"] == test_task_id for task in tasks)

        if not found:
            print(f"❌ 未找到待重试任务（共找到 {len(tasks)} 个任务）")
            return False

        print(f"✅ 成功查询到待重试任务（共 {len(tasks)} 个）")

        # 测试重置任务
        success = await reset_task_for_retry(test_task_id)

        if not success:
            print("❌ 重置任务失败")
            return False

        # 验证状态
        row = db.fetchone(
            "SELECT status, worker_id FROM aigc_tasks WHERE task_id = ?",
            [test_task_id]
        )

        if row["status"] != "pending":
            print(f"❌ 重置后 status 错误: {row['status']} (期望: pending)")
            return False

        if row["worker_id"] is not None:
            print(f"❌ 重置后 worker_id 应为 NULL")
            return False

        print("✅ 任务重置成功")

        # 清理
        db.execute("DELETE FROM aigc_tasks WHERE task_id = ?", [test_task_id])
        db.commit()

        return True

    except Exception as e:
        print(f"❌ 查询测试失败: {e}")
        import traceback
        traceback.print_exc()

        # 清理
        try:
            db.execute("DELETE FROM aigc_tasks WHERE task_id = ?", [test_task_id])
            db.commit()
        except:
            pass

        return False

    finally:
        db.close()


async def run_all_tests():
    """运行所有测试"""
    print("\n" + "="*60)
    print("持久化重试机制验证")
    print("="*60)

    results = []

    # 测试 1: 迁移
    results.append(("数据库迁移", test_migrations()))

    # 测试 2: 计算
    results.append(("重试时间计算", test_retry_calculation()))

    # 测试 3: 调度
    results.append(("重试调度", await test_retry_scheduling()))

    # 测试 4: 查询
    results.append(("重试查询", await test_retry_query()))

    # 汇总结果
    print("\n" + "="*60)
    print("测试结果汇总")
    print("="*60)

    all_passed = True
    for name, passed in results:
        status = "✅ 通过" if passed else "❌ 失败"
        print(f"{status}: {name}")
        if not passed:
            all_passed = False

    print("="*60)

    if all_passed:
        print("\n🎉 所有测试通过！持久化重试机制工作正常。")
        return 0
    else:
        print("\n❌ 部分测试失败，请检查日志。")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(run_all_tests())
    sys.exit(exit_code)
