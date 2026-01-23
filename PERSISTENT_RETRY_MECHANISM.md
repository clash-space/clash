# 持久化重试机制实现总结

## 实现日期
2026-01-21

## 问题背景
用户要求：
1. **所有生成任务都需要统一的重试机制**
2. **放在 Python 后端**（不依赖 SDK 层）
3. **重试需要持久化**，防止服务宕机后丢失重试状态

## 架构设计

### 核心原理
```
┌─────────────────────────────────────────────────────────┐
│                  数据库持久化层                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │ aigc_tasks table                                │   │
│  │ + retry_count (重试次数)                         │   │
│  │ + next_retry_at (下次重试时间戳)                  │   │
│  │ + last_retry_at (上次重试时间戳)                  │   │
│  │ + retry_strategy (exponential/linear/fixed)    │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│               RetryManager (retry_manager.py)          │
│  ┌─────────────────────────────────────────────────┐   │
│  │ calculate_next_retry_time()                      │   │
│  │   - 指数退避: delay = initial * (factor ^ count) │   │
│  │   - 添加抖动 (jitter) 防止雷鸣群效应             │   │
│  │                                                  │   │
│  │ schedule_retry()                                 │   │
│  │   - 检查重试次数限制                              │   │
│  │   - 计算下次重试时间                              │   │
│  │   - 更新数据库记录                                │   │
│  │                                                  │   │
│  │ retry_scheduler_loop()                           │   │
│  │   - 后台定时任务 (每 10 秒)                       │   │
│  │   - 扫描 next_retry_at <= now 的任务             │   │
│  │   - 重置 status = pending 触发重新处理           │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│              任务处理器集成 (tasks_router.py)           │
│  ┌─────────────────────────────────────────────────┐   │
│  │ fail_task(task_id, error, allow_retry=True)     │   │
│  │   if allow_retry:                               │   │
│  │     schedule_retry() → 自动重试                  │   │
│  │   else:                                         │   │
│  │     永久失败                                     │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 实现细节

### 1. 数据库表结构变更

**新增字段**:
```sql
ALTER TABLE aigc_tasks ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE aigc_tasks ADD COLUMN last_retry_at INTEGER;  -- 毫秒时间戳
ALTER TABLE aigc_tasks ADD COLUMN next_retry_at INTEGER;  -- 毫秒时间戳
ALTER TABLE aigc_tasks ADD COLUMN retry_strategy TEXT DEFAULT 'exponential';
```

**新增索引**（优化重试调度器查询）:
```sql
CREATE INDEX idx_aigc_tasks_retry ON aigc_tasks(status, next_retry_at)
WHERE status = 'failed' AND retry_count < max_retries;
```

**迁移文件**:
- `apps/api/src/master_clash/migrations/sqlite/0004_add_retry_fields.sql`
- `apps/api/src/master_clash/migrations/postgres/0004_add_retry_fields.sql`

---

### 2. 重试管理器 (RetryManager)

**文件**: `apps/api/src/master_clash/api/retry_manager.py`

#### 核心功能

##### 2.1 计算重试时间（带抖动）
```python
def calculate_next_retry_time(
    retry_count: int,
    strategy: str = "exponential",
    initial_delay_ms: int = 5000,  # 5秒
    max_delay_ms: int = 300000,    # 5分钟
    backoff_factor: float = 2.0,
    jitter_factor: float = 0.1,    # ±10% 抖动
) -> int:
    """
    计算下次重试时间戳

    策略：
    - exponential: delay = initial * (2 ^ retry_count)
      示例: 5s → 10s → 20s → 40s → 80s → 160s → 300s (cap)
    - linear: delay = initial * (1 + retry_count)
      示例: 5s → 10s → 15s → 20s → 25s → 30s
    - fixed: delay = initial
      示例: 5s → 5s → 5s → 5s → 5s

    抖动：添加随机 ±10% 偏移，防止多个任务同时重试（雷鸣群效应）
    """
    ...
