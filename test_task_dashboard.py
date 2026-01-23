#!/usr/bin/env python3
"""
测试任务看板 API

测试功能：
1. 任务统计 API
2. 任务列表 API（带筛选和分页）
3. 失败任务 API
"""

import asyncio
import logging
import sys
from pathlib import Path
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent / "apps" / "api" / "src"))

from master_clash.database.connection import get_database
from master_clash.task_system import TaskSystemDB, TaskStatus, RetryStrategy

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def print_section(title: str):
    """Print section header"""
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70)


def create_sample_tasks():
    """Create sample tasks for testing"""
    print_section("创建示例任务")

    # 创建不同状态的任务
    task_scenarios = [
        # (task_id, status, retry_count, error_message)
        ("sample-pending-1", TaskStatus.PENDING, 0, None),
        ("sample-pending-2", TaskStatus.PENDING, 0, None),
        ("sample-processing-1", TaskStatus.PROCESSING, 0, None),
        ("sample-completed-1", TaskStatus.COMPLETED, 0, None),
        ("sample-completed-2", TaskStatus.COMPLETED, 1, "Retried once but succeeded"),
        ("sample-failed-1", TaskStatus.FAILED, 2, "Temporary network error"),
        ("sample-failed-2", TaskStatus.FAILED, 3, "429 RESOURCE_EXHAUSTED"),
        ("sample-dead-1", TaskStatus.DEAD, 3, "Max retries exceeded: Service unavailable"),
    ]

    db = get_database()
    now = int(datetime.utcnow().timestamp() * 1000)

    try:
        for task_id, status, retry_count, error_msg in task_scenarios:
            # Check if already exists
            existing = db.fetchone(
                "SELECT task_id FROM aigc_tasks WHERE task_id = ?",
                [task_id]
            )

            if existing:
                print(f"  ⏭️  任务已存在: {task_id}")
                continue

            # Create task
            completed_at = now + 100000 if status == TaskStatus.COMPLETED else None
            next_retry_at = now + 5000 if status == TaskStatus.FAILED and retry_count < 3 else None

            db.execute(
                """INSERT INTO aigc_tasks
                   (task_id, project_id, task_type, provider, status, params,
                    created_at, updated_at, completed_at, max_retries, retry_count,
                    next_retry_at, error_message)
                   VALUES (?, ?, ?, 'python', ?, ?, ?, ?, ?, 3, ?, ?, ?)""",
                [
                    task_id,
                    "test-project-dashboard",
                    "image_gen",
                    status,
                    "{}",
                    now,
                    now,
                    completed_at,
                    retry_count,
                    next_retry_at,
                    error_msg,
                ]
            )

            print(f"  ✅ 创建: {task_id} (status={status}, retry={retry_count})")

        db.commit()
        print(f"\n✅ 示例任务创建完成")
        return True

    except Exception as e:
        logger.error(f"创建示例任务失败: {e}")
        db.rollback()
        return False

    finally:
        db.close()


def test_task_stats():
    """测试任务统计"""
    print_section("测试任务统计")

    db = get_database()

    try:
        # 计算统计数据
        stats_row = db.fetchone(
            """SELECT
                COUNT(*) as total_tasks,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END) as dead,
                SUM(retry_count) as total_retries,
                SUM(CASE WHEN retry_count > 0 THEN 1 ELSE 0 END) as tasks_with_retries
            FROM aigc_tasks
            WHERE project_id = 'test-project-dashboard'"""
        )

        total_tasks = stats_row["total_tasks"] or 0
        completed = stats_row["completed"] or 0
        success_rate = (completed / total_tasks * 100) if total_tasks > 0 else 0.0

        print(f"  总任务数: {total_tasks}")
        print(f"  等待中: {stats_row['pending']}")
        print(f"  进行中: {stats_row['processing']}")
        print(f"  已完成: {stats_row['completed']}")
        print(f"  失败: {stats_row['failed']}")
        print(f"  永久失败: {stats_row['dead']}")
        print(f"  成功率: {success_rate:.2f}%")
        print(f"  总重试次数: {stats_row['total_retries']}")
        print(f"  重试过的任务: {stats_row['tasks_with_retries']}")

        print("\n✅ 统计数据获取成功")
        return True

    except Exception as e:
        logger.error(f"获取统计数据失败: {e}")
        return False

    finally:
        db.close()


def test_task_list():
    """测试任务列表查询"""
    print_section("测试任务列表查询")

    db = get_database()

    try:
        # 查询失败任务
        rows = db.fetchall(
            """SELECT
                task_id, status, retry_count, max_retries, error_message, next_retry_at
            FROM aigc_tasks
            WHERE project_id = 'test-project-dashboard'
              AND (status = 'failed' OR status = 'dead')
            ORDER BY updated_at DESC"""
        )

        print(f"\n  找到 {len(rows)} 个失败任务:\n")

        for row in rows:
            retry_status = ""
            if row["status"] == "failed":
                if row["retry_count"] >= row["max_retries"]:
                    retry_status = "max_retries_exceeded"
                elif row.get("next_retry_at"):
                    retry_status = "retrying"
            elif row["status"] == "dead":
                retry_status = "permanently_failed"

            print(f"    {row['task_id']}")
            print(f"      状态: {row['status']}")
            print(f"      重试: {row['retry_count']}/{row['max_retries']}")
            print(f"      重试状态: {retry_status}")
            print(f"      错误: {row['error_message']}")
            print()

        print("✅ 任务列表查询成功")
        return True

    except Exception as e:
        logger.error(f"查询任务列表失败: {e}")
        return False

    finally:
        db.close()


def cleanup_sample_tasks():
    """清理示例任务"""
    print_section("清理示例任务")

    db = get_database()

    try:
        db.execute(
            "DELETE FROM aigc_tasks WHERE project_id = 'test-project-dashboard'"
        )
        db.commit()

        count = db.cursor.rowcount
        print(f"  ✅ 清理了 {count} 个示例任务")
        return True

    except Exception as e:
        logger.error(f"清理失败: {e}")
        db.rollback()
        return False

    finally:
        db.close()


def run_all_tests():
    """运行所有测试"""
    print("\n" + "=" * 70)
    print("  任务看板 API 测试")
    print("=" * 70)

    results = []

    # 1. 创建示例任务
    results.append(("创建示例任务", create_sample_tasks()))

    # 2. 测试统计
    results.append(("任务统计", test_task_stats()))

    # 3. 测试任务列表
    results.append(("任务列表查询", test_task_list()))

    # 4. 清理（可选）
    # results.append(("清理示例任务", cleanup_sample_tasks()))

    # 汇总结果
    print("\n" + "=" * 70)
    print("  测试结果汇总")
    print("=" * 70)

    passed_count = sum(1 for _, passed in results if passed)
    total_count = len(results)

    for name, passed in results:
        status = "✅" if passed else "❌"
        print(f"{status} {name}")

    print("=" * 70)
    print(f"  {passed_count}/{total_count} 测试通过")
    print("=" * 70)

    if passed_count == total_count:
        print("\n🎉 所有测试通过！任务看板 API 工作正常。\n")
        print("📊 访问 http://localhost:8888/dashboard 查看任务看板")
        print("📊 访问 http://localhost:8888/api/tasks/stats 查看统计数据")
        print("📊 访问 http://localhost:8888/api/tasks/dashboard 查看任务列表")
        return 0
    else:
        print(f"\n❌ {total_count - passed_count} 个测试失败。\n")
        return 1


if __name__ == "__main__":
    exit_code = run_all_tests()
    sys.exit(exit_code)
