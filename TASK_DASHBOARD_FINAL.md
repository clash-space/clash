# 任务看板 - 最终部署指南

**实现日期**: 2026-01-21
**状态**: ✅ 代码完成，等待数据库迁移

---

## 📋 已完成的功能

### 1. 后端 API（3个新端点）

#### `/api/tasks/dashboard` - 任务看板主接口
- ✅ 任务列表查询（支持分页：page, page_size）
- ✅ 筛选功能：
  - 按状态（status: pending, processing, completed, failed, dead）
  - 按任务类型（task_type: image_gen, video_gen, 等）
  - 按项目（project_id）
- ✅ 包含详细信息：
  - **重试次数** (`retry_count / max_retries`)
  - **错误信息** (`error_message`)
  - **运行时间** (`duration_ms = completed_at - created_at`)
  - **重试状态** (`retrying`, `max_retries_exceeded`)

#### `/api/tasks/stats` - 任务统计
- ✅ 总任务数、各状态任务数
- ✅ 成功率（`success_rate = completed / total * 100%`）
- ✅ 平均运行时间（`avg_duration_ms`）
- ✅ 总重试次数、重试过的任务数

#### `/api/tasks/failed` - 失败任务列表
- ✅ 查询失败任务（支持筛选正在重试的任务）
- ✅ 包含详细错误信息和重试状态

### 2. Web 界面

路径：`apps/api/src/master_clash/static/task_dashboard.html`

访问地址：`http://localhost:8888/dashboard`

**功能**：
- ✅ 6个统计卡片（总数、成功率、进行中、失败、重试、平均耗时）
- ✅ 筛选器（状态、类型、项目ID）
- ✅ 任务列表表格（包含重试次数、错误信息、运行时间）
- ✅ 分页控制
- ✅ **自动刷新**（每10秒，可开关）

---

## 🚀 快速部署（3步）

### 步骤 1: 应用数据库迁移

**方法 A: 直接执行 SQL（推荐）**

连接到你的 PostgreSQL 数据库并执行以下 SQL：

```sql
-- 添加重试字段
ALTER TABLE aigc_tasks ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
ALTER TABLE aigc_tasks ADD COLUMN IF NOT EXISTS last_retry_at BIGINT;
ALTER TABLE aigc_tasks ADD COLUMN IF NOT EXISTS next_retry_at BIGINT;
ALTER TABLE aigc_tasks ADD COLUMN IF NOT EXISTS retry_strategy TEXT DEFAULT 'exponential';

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_aigc_tasks_retry ON aigc_tasks(status, next_retry_at)
WHERE status = 'failed' AND retry_count < max_retries;

-- 添加注释
COMMENT ON COLUMN aigc_tasks.retry_count IS 'Number of times this task has been retried';
COMMENT ON COLUMN aigc_tasks.last_retry_at IS 'Timestamp (ms) of last retry attempt';
COMMENT ON COLUMN aigc_tasks.next_retry_at IS 'Timestamp (ms) when task should be retried next';
COMMENT ON COLUMN aigc_tasks.retry_strategy IS 'Retry strategy: exponential (default), linear, or fixed';
```

**方法 B: 使用迁移文件**

迁移文件位置：`apps/api/src/master_clash/migrations/postgres/0004_add_retry_fields.sql`

如果你已安装 `psql`：
```bash
psql "postgresql://your-connection-string" -f apps/api/src/master_clash/migrations/postgres/0004_add_retry_fields.sql
```

### 步骤 2: 验证迁移（可选）

```sql
-- 检查字段是否已添加
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'aigc_tasks'
  AND column_name IN ('retry_count', 'next_retry_at', 'last_retry_at', 'retry_strategy');
```

预期结果：
```
column_name    | data_type | column_default
---------------+-----------+----------------
retry_count    | integer   | 0
last_retry_at  | bigint    | NULL
next_retry_at  | bigint    | NULL
retry_strategy | text      | 'exponential'
```

### 步骤 3: 访问任务看板

迁移完成后，访问：
```
http://localhost:8888/dashboard
```

如果服务正在运行，它会自动重新加载并加载新的端点。

---

## 📊 使用示例

### 示例 1: 查看所有任务统计

访问统计 API：
```bash
curl http://localhost:8888/api/tasks/stats | jq
```

响应示例：
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

### 示例 2: 查看失败任务及其错误原因

访问失败任务 API：
```bash
curl "http://localhost:8888/api/tasks/failed?include_retrying=true" | jq '.tasks[] | {task_id, retry_count, max_retries, error_message}'
```

响应示例：
```json
{
  "task_id": "task_abc123",
  "retry_count": 2,
  "max_retries": 3,
  "error_message": "429 RESOURCE_EXHAUSTED: Quota exceeded"
}
```

### 示例 3: Web 界面查看