```

**实际延迟示例**（指数退避 + 抖动）:
| 重试次数 | 基础延迟 | 抖动范围 | 实际延迟 |
|---------|---------|---------|---------|
| 1       | 5s      | 4.5s - 5.5s | ~5s |
| 2       | 10s     | 9s - 11s    | ~10s |
| 3       | 20s     | 18s - 22s   | ~20s |
| 4       | 40s     | 36s - 44s   | ~40s |
| 5       | 80s     | 72s - 88s   | ~80s |
| 6+      | 300s (cap) | 270s - 330s | ~300s |

##### 2.2 调度重试
```python
async def schedule_retry(
    task_id: str,
    error_message: str,
    retry_strategy: str = "exponential",
) -> bool:
    """
    调度任务重试或标记为永久失败

    流程：
    1. 检查当前任务状态（防止覆盖已完成任务）
    2. 检查是否超过最大重试次数
    3. 计算下次重试时间
    4. 更新数据库：retry_count++, next_retry_at, status=failed

    返回：
    - True: 重试已调度
    - False: 超过最大重试次数，永久失败
    """
    ...
```

##### 2.3 后台重试调度器
```python
async def retry_scheduler_loop(interval_seconds: int = 10):
    """
    后台循环任务，定期扫描并重试失败任务

    流程：
    1. 每 10 秒查询一次数据库
    2. 查询条件：
       - status = 'failed'
       - retry_count < max_retries
       - next_retry_at <= now
    3. 对每个任务：
       - 重置 status = 'pending'
       - 清除 worker_id, lease
    4. 任务会被正常的任务处理器重新处理
    """
    while True:
        tasks = await get_tasks_ready_for_retry(limit=100)

        for task in tasks:
            await reset_task_for_retry(task["task_id"])
            # 任务重置为 pending 后会被 tasks_router 的处理循环自动处理

        await asyncio.sleep(interval_seconds)
```

---

### 3. 任务处理器集成

**文件**: `apps/api/src/master_clash/api/tasks_router.py`

#### 修改 fail_task() 函数

```python
async def fail_task(task_id: str, error: str, allow_retry: bool = True) -> None:
    """
    标记任务失败，并可选地调度重试

    Args:
        task_id: 任务 ID
        error: 错误消息
        allow_retry: True = 自动重试（默认），False = 永久失败

    行为：
    - allow_retry=True:
      → 调用 schedule_retry()
      → 如果 retry_count < max_retries: 调度重试
      → 如果 retry_count >= max_retries: 永久失败
    - allow_retry=False:
      → 直接标记为永久失败，不重试
    """
    if allow_retry:
        retry_scheduled = await schedule_retry(
            task_id=task_id,
            error_message=error,
            retry_strategy=RETRY_STRATEGY_EXPONENTIAL,
        )

        if retry_scheduled:
            logger.info(f"🔄 Task {task_id} scheduled for retry")
            return

    # 永久失败
    db.execute("UPDATE aigc_tasks SET status = 'failed', ... WHERE task_id = ?", ...)
```

#### 使用示例

```python
# 示例 1: 允许重试（默认）
try:
    result = await generate_image(params)
except Exception as e:
    await fail_task(task_id, str(e), allow_retry=True)  # ✅ 会自动重试

# 示例 2: 不允许重试（用于不可重试的错误）
try:
    validate_params(params)
except ValidationError as e:
    await fail_task(task_id, str(e), allow_retry=False)  # ❌ 永久失败
```

---

### 4. 应用启动集成

**文件**: `apps/api/src/master_clash/api/main.py`

```python
@app.on_event("startup")
async def startup_event():
    """应用启动时初始化"""
    logger.info("🚀 Starting Master Clash API...")

    # 启动重试调度器
    from master_clash.api.retry_manager import start_retry_scheduler
    start_retry_scheduler(interval_seconds=10)
    logger.info("✅ Retry scheduler started")

    # 应用数据库迁移
    from master_clash.database.migrations import apply_migrations
    apply_migrations()
    logger.info("✅ Database migrations applied")
