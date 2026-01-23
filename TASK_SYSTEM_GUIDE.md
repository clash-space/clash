# 统一任务系统使用指南

## 实现日期
2026-01-21

## 概述

**统一任务系统** (`task_system.py`) 提供：
1. **原子性数据库操作** - ACID 事务保证
2. **状态机验证** - 防止非法状态转换
3. **持久化重试** - 自动重试失败任务
4. **租约管理** - 处理 worker 崩溃
5. **后台调度器** - 自动拉起失败任务

---

## 快速开始

### 1. 应用数据库迁移

```bash
cd apps/api
python -m master_clash.database.migrations
```

或者在应用启动时自动应用（已配置）。

### 2. 在 `main.py` 中启动调度器

```python
from master_clash.task_system import start_task_scheduler

@app.on_event("startup")
async def startup_event():
    # 应用迁移
    from master_clash.database.migrations import apply_migrations
    apply_migrations()

    # 启动任务调度器
    start_task_scheduler()
    logger.info("✅ Task scheduler started")
```

### 3. 在代码中使用原子操作

```python
from master_clash.task_system import TaskSystemDB, TaskStatus, RetryStrategy

# 创建任务
TaskSystemDB.create_task(
    task_id="task-123",
    project_id="proj-456",
    task_type="image_gen",
    params={"prompt": "sunset"},
    max_retries=3,
)

# 声明任务（带租约）
claimed = TaskSystemDB.claim_task(
    task_id="task-123",
    worker_id="worker-abc",
    lease_duration_ms=120000,  # 2 minutes
)

# 任务成功
if success:
    TaskSystemDB.complete_task(
        task_id="task-123",
        result_url="/api/assets/view/image.png",
    )

# 任务失败（自动调度重试）
else:
    failed, will_retry = TaskSystemDB.fail_task(
        task_id="task-123",
        error_message="Network timeout",
        retry_strategy=RetryStrategy.EXPONENTIAL,
    )
    # will_retry=True 表示已调度重试
    # will_retry=False 表示超过最大重试次数，永久失败
```

---

## 核心组件

### 1. TaskStatus (状态机)

```python
class TaskStatus(str, Enum):
    PENDING = "pending"          # 等待处理
    PROCESSING = "processing"    # 正在处理
    COMPLETED = "completed"      # 成功完成
    FAILED = "failed"           # 失败（可重试）
    DEAD = "dead"               # 永久失败（max retries exceeded）
```

**状态转换规则**:
```
PENDING      → PROCESSING, FAILED, DEAD
PROCESSING   → COMPLETED, FAILED, DEAD
FAILED       → PENDING (retry), DEAD (max retries)
COMPLETED    → [terminal]
DEAD         → [terminal]
```

### 2. RetryStrategy (重试策略)

```python
class RetryStrategy(str, Enum):
    EXPONENTIAL = "exponential"  # delay = initial * (2 ^ count)
    LINEAR = "linear"            # delay = initial * (1 + count)
    FIXED = "fixed"              # delay = initial
```

**示例延迟**（exponential，initial=5s, factor=2）:
| 重试 | 延迟 | 累计时间 |
|------|------|---------|
| 1    | 5s   | 5s      |
| 2    | 10s  | 15s     |
| 3    | 20s  | 35s     |
| 4    | 40s  | 75s     |
| 5    | 80s  | 155s    |
| 6    | 160s | 315s    |
| 7+   | 300s (cap) | ... |

### 3. TaskSystemDB (原子操作)

所有数据库操作都是原子性的（ACID），保证状态一致性。

#### create_task(task_id, project_id, task_type, params, max_retries)
创建新任务。

**参数**:
- `task_id`: 唯一任务 ID
- `project_id`: 项目 ID
- `task_type`: 任务类型（image_gen, video_gen, etc.）
- `params`: 任务参数（dict）
- `max_retries`: 最大重试次数（默认 3）