1. 访问 `http://localhost:8888/dashboard`
2. 查看顶部统计卡片
3. 在筛选器中选择"失败"状态
4. 点击"查询"查看失败任务列表
5. 在任务列表中查看：
   - 重试次数：🔄 2/3（正在重试）或 ❌ 3/3（超过最大重试）
   - 错误信息：红色文本，hover 显示完整内容

---

## 🔍 功能验证

### 验证 1: API 端点是否可用

```bash
# 测试统计 API
curl http://localhost:8888/api/tasks/stats

# 测试任务列表 API
curl "http://localhost:8888/api/tasks/dashboard?page=1&page_size=10"

# 测试失败任务 API
curl "http://localhost:8888/api/tasks/failed"
```

如果返回 `{"detail":"...not found"}` 错误，说明数据库迁移尚未应用。

### 验证 2: Web 界面是否可访问

访问 `http://localhost:8888/dashboard`

如果返回 404，检查静态文件是否存在：
```bash
ls apps/api/src/master_clash/static/task_dashboard.html
```

---

## 📁 文件清单

### 新增文件
- ✅ `apps/api/src/master_clash/api/tasks_router.py` - 添加了任务看板 API 端点（3个）
- ✅ `apps/api/src/master_clash/static/task_dashboard.html` - 任务看板 Web 界面
- ✅ `apps/api/src/master_clash/migrations/postgres/0004_add_retry_fields.sql` - 数据库迁移文件
- ✅ `TASK_DASHBOARD_GUIDE.md` - 完整使用文档
- ✅ `TASK_DASHBOARD_SUMMARY.md` - 实现总结
- ✅ `TASK_DASHBOARD_DEPLOYMENT.md` - 部署指南
- ✅ `TASK_DASHBOARD_FINAL.md` - 最终部署指南（本文件）
- ✅ `test_task_dashboard.py` - 测试脚本
- ✅ `apply_migration.py` - Python 迁移脚本

### 修改文件
- ✅ `apps/api/src/master_clash/api/main.py` - 添加了静态文件服务和 `/dashboard` 路由

---

## ⚠️ 常见问题

### Q1: 访问 `/api/tasks/stats` 返回 404 或错误

**原因**: 数据库字段缺失（`retry_count` 等字段未添加）

**解决方案**: 应用数据库迁移（步骤 1）

### Q2: 访问 `/dashboard` 返回 404

**原因**: 静态文件路径配置问题

**解决方案**:
1. 检查文件是否存在：`ls apps/api/src/master_clash/static/task_dashboard.html`
2. 重启 FastAPI 服务

### Q3: 任务列表为空

**原因**: 数据库中没有任务数据

**解决方案**:
1. 提交一些 AIGC 任务（通过 `/api/tasks/submit`）
2. 或运行测试脚本创建示例任务：`python3 test_task_dashboard.py`

---

## ✅ 完成清单

部署前检查：

- [x] 代码已实现（API 端点、Web 界面）
- [x] 静态文件已创建（task_dashboard.html）
- [x] 迁移文件已创建（0004_add_retry_fields.sql）
- [x] 文档已创建（GUIDE, SUMMARY, DEPLOYMENT, FINAL）
- [ ] **数据库迁移已应用**（需要手动执行步骤 1）
- [ ] **服务已重启**（如果需要）
- [ ] **功能已验证**（访问 /dashboard 和测试 API）

---

## 🎯 用户需求满足度

> "然后在后端端口透出一个简单的任务看板，给我查看任务运行状态，包括失败的日志，原因，重试次数，运行时间等等。"

**✅ 已完全实现**：

1. **任务运行状态** ✅
   - pending, processing, completed, failed, dead 五种状态
   - 状态徽章（🟡🔵🟢🔴⚫）

2. **失败的日志** ✅
   - `error_message` 字段显示错误信息
   - 红色文本高亮
   - hover 显示完整错误内容

3. **失败原因** ✅
   - 详细的错误信息（如："429 RESOURCE_EXHAUSTED: Quota exceeded"）
   - 支持在 API 和 Web 界面中查看

4. **重试次数** ✅
   - 格式：`retry_count / max_retries`（如：2/3）
   - 带状态徽章：
     - 🔄 正在重试（retrying）
     - ❌ 超过最大重试（max_retries_exceeded）

5. **运行时间** ✅
   - `duration_ms` 字段（毫秒）
   - Web 界面显示为秒（如：95.0s）
   - 统计卡片显示平均运行时间

---

## 🎉 总结

任务看板功能已完全实现，满足所有用户需求。

**下一步操作**：
1. 执行步骤 1 的 SQL 语句，应用数据库迁移
2. 访问 `http://localhost:8888/dashboard` 查看任务看板
3. 享受实时任务监控和管理功能！

**预计完成时间**: 5分钟（执行 SQL + 验证功能）

---

## 📞 支持

如果遇到问题：
1. 检查数据库迁移是否应用成功
2. 检查 FastAPI 服务是否正在运行
3. 查看服务日志：`tail -f .log/api.log`
4. 参考完整文档：`TASK_DASHBOARD_GUIDE.md`
