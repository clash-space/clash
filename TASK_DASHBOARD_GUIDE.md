# 任务看板 API 文档

**实现日期**: 2026-01-21

## 概述

任务看板提供了可视化的任务监控和管理界面，展示所有 AIGC 任务的运行状态、失败日志、重试信息等。

---

## API 端点

### 1. 获取任务看板

```http
GET /api/tasks/dashboard
```

**查询参数**:
- `status` (可选): 按状态筛选 (`pending`, `processing`, `completed`, `failed`, `dead`)
- `task_type` (可选): 按任务类型筛选 (`image_gen`, `video_gen`, 等)
- `project_id` (可选): 按项目筛选
- `page` (默认: 1): 页码
- `page_size` (默认: 50, 最大: 100): 每页数量
- `include_stats` (默认: false): 是否包含统计信息

**响应示例**:
```json
{
  "tasks": [
    {
      "task_id": "task_abc123",
      "task_type": "image_gen",
      "status": "completed",
      "project_id": "proj_xyz",
      "node_id": "node_123",
      "created_at": 1737460800000,
      "updated_at": 1737460900000,
      "completed_at": 1737460900000,
      "retry_count": 1,
      "max_retries": 3,
      "next_retry_at": null,
      "error_message": null,
      "worker_id": "worker_abc",
      "result_url": "projects/proj_xyz/generated/task_abc123.png",
      "duration_ms": 100000,
      "retry_status": null
    }
  ],
  "total": 150,
  "page": 1,
  "page_size": 50,
  "stats": {
    "total_tasks": 150,
    "pending": 5,
    "processing": 10,
    "completed": 120,
    "failed": 10,
    "dead": 5,
    "success_rate": 80.0,
    "avg_duration_ms": 95000.5,
    "total_retries": 25,
    "tasks_with_retries": 15
  }
}
```

### 2. 获取任务统计

```http
GET /api/tasks/stats
```

**查询参数**:
- `project_id` (可选): 按项目筛选

**响应示例**:
```json
{
  "total_tasks": 150,
  "pending": 5,
  "processing": 10,
  "completed": 120,
  "failed": 10,
  "dead": 5,
  "success_rate": 80.0,
  "avg_duration_ms": 95000.5,
  "total_retries": 25,
  "tasks_with_retries": 15
}
```

### 3. 获取失败任务列表

```http
GET /api/tasks/failed
```

**查询参数**:
- `project_id` (可选): 按项目筛选
- `include_retrying` (默认: false): 是否包含正在重试的任务（默认只显示永久失败的任务）
- `page` (默认: 1): 页码
- `page_size` (默认: 50, 最大: 100): 每页数量

**响应示例**:
```json
{
  "tasks": [
    {
      "task_id": "task_failed_123",
      "task_type": "video_gen",
      "status": "failed",
      "project_id": "proj_xyz",
      "node_id": "node_456",
      "created_at": 1737460800000,
      "updated_at": 1737461000000,
      "completed_at": null,
      "retry_count": 3,
      "max_retries": 3,
      "next_retry_at": null,
      "error_message": "429 RESOURCE_EXHAUSTED: Quota exceeded",
      "worker_id": null,
      "result_url": null,
      "duration_ms": null,
      "retry_status": "max_retries_exceeded"
    }
  ],
  "total": 15,
  "page": 1,
  "page_size": 50
}
```

---

## Web 界面

### 访问地址

```
http://localhost:8888/dashboard
```

### 功能特性

1. **实时统计卡片**
   - 总任务数
   - 成功率（已完成任务占比）
   - 进行中任务数 / 等待中任务数
   - 失败任务数 / 永久失败任务数
   - 总重试次数 / 重试过的任务数
   - 平均任务耗时

2. **筛选功能**
   - 按状态筛选：pending, processing, completed, failed, dead
   - 按任务类型筛选：image_gen, video_gen, audio_gen, etc.
   - 按项目ID筛选
   - 自动刷新（每10秒）

3. **任务列表**
   - 任务ID（缩写显示）
   - 任务类型
   - 状态徽章（带颜色标识）
   - 项目ID
   - 重试次数（`retry_count / max_retries`）
   - 重试状态徽章：
     - 🔄 重试中
     - ❌ 超过最大重试次数
   - 创建时间
   - 任务耗时（秒）
   - 错误信息（hover 显示完整内容）

4. **分页**
   - 上一页 / 下一页
   - 页码快速跳转
   - 总页数显示

---

## 任务状态说明

| 状态 | 说明 | 颜色 |
|------|------|------|
| `pending` | 等待处理 | 黄色 |
| `processing` | 正在处理 | 蓝色 |
| `completed` | 成功完成 | 绿色 |
| `failed` | 失败（可重试） | 红色 |
| `dead` | 永久失败（超过最大重试次数） | 灰色 |

---

## 重试状态说明

| retry_status | 说明 |
|--------------|------|
| `null` | 任务未失败或未重试 |
| `retrying` | 任务失败，已调度重试 (`retry_count < max_retries` 且 `next_retry_at` 已设置) |
| `max_retries_exceeded` | 任务已达到最大重试次数 (`retry_count >= max_retries`) |
| `permanently_failed` | 任务状态为 `dead`，永久失败 |

---

## 使用场景

### 场景 1: 查看所有失败任务

1. 访问 `/dashboard`
2. 在"状态"下拉框中选择"失败"
3. 点击"查询"按钮
4. 查看失败任务列表，包括错误信息和重试次数

或者直接访问 API:
```bash
curl http://localhost:8888/api/tasks/failed?include_retrying=false
```