**返回**: `bool` - 创建成功返回 True

#### claim_task(task_id, worker_id, lease_duration_ms)
声明任务（乐观锁）。

**流程**:
1. 检查 status = PENDING
2. 更新 status = PROCESSING，设置 worker_id 和 lease
3. 原子提交

**参数**:
- `task_id`: 任务 ID
- `worker_id`: Worker 标识
- `lease_duration_ms`: 租约时长（默认 120000 = 2分钟）

**返回**: `bool` - 声明成功返回 True

#### complete_task(task_id, result_url, result_data)
标记任务完成。

**状态转换**: PROCESSING → COMPLETED

**参数**:
- `task_id`: 任务 ID
- `result_url`: 结果 URL（可选）
- `result_data`: 结果数据（dict，可选）

**返回**: `bool` - 完成成功返回 True

#### fail_task(task_id, error_message, retry_strategy)
任务失败并调度重试。

**状态转换**:
- 如果 retry_count < max_retries: PROCESSING → FAILED（调度重试）
- 如果 retry_count >= max_retries: PROCESSING → DEAD（永久失败）

**参数**:
- `task_id`: 任务 ID
- `error_message`: 错误消息
- `retry_strategy`: 重试策略（默认 EXPONENTIAL）

**返回**: `(task_failed: bool, will_retry: bool)`
- `task_failed=True`: 操作成功
- `will_retry=True`: 已调度重试
- `will_retry=False`: 超过最大重试次数，永久失败

**示例**:
```python
failed, will_retry = TaskSystemDB.fail_task(
    task_id="task-123",
    error_message="429 RESOURCE_EXHAUSTED",
    retry_strategy=RetryStrategy.EXPONENTIAL,
)

if failed and will_retry:
    logger.info("任务失败，已调度重试")
elif failed and not will_retry:
    logger.warning("任务永久失败（超过最大重试次数）")
else:
    logger.error("操作失败（可能是状态冲突）")
```

#### reset_task_for_retry(task_id)
重置任务为 PENDING 状态以便重试。

**状态转换**: FAILED → PENDING

**参数**:
- `task_id`: 任务 ID

**返回**: `bool` - 重置成功返回 True

#### get_tasks_for_retry(limit)
查询待重试任务。

**查询条件**:
- status = FAILED
- retry_count < max_retries
- next_retry_at <= now

**参数**:
- `limit`: 最大返回数量（默认 100）

**返回**: `list[dict]` - 任务列表

#### cleanup_expired_leases()
释放过期租约。

**逻辑**:
- 查找 status = PROCESSING 且 lease_expires_at < now 的任务
- 重置为 PENDING 状态

**返回**: `int` - 释放的任务数量

---

### 4. TaskScheduler (后台调度器)

自动运行两个后台任务：

#### Retry Scheduler (重试调度器)
- **频率**: 每 10 秒
- **功能**: 扫描 `next_retry_at <= now` 的失败任务，重置为 PENDING
- **日志**:
  ```
  [TaskScheduler] Found 5 tasks ready for retry
  [TaskScheduler] 🔄 Retrying task-123 (attempt 2/3)
  ```

#### Lease Cleanup (租约清理)
- **频率**: 每 30 秒
- **功能**: 释放过期租约（处理 worker 崩溃）
- **日志**:
  ```
  [TaskScheduler] 🔓 Cleaned up 2 expired leases
  ```

---

## 完整使用示例

### 示例 1: 图片生成任务

