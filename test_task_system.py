#!/usr/bin/env python3
"""
统一任务系统完整验证脚本

测试功能：
1. 数据库迁移
2. 任务创建与状态机
3. 原子性声明（乐观锁）
4. 任务完成与失败
5. 重试调度计算
6. 重试查询与重置
7. 租约过期清理
8. 状态机保护
"""

import asyncio
import logging
import sys
import time
from datetime import datetime
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent / "apps" / "api" / "src"))

from master_clash.task_system import (
    TaskSystemDB,
    TaskStatus,
    RetryStrategy,
    calculate_retry_delay,
)
from master_clash.database.connection import get_database
from master_clash.database.migrations import apply_migrations

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


def print_result(test_name: str, passed: bool, details: str = ""):
    """Print test result"""
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {test_name}")
    if details:
        print(f"       {details}")


def test_migrations():
    """测试 1: 数据库迁移"""
    print_section("测试 1: 数据库迁移")

    try:
        count = apply_migrations()
        print_result("迁移应用", True, f"{count} 个新迁移")

        # 验证字段存在
        db = get_database()
        try:
            db.execute("SELECT retry_count, next_retry_at, retry_strategy FROM aigc_tasks LIMIT 0")
            print_result("字段验证", True, "所有新字段存在")
            return True
        except Exception as e:
            print_result("字段验证", False, str(e))
            return False
        finally:
            db.close()

    except Exception as e:
        print_result("迁移应用", False, str(e))
        return False


def test_retry_calculation():
    """测试 2: 重试延迟计算"""
    print_section("测试 2: 重试延迟计算")

    try:
        delays = []
        for i in range(6):
            delay = calculate_retry_delay(
                retry_count=i,
                strategy=RetryStrategy.EXPONENTIAL,
                jitter_factor=0,  # 禁用抖动
            )
            delays.append(delay / 1000)  # Convert to seconds

        print(f"  延迟序列 (秒): {delays}")

        # 验证指数增长
        expected = [5, 10, 20, 40, 80, 160]
        correct = all(abs(delays[i] - expected[i]) < 0.1 for i in range(6))

        print_result("指数退避计算", correct, f"实际: {delays[:6]}, 期望: {expected}")
        return correct

    except Exception as e:
        print_result("指数退避计算", False, str(e))
        return False


def test_task_creation():
    """测试 3: 任务创建"""
    print_section("测试 3: 任务创建")

    task_id = f"test-create-{int(time.time())}"

    try:
        # 创建任务
        created = TaskSystemDB.create_task(
            task_id=task_id,
            project_id="test-project",
            task_type="image_gen",
            params={"prompt": "test"},
            max_retries=3,
        )

        if not created:
            print_result("任务创建", False, "create_task 返回 False")
            return False

        # 验证数据库记录
        db = get_database()
        try:
            row = db.fetchone(
                "SELECT status, retry_count, max_retries FROM aigc_tasks WHERE task_id = ?",
                [task_id]
            )

            if not row:
                print_result("任务创建", False, "数据库中未找到记录")
                return False

            correct = (
                row["status"] == TaskStatus.PENDING and
                row["retry_count"] == 0 and
                row["max_retries"] == 3
            )

            print_result(
                "任务创建",
                correct,
                f"status={row['status']}, retry_count={row['retry_count']}"
            )

            # 清理
            db.execute("DELETE FROM aigc_tasks WHERE task_id = ?", [task_id])
            db.commit()

            return correct

        finally:
            db.close()

    except Exception as e:
        print_result("任务创建", False, str(e))
        # 清理
        try:
            db = get_database()
            db.execute("DELETE FROM aigc_tasks WHERE task_id = ?", [task_id])
            db.commit()
            db.close()
        except:
            pass
        return False


def test_task_claim():
    """测试 4: 任务声明（乐观锁）"""
    print_section("测试 4: 任务声明（乐观锁）")

    task_id = f"test-claim-{int(time.time())}"

    try:
        # 创建任务
        TaskSystemDB.create_task(
            task_id=task_id,
            project_id="test-project",
            task_type="image_gen",
            params={},
        )

        # Worker A 声明
        claimed_a = TaskSystemDB.claim_task(
            task_id=task_id,
            worker_id="worker-A",
            lease_duration_ms=60000,
        )

        # Worker B 尝试声明（应该失败）
        claimed_b = TaskSystemDB.claim_task(
            task_id=task_id,
            worker_id="worker-B",
            lease_duration_ms=60000,
        )

        # 验证
        db = get_database()
        try:
            row = db.fetchone(
                "SELECT status, worker_id FROM aigc_tasks WHERE task_id = ?",
                [task_id]
            )

            correct = (
                claimed_a and
                not claimed_b and
                row["status"] == TaskStatus.PROCESSING and
                row["worker_id"] == "worker-A"
            )

            print_result(
                "乐观锁机制",
                correct,
                f"A claimed={claimed_a}, B claimed={claimed_b}, worker={row['worker_id']}"
            )

            # 清理
            db.execute("DELETE FROM aigc_tasks WHERE task_id = ?", [task_id])
            db.commit()

            return correct

        finally:
            db.close()

    except Exception as e:
        print_result("乐观锁机制", False, str(e))
        return False