### 场景 2: 监控项目任务运行情况

1. 在"项目ID"输入框输入项目ID（如 `b630ef98...`）
2. 点击"查询"按钮
3. 开启"自动刷新"复选框
4. 实时查看该项目的任务运行状态

### 场景 3: 查看正在重试的任务

1. 在"状态"下拉框中选择"失败"
2. 点击"查询"
3. 查看带有 🔄 重试徽章的任务
4. 徽章显示 `retry_count / max_retries`（如 `🔄 2/3`）

### 场景 4: 分析任务性能

1. 访问 `/dashboard`
2. 查看统计卡片：
   - 成功率：`(completed / total) * 100%`
   - 平均耗时：所有已完成任务的平均执行时间
   - 重试率：`tasks_with_retries / total`
3. 根据数据优化任务配置（如调整 `max_retries`、timeout 等）

---

## 数据库字段说明

任务看板使用的数据库字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `task_id` | STRING | 任务唯一标识 |
| `task_type` | STRING | 任务类型 (image_gen, video_gen, 等) |
| `status` | STRING | 任务状态 (pending, processing, completed, failed, dead) |
| `project_id` | STRING | 项目ID |
| `node_id` | STRING | 节点ID（从 params 中提取） |
| `created_at` | INTEGER | 创建时间戳（毫秒） |
| `updated_at` | INTEGER | 更新时间戳（毫秒） |
| `completed_at` | INTEGER | 完成时间戳（毫秒，可为 NULL） |
| `retry_count` | INTEGER | 当前重试次数 |
| `max_retries` | INTEGER | 最大重试次数 |
| `next_retry_at` | INTEGER | 下次重试时间戳（毫秒，可为 NULL） |
| `last_retry_at` | INTEGER | 上次重试时间戳（毫秒，可为 NULL） |
| `error_message` | TEXT | 错误信息 |
| `worker_id` | STRING | 处理该任务的 worker 标识 |
| `result_url` | STRING | 结果 URL（如 R2 key） |
| `lease_expires_at` | INTEGER | 租约过期时间戳（毫秒） |

---

## 性能优化

1. **索引优化**
   - 已创建索引：`idx_aigc_tasks_retry` on `(status, next_retry_at)`
   - 建议添加索引：`CREATE INDEX idx_aigc_tasks_project ON aigc_tasks(project_id, created_at DESC)`

2. **分页查询**
   - 默认每页 50 条记录
   - 最大每页 100 条记录
   - 使用 `LIMIT` 和 `OFFSET` 实现分页

3. **统计缓存**
   - 统计数据计算成本较高
   - 建议添加缓存层（如 Redis）
   - 缓存 TTL 设置为 30 秒

---

## 部署清单

### 1. 确保数据库迁移已应用

```bash
cd apps/api
python -m master_clash.database.migrations
```

### 2. 重启 FastAPI 服务

```bash
uvicorn master_clash.api.main:app --host 0.0.0.0 --port 8888 --reload
```

### 3. 访问任务看板

```bash
# 打开浏览器访问
open http://localhost:8888/dashboard
```

### 4. 验证 API

```bash
# 查看任务统计
curl http://localhost:8888/api/tasks/stats | jq

# 查看任务列表
curl "http://localhost:8888/api/tasks/dashboard?page=1&page_size=10&include_stats=true" | jq

# 查看失败任务
curl "http://localhost:8888/api/tasks/failed?include_retrying=true" | jq
```

---

## 故障排查

### 问题 1: 页面无法访问

**症状**: 访问 `/dashboard` 返回 404

**解决方案**:
1. 检查静态文件目录是否存在：`ls apps/api/src/master_clash/static/`
2. 检查文件是否存在：`ls apps/api/src/master_clash/static/task_dashboard.html`
3. 重启 FastAPI 服务

### 问题 2: API 返回空数据

**症状**: `/api/tasks/dashboard` 返回空列表

**解决方案**:
1. 检查数据库中是否有任务：
   ```sql
   SELECT COUNT(*) FROM aigc_tasks;
   ```
2. 检查筛选条件是否过于严格
3. 检查数据库迁移是否应用

### 问题 3: 统计数据不准确

**症状**: 成功率或平均耗时显示异常

**解决方案**:
1. 检查数据库字段是否正确：
   ```sql
   SELECT task_id, status, created_at, completed_at
   FROM aigc_tasks
   WHERE completed_at IS NOT NULL
   LIMIT 5;
   ```
2. 检查时间戳单位（应为毫秒）
3. 清除浏览器缓存

---

## 扩展功能建议

1. **导出功能**
   - 导出为 CSV/Excel
   - 导出筛选后的任务列表

2. **高级筛选**
   - 按时间范围筛选
   - 按错误类型筛选
   - 按 worker_id 筛选

3. **实时更新**
   - WebSocket 推送任务状态变更
   - 实时统计数据更新

4. **任务操作**
   - 手动重试失败任务
   - 取消正在运行的任务
   - 批量删除任务

5. **可视化图表**
   - 任务状态趋势图
   - 成功率曲线
   - 任务类型分布饼图

---

## 总结

✅ **已实现**:
- 任务列表查询（支持筛选、分页）
- 任务统计（总数、成功率、重试次数等）
- 失败任务列表（带错误信息）
- 可视化 Web 界面
- 自动刷新功能

✅ **功能完整**:
- 失败日志展示
- 重试次数显示
- 运行时间统计
- 状态机保护（防止数据覆盖）

✅ **生产就绪**:
- 性能优化（索引、分页）
- 错误处理
- 响应式设计
- 易于部署