```python
import asyncio
from master_clash.task_system import TaskSystemDB, RetryStrategy

async def generate_image_task(task_id: str, params: dict):
    """
    图片生成任务处理器
    """
    # 1. 创建任务
    TaskSystemDB.create_task(
        task_id=task_id,
        project_id=params["project_id"],
        task_type="image_gen",
        params=params,
        max_retries=3,
    )

    # 2. 声明任务（带租约）
    worker_id = "worker-abc"
    claimed = TaskSystemDB.claim_task(
        task_id=task_id,
        worker_id=worker_id,
        lease_duration_ms=120000,  # 2 minutes
    )

    if not claimed:
        logger.warning(f"Task {task_id} already claimed by another worker")
        return

    # 3. 处理任务
    try:
        # 调用生成 API
        result = await call_gemini_api(params["prompt"])

        # 4. 标记成功
        TaskSystemDB.complete_task(
            task_id=task_id,
            result_url=result["url"],
            result_data={"width": 1024, "height": 1024},
        )

        logger.info(f"✅ Task {task_id} completed")

    except Exception as e:
        # 5. 标记失败（自动调度重试）
        failed, will_retry = TaskSystemDB.fail_task(
            task_id=task_id,
            error_message=str(e),
            retry_strategy=RetryStrategy.EXPONENTIAL,
        )

        if will_retry:
            logger.info(f"🔄 Task {task_id} scheduled for retry")
        else:
            logger.error(f"❌ Task {task_id} permanently failed")
```

### 示例 2: 防止服务宕机数据丢失

```python
# 场景：服务宕机前
task_id = "task-123"

# 创建任务
TaskSystemDB.create_task(task_id, ...)

# 任务失败，调度重试
TaskSystemDB.fail_task(task_id, "Network error")
# 数据库记录: status=FAILED, retry_count=1, next_retry_at=<5秒后>

# 💥 服务宕机
# ...

# 🚀 服务重启
# startup_event() 自动启动 TaskScheduler

# 调度器检测到待重试任务
# → reset_task_for_retry(task_id)
# → status: FAILED → PENDING

# 任务被重新处理 ✅
```

### 示例 3: Worker 崩溃处理

```python
# Worker A 声明任务
TaskSystemDB.claim_task(
    task_id="task-123",
    worker_id="worker-A",
    lease_duration_ms=120000,  # 2 minutes
)
# status=PROCESSING, lease_expires_at=<2分钟后>

# 💥 Worker A 崩溃（没有标记完成）

# 2 分钟后...
# Lease Cleanup 检测到租约过期
TaskSystemDB.cleanup_expired_leases()
# → status: PROCESSING → PENDING
# → lease_expires_at: NULL

# Worker B 重新声明任务
TaskSystemDB.claim_task(
    task_id="task-123",
    worker_id="worker-B",
)
# ✅ 任务被恢复处理
```

---

## 状态机保护示例

### 场景：防止覆盖已完成任务

```python
task_id = "task-123"

# T0: 任务成功完成
TaskSystemDB.complete_task(task_id, result_url="/api/image.png")
# status=COMPLETED

# T1: 后台描述任务失败，尝试标记任务为失败
failed, will_retry = TaskSystemDB.fail_task(
    task_id=task_id,
    error_message="Description failed",
)

# 结果：
# failed=False  ← 操作被拒绝
# 日志：
# [TaskSystem] 🛡️ STATE MACHINE: Cannot fail task xxx in terminal state COMPLETED

# T2: 验证任务仍为 COMPLETED
# ✅ 数据完整性保护成功
```

---

## 监控与调试

### 1. 查看待重试任务

```sql
SELECT task_id, retry_count, max_retries, next_retry_at, error_message
FROM aigc_tasks
WHERE status = 'failed'
  AND retry_count < max_retries
ORDER BY next_retry_at ASC;
```

### 2. 统计重试情况

```sql
SELECT
  task_type,
  COUNT(*) as total,
  SUM(CASE WHEN retry_count > 0 THEN 1 ELSE 0 END) as retried,
  AVG(retry_count) as avg_retries
FROM aigc_tasks
WHERE status IN ('completed', 'failed', 'dead')
GROUP BY task_type;
```

### 3. 查看过期租约