```

---

### 5. 数据库迁移管理器

**文件**: `apps/api/src/master_clash/database/migrations.py`

功能：
- 自动检测并应用未执行的迁移文件
- 维护 `migrations` 表记录已应用的迁移
- 支持 SQLite 和 PostgreSQL

```python
def apply_migrations() -> int:
    """
    应用所有待执行的数据库迁移

    流程：
    1. 检测数据库类型 (sqlite/postgres)
    2. 读取 migrations/{db_type}/*.sql 文件
    3. 检查已应用的迁移（从 migrations 表）
    4. 按文件名排序，依次应用未执行的迁移
    5. 记录到 migrations 表

    返回：应用的迁移数量
    """
    ...
```

---

## 配置参数

### 全局默认配置

```python
# retry_manager.py

DEFAULT_MAX_RETRIES = 3           # 最大重试次数
DEFAULT_INITIAL_DELAY_MS = 5000   # 初始延迟 5 秒
DEFAULT_MAX_DELAY_MS = 300000     # 最大延迟 5 分钟
DEFAULT_BACKOFF_FACTOR = 2.0      # 指数退避因子
DEFAULT_JITTER_FACTOR = 0.1       # 抖动因子 ±10%

SCHEDULER_INTERVAL = 10           # 调度器检查间隔 10 秒
```

### 可调整配置

```python
# 在 create_task() 时设置
await create_task(
    task_id=task_id,
    task_type="image_gen",
    params={...},
    max_retries=5,  # ← 可自定义最大重试次数
)

# 在 fail_task() 时选择是否重试
await fail_task(
    task_id=task_id,
    error="Network timeout",
    allow_retry=True,  # ← 可选择是否允许重试
)
```

---

## 工作流程示例

### 场景 1: 图片生成失败自动重试

```
T0: 用户请求生成图片
    → POST /api/tasks/submit (task_type=image_gen)
    → 创建任务: status=pending, retry_count=0, max_retries=3

T1: 后台处理器开始处理
    → claim_task(task_id) → status=processing

T2: 调用 Gemini API 失败 (429 RESOURCE_EXHAUSTED)
    → fail_task(task_id, "429 error", allow_retry=True)
    → schedule_retry() 被调用:
       - retry_count: 0 → 1
       - next_retry_at: now + 5s (第1次重试)
       - status: failed

T3: 重试调度器检测到 (next_retry_at <= now)
    → reset_task_for_retry(task_id)
    → status: failed → pending
    → 任务重新进入处理队列

T4: 第 2 次处理尝试
    → 如果成功: status=completed ✅
    → 如果失败: 再次调度重试，next_retry_at = now + 10s

T5: 第 3 次重试 (最后一次)
    → 如果成功: status=completed ✅
    → 如果失败: retry_count >= max_retries → 永久失败 ❌
```

### 场景 2: 服务宕机后恢复

```
T0: 任务失败，调度了重试
    → retry_count=1, next_retry_at=<5秒后>

T1: 服务宕机 💥
    → 所有内存数据丢失
    → 但数据库保存了 retry_count 和 next_retry_at

T2: 服务重启 🚀
    → startup_event() 启动 retry_scheduler_loop()

T3: 调度器开始工作 (10 秒后)
    → 查询数据库发现待重试任务
    → 重置任务 status=pending
    → 任务被正常处理 ✅