def test_task_completion():
    """测试 5: 任务完成"""
    print_section("测试 5: 任务完成")

    task_id = f"test-complete-{int(time.time())}"

    try:
        # 创建并声明任务
        TaskSystemDB.create_task(task_id, "test-project", "image_gen", {})
        TaskSystemDB.claim_task(task_id, "worker-A")

        # 完成任务
        completed = TaskSystemDB.complete_task(
            task_id=task_id,
            result_url="/api/image.png",
            result_data={"width": 1024},
        )

        # 验证
        db = get_database()
        try:
            row = db.fetchone(
                "SELECT status, result_url, completed_at FROM aigc_tasks WHERE task_id = ?",
                [task_id]
            )

            correct = (
                completed and
                row["status"] == TaskStatus.COMPLETED and
                row["result_url"] == "/api/image.png" and
                row["completed_at"] is not None
            )

            print_result(
                "任务完成",
                correct,
                f"status={row['status']}, result_url={row['result_url']}"
            )

            # 清理
            db.execute("DELETE FROM aigc_tasks WHERE task_id = ?", [task_id])
            db.commit()

            return correct

        finally:
            db.close()

    except Exception as e:
        print_result("任务完成", False, str(e))
        return False


def test_task_failure_and_retry():
    """测试 6: 任务失败与重试调度"""
    print_section("测试 6: 任务失败与重试调度")

    task_id = f"test-fail-{int(time.time())}"

    try:
        # 创建并声明任务
        TaskSystemDB.create_task(task_id, "test-project", "image_gen", {}, max_retries=3)
        TaskSystemDB.claim_task(task_id, "worker-A")

        # 第一次失败
        failed_1, will_retry_1 = TaskSystemDB.fail_task(
            task_id=task_id,
            error_message="Test error 1",
            retry_strategy=RetryStrategy.EXPONENTIAL,
        )

        db = get_database()
        try:
            row_1 = db.fetchone(
                "SELECT status, retry_count, next_retry_at FROM aigc_tasks WHERE task_id = ?",
                [task_id]
            )

            test_1_passed = (
                failed_1 and
                will_retry_1 and
                row_1["status"] == TaskStatus.FAILED and
                row_1["retry_count"] == 1 and
                row_1["next_retry_at"] is not None
            )

            print_result(
                "第1次失败（调度重试）",
                test_1_passed,
                f"retry_count={row_1['retry_count']}, will_retry={will_retry_1}"
            )

            # 模拟多次失败直到超过最大重试
            for i in range(2, 5):
                failed, will_retry = TaskSystemDB.fail_task(
                    task_id=task_id,
                    error_message=f"Test error {i}",
                )

                row = db.fetchone(
                    "SELECT status, retry_count FROM aigc_tasks WHERE task_id = ?",
                    [task_id]
                )

                if i <= 3:
                    # 应该继续重试
                    expected = (failed and will_retry and row["status"] == TaskStatus.FAILED)
                    print_result(
                        f"第{i}次失败（调度重试）",
                        expected,
                        f"retry_count={row['retry_count']}"
                    )
                else:
                    # 超过最大重试，应该标记为 DEAD
                    expected = (failed and not will_retry and row["status"] == TaskStatus.DEAD)
                    print_result(
                        f"第{i}次失败（超过最大重试）",
                        expected,
                        f"status={row['status']}, will_retry={will_retry}"
                    )

            # 清理
            db.execute("DELETE FROM aigc_tasks WHERE task_id = ?", [task_id])
            db.commit()

            return test_1_passed

        finally:
            db.close()

    except Exception as e:
        print_result("任务失败与重试", False, str(e))
        return False


def test_state_machine_protection():
    """测试 7: 状态机保护"""
    print_section("测试 7: 状态机保护（防止覆盖已完成任务）")

    task_id = f"test-protect-{int(time.time())}"

    try:
        # 创建、声明、完成任务
        TaskSystemDB.create_task(task_id, "test-project", "image_gen", {})
        TaskSystemDB.claim_task(task_id, "worker-A")
        TaskSystemDB.complete_task(task_id, result_url="/api/image.png")

        # 尝试将已完成任务标记为失败（应该被拒绝）
        failed, will_retry = TaskSystemDB.fail_task(
            task_id=task_id,
            error_message="Should be rejected",
        )

        # 验证任务仍为 COMPLETED
        db = get_database()
        try:
            row = db.fetchone(
                "SELECT status FROM aigc_tasks WHERE task_id = ?",
                [task_id]
            )

            protected = (
                not failed and  # 操作被拒绝
                not will_retry and
                row["status"] == TaskStatus.COMPLETED  # 状态未改变
            )

            print_result(
                "状态机保护",
                protected,
                f"status={row['status']}, 拒绝覆盖={not failed}"
            )

            # 清理
            db.execute("DELETE FROM aigc_tasks WHERE task_id = ?", [task_id])
            db.commit()

            return protected

        finally:
            db.close()

    except Exception as e:
        print_result("状态机保护", False, str(e))
        return False