```sql
SELECT task_id, worker_id, lease_expires_at, updated_at
FROM aigc_tasks
WHERE status = 'processing'
  AND lease_expires_at < ?  -- 当前时间戳
ORDER BY lease_expires_at ASC;
```

### 4. 日志示例

```
[TaskSystem] ✅ Created task: task-123
[TaskSystem] ✅ Claimed task: task-123 by worker-abc
[TaskSystem] 🔄 Scheduled retry 1/3 for task task-123 (+5.2s)
[TaskScheduler] Found 2 tasks ready for retry
[TaskScheduler] 🔄 Retrying task-123 (attempt 1/3)
[TaskScheduler] ✅ Reset task task-123 for retry
[TaskSystem] ✅ Completed task: task-123
```

---

## 配置参数

### 全局默认值

```python
# task_system.py

DEFAULT_MAX_RETRIES = 3            # 最大重试次数
DEFAULT_INITIAL_DELAY_MS = 5000    # 初始延迟 5秒
DEFAULT_MAX_DELAY_MS = 300000      # 最大延迟 5分钟
DEFAULT_BACKOFF_FACTOR = 2.0       # 指数退避因子
DEFAULT_JITTER_FACTOR = 0.1        # 抖动因子 ±10%

RETRY_INTERVAL = 10                # 重试调度间隔 10秒
LEASE_CLEANUP_INTERVAL = 30        # 租约清理间隔 30秒
LEASE_DURATION_MS = 120000         # 默认租约 2分钟
```

### 自定义配置

```python
# 自定义最大重试次数
TaskSystemDB.create_task(
    task_id="task-123",
    ...,
    max_retries=5,  # ← 自定义
)

# 自定义重试策略
TaskSystemDB.fail_task(
    task_id="task-123",
    ...,
    retry_strategy=RetryStrategy.LINEAR,  # ← 自定义
)

# 自定义租约时长
TaskSystemDB.claim_task(
    task_id="task-123",
    ...,
    lease_duration_ms=300000,  # 5分钟 ← 自定义
)
```

---

## 部署清单

### 1. 应用数据库迁移

```bash
cd apps/api
python -m master_clash.database.migrations
```

### 2. 验证迁移

```bash
# SQLite
sqlite3 aigc.db "SELECT retry_count FROM aigc_tasks LIMIT 1"

# PostgreSQL
psql -d aigc -c "SELECT retry_count FROM aigc_tasks LIMIT 1"
```

### 3. 启动应用

```bash
uvicorn master_clash.api.main:app --host 0.0.0.0 --port 8888
```

### 4. 验证调度器

```bash
# 查看日志
tail -f backend.log | grep TaskScheduler

# 应该看到：
# [TaskScheduler] 🚀 Started retry scheduler (interval: 10s)
# [TaskScheduler] 🚀 Started lease cleanup (interval: 30s)
```

---

## 文件清单

### 核心文件
- `apps/api/src/master_clash/task_system.py` - 统一任务系统
- `apps/api/src/master_clash/database/migrations.py` - 迁移管理器
- `apps/api/src/master_clash/api/main.py` - 应用启动（集成调度器）

### 数据库迁移
- `apps/api/src/master_clash/migrations/sqlite/0004_add_retry_fields.sql`
- `apps/api/src/master_clash/migrations/postgres/0004_add_retry_fields.sql`

### 测试与文档
- `test_retry_mechanism.py` - 验证脚本
- `PERSISTENT_RETRY_MECHANISM.md` - 完整文档
- `TASK_SYSTEM_GUIDE.md` - 使用指南（本文件）

---

## 总结

✅ **原子性**: 所有数据库操作 ACID 保证
✅ **状态机**: 防止非法状态转换，数据完整性
✅ **持久化**: 宕机安全，自动恢复
✅ **自动重试**: 后台调度器自动拉起失败任务
✅ **租约管理**: 自动处理 worker 崩溃
✅ **生产就绪**: 完整的错误处理和日志记录