结论：即使服务宕机，重试状态也不会丢失！
```

---

## 优势总结

### ✅ 持久化
- **重试状态存储在数据库中**
- 服务重启不影响重试计划
- 宕机恢复后自动继续重试

### ✅ 统一管理
- 所有任务类型使用同一套重试机制
- 配置集中在 RetryManager
- 易于监控和调试

### ✅ 智能退避
- 指数退避避免频繁重试
- 添加抖动防止雷鸣群效应
- 最大延迟上限防止无限等待

### ✅ 灵活配置
- 支持多种退避策略 (exponential/linear/fixed)
- 可按任务类型自定义 max_retries
- 可选择性禁用重试 (allow_retry=False)

### ✅ 性能优化
- 数据库索引优化查询
- 批量扫描（每次最多 100 个任务）
- 异步非阻塞处理

---

## 监控与调试

### 日志示例

#### 成功调度重试
```
[RetryManager] Scheduled retry 1: 5.2s delay (strategy: exponential, next: 1737502345678)
[RetryManager] ✅ Scheduled retry 1/3 for task abc123 at 1737502345678 (+5.2s)
[RetryScheduler] 🔄 Retrying task abc123 (type: image_gen, attempt: 1/3)
[RetryScheduler] ✅ Task abc123 queued for retry
```

#### 超过最大重试次数
```
[RetryManager] ❌ Task abc123 exceeded max retries (3/3), marking as permanently failed
```

#### 调度器工作
```
[RetryScheduler] 🚀 Starting retry scheduler (interval: 10s)
[RetryScheduler] Found 5 tasks ready for retry
```

### 数据库查询示例

#### 查看待重试任务
```sql
SELECT task_id, retry_count, max_retries, next_retry_at, error_message
FROM aigc_tasks
WHERE status = 'failed'
  AND retry_count < max_retries
  AND next_retry_at IS NOT NULL
ORDER BY next_retry_at ASC;
```

#### 统计重试情况
```sql
SELECT
  retry_count,
  COUNT(*) as count,
  AVG((next_retry_at - last_retry_at) / 1000.0) as avg_delay_seconds
FROM aigc_tasks
WHERE retry_count > 0
GROUP BY retry_count;
```

---

## 部署清单

### 1. 应用数据库迁移
```bash
cd apps/api
# SQLite
python -m master_clash.database.migrations

# 或在应用启动时自动应用（已配置）
```

### 2. 启动应用
```bash
python -m master_clash.api.main
```

应用启动时会自动：
- ✅ 应用数据库迁移
- ✅ 启动重试调度器

### 3. 验证
```bash
# 检查日志
tail -f backend.log | grep RetryScheduler

# 应该看到：
# [RetryScheduler] 🚀 Starting retry scheduler (interval: 10s)
```

---

## 文件清单

### 新增文件
1. `apps/api/src/master_clash/api/retry_manager.py` - 重试管理器
2. `apps/api/src/master_clash/database/migrations.py` - 迁移管理器
3. `apps/api/src/master_clash/migrations/sqlite/0004_add_retry_fields.sql` - SQLite 迁移
4. `apps/api/src/master_clash/migrations/postgres/0004_add_retry_fields.sql` - PostgreSQL 迁移

### 修改文件
1. `apps/api/src/master_clash/api/tasks_router.py` - 集成重试机制
2. `apps/api/src/master_clash/api/main.py` - 添加启动事件

---

## 下一步建议

### 1. 监控集成
- 添加 Prometheus metrics 监控重试率
- 添加告警：重试失败率 > 50%

### 2. UI 显示
- 前端显示任务重试状态
- 显示重试倒计时

### 3. 手动重试
- 添加 API endpoint 允许手动触发重试
- 允许重置 retry_count

### 4. 配置优化
- 不同任务类型使用不同的重试策略
- 根据错误类型调整重试延迟

---

## 总结

✅ **持久化**: 重试状态存储在数据库，宕机安全
✅ **统一管理**: 所有任务共享同一重试机制
✅ **智能退避**: 指数退避 + 抖动优化
✅ **易于部署**: 自动迁移 + 自动启动
✅ **生产就绪**: 完整的错误处理和日志记录