def test_retry_query_and_reset():
    """测试 8: 重试任务查询与重置"""
    print_section("测试 8: 重试任务查询与重置")

    task_id = f"test-query-{int(time.time())}"

    try:
        # 创建一个立即可重试的任务
        TaskSystemDB.create_task(task_id, "test-project", "image_gen", {}, max_retries=3)
        TaskSystemDB.claim_task(task_id, "worker-A")

        # 失败并调度重试（设置 next_retry_at 为过去时间）
        db = get_database()
        try:
            now = int(datetime.utcnow().timestamp() * 1000)
            past_time = now - 10000  # 10秒前

            db.execute(
                """UPDATE aigc_tasks
                   SET status = ?, retry_count = 1, next_retry_at = ?
                   WHERE task_id = ?""",
                [TaskStatus.FAILED, past_time, task_id]
            )
            db.commit()

            # 查询待重试任务
            tasks = TaskSystemDB.get_tasks_for_retry(limit=100)
            found = any(t["task_id"] == task_id for t in tasks)

            print_result("查询待重试任务", found, f"找到 {len(tasks)} 个任务")

            if not found:
                return False

            # 重置任务
            reset = TaskSystemDB.reset_task_for_retry(task_id)

            # 验证状态
            row = db.fetchone(
                "SELECT status, worker_id FROM aigc_tasks WHERE task_id = ?",
                [task_id]
            )

            reset_correct = (
                reset and
                row["status"] == TaskStatus.PENDING and
                row["worker_id"] is None
            )

            print_result(
                "重置任务状态",
                reset_correct,
                f"status={row['status']}, worker_id={row['worker_id']}"
            )

            # 清理
            db.execute("DELETE FROM aigc_tasks WHERE task_id = ?", [task_id])
            db.commit()

            return found and reset_correct

        finally:
            db.close()

    except Exception as e:
        print_result("重试查询与重置", False, str(e))
        return False


def test_lease_cleanup():
    """测试 9: 租约过期清理"""
    print_section("测试 9: 租约过期清理")

    task_id = f"test-lease-{int(time.time())}"

    try:
        # 创建任务并设置过期租约
        TaskSystemDB.create_task(task_id, "test-project", "image_gen", {})

        db = get_database()
        try:
            now = int(datetime.utcnow().timestamp() * 1000)
            past_time = now - 10000  # 10秒前过期

            db.execute(
                """UPDATE aigc_tasks
                   SET status = ?, worker_id = ?, lease_expires_at = ?
                   WHERE task_id = ?""",
                [TaskStatus.PROCESSING, "worker-A", past_time, task_id]
            )
            db.commit()

            # 执行租约清理
            count = TaskSystemDB.cleanup_expired_leases()

            # 验证任务已重置
            row = db.fetchone(
                "SELECT status, worker_id, lease_expires_at FROM aigc_tasks WHERE task_id = ?",
                [task_id]
            )

            cleaned = (
                count >= 1 and
                row["status"] == TaskStatus.PENDING and
                row["worker_id"] is None and
                row["lease_expires_at"] is None
            )

            print_result(
                "租约过期清理",
                cleaned,
                f"清理数量={count}, status={row['status']}"
            )

            # 清理
            db.execute("DELETE FROM aigc_tasks WHERE task_id = ?", [task_id])
            db.commit()

            return cleaned

        finally:
            db.close()

    except Exception as e:
        print_result("租约过期清理", False, str(e))
        return False


def run_all_tests():
    """运行所有测试"""
    print("\n" + "=" * 70)
    print("  统一任务系统完整验证")
    print("=" * 70)

    tests = [
        ("数据库迁移", test_migrations),
        ("重试延迟计算", test_retry_calculation),
        ("任务创建", test_task_creation),
        ("任务声明（乐观锁）", test_task_claim),
        ("任务完成", test_task_completion),
        ("任务失败与重试", test_task_failure_and_retry),
        ("状态机保护", test_state_machine_protection),
        ("重试查询与重置", test_retry_query_and_reset),
        ("租约过期清理", test_lease_cleanup),
    ]

    results = []
    for name, test_func in tests:
        try:
            passed = test_func()
            results.append((name, passed))
        except Exception as e:
            logger.error(f"测试 '{name}' 异常: {e}", exc_info=True)
            results.append((name, False))

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
        print("\n🎉 所有测试通过！统一任务系统工作正常。\n")
        return 0
    else:
        print(f"\n❌ {total_count - passed_count} 个测试失败。\n")
        return 1


if __name__ == "__main__":
    exit_code = run_all_tests()
    sys.exit(exit_code)
