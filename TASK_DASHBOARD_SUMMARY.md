# 任务看板实现总结

**实现日期**: 2026-01-21
**功能**: 提供可视化的任务监控和管理界面

---

## 已实现的功能

### 1. 后端 API（`apps/api/src/master_clash/api/tasks_router.py`）

#### 1.1 任务看板 API
```http
GET /api/tasks/dashboard
```

**功能**:
- ✅ 任务列表查询（支持分页）
- ✅ 按状态筛选（pending, processing, completed, failed, dead）
- ✅ 按任务类型筛选（image_gen, video_gen, 等）
- ✅ 按项目ID筛选
- ✅ 包含任务详细信息：
  - 任务ID、类型、状态
  - 项目ID、节点ID
  - 创建时间、更新时间、完成时间
  - **重试次数**（`retry_count / max_retries`）
  - **下次重试时间**（`next_retry_at`）
  - **错误信息**（`error_message`）
  - **运行时间**（`duration_ms = completed_at - created_at`）
  - **重试状态**（`retrying`, `max_retries_exceeded`）

#### 1.2 任务统计 API
```http
GET /api/tasks/stats
```

**功能**:
- ✅ 总任务数
- ✅ 各状态任务数（pending, processing, completed, failed, dead）
- ✅ **成功率**（`success_rate = completed / total * 100%`）
- ✅ **平均运行时间**（`avg_duration_ms`）
- ✅ **总重试次数**（`total_retries`）
- ✅ **重试过的任务数**（`tasks_with_retries`）

#### 1.3 失败任务 API
```http
GET /api/tasks/failed
```

**功能**:
- ✅ 查询失败任务列表
- ✅ 支持筛选：
  - `include_retrying=false`: 只显示永久失败的任务（默认）
  - `include_retrying=true`: 包含正在重试的任务
- ✅ 包含详细错误信息和重试状态

---

### 2. Web 界面（`apps/api/src/master_clash/static/task_dashboard.html`）

#### 2.1 统计卡片
- ✅ 总任务数
- ✅ 成功率 + 已完成任务数
- ✅ 进行中 + 等待中任务数
- ✅ 失败任务数 + 永久失败任务数
- ✅ 总重试次数 + 重试过的任务数
- ✅ 平均运行时间（秒）

#### 2.2 筛选功能
- ✅ 按状态筛选
- ✅ 按任务类型筛选
- ✅ 按项目ID筛选
- ✅ 重置筛选按钮
- ✅ **自动刷新**（每10秒，可开关）

#### 2.3 任务列表
- ✅ 任务ID（缩写显示）
- ✅ 任务类型
- ✅ 状态徽章（带颜色区分）
  - 🟡 等待中（pending）
  - 🔵 进行中（processing）
  - 🟢 已完成（completed）
  - 🔴 失败（failed）
  - ⚫ 永久失败（dead）
- ✅ 项目ID
- ✅ **重试次数显示**：
  - 格式：`retry_count / max_retries`
  - 🔄 重试中（retrying）
  - ❌ 超过最大重试次数（max_retries_exceeded）
- ✅ 创建时间
- ✅ 运行时间（秒）
- ✅ **错误信息**（hover 显示完整内容）

#### 2.4 分页
- ✅ 上一页 / 下一页按钮
- ✅ 页码快速跳转
- ✅ 省略号显示（...）
- ✅ 当前页高亮

---

## 访问地址

### Web 界面
```
http://localhost:8888/dashboard
```

### API 端点
```
# 任务统计
GET http://localhost:8888/api/tasks/stats

# 任务列表（默认参数）
GET http://localhost:8888/api/tasks/dashboard?page=1&page_size=50&include_stats=true

# 筛选失败任务
GET http://localhost:8888/api/tasks/dashboard?status=failed&page=1

# 查询特定项目的任务
GET http://localhost:8888/api/tasks/dashboard?project_id=b630ef98...

# 失败任务列表（只显示永久失败）
GET http://localhost:8888/api/tasks/failed?include_retrying=false

# 失败任务列表（包含正在重试的）
GET http://localhost:8888/api/tasks/failed?include_retrying=true
```

---

## 核心功能演示

### 场景 1: 查看所有任务的运行状态

1. 访问 `http://localhost:8888/dashboard`
2. 查看顶部统计卡片：
   - 总任务数：150
   - 成功率：80%（120 已完成）
   - 进行中：10（5 等待中）
   - 失败任务：10（5 永久失败）
   - 重试次数：25（15 任务重试过）
   - 平均耗时：95.0s

### 场景 2: 查看失败任务的错误原因

1. 在"状态"下拉框选择"失败"
2. 点击"查询"
3. 查看任务列表：
   - 任务 `task_abc123`:
     - 状态：🔴 失败
     - 重试：🔄 2/3（retrying）
     - 错误：`429 RESOURCE_EXHAUSTED: Quota exceeded`
   - 任务 `task_def456`:
     - 状态：🔴 失败
     - 重试：❌ 3/3（max_retries_exceeded）
     - 错误：`Network timeout after 30s`

### 场景 3: 监控重试任务

1. 查看失败任务列表
2. 找到带有 🔄 徽章的任务（表示正在重试）
3. 查看"重试"列：`2/3` 表示已重试2次，最多重试3次
4. 开启"自动刷新"，等待任务状态更新

### 场景 4: 分析项目任务成功率

1. 在"项目ID"输入框输入项目ID
2. 点击"查询"
3. 查看该项目的统计数据：
   - 总任务：50
   - 成功率：90%（45 已完成）
   - 失败：5（2 永久失败）
   - 平均耗时：80.5s

---

## 数据库字段说明

任务看板使用的关键字段：

| 字段 | 说明 | 用途 |
|------|------|------|
| `retry_count` | 当前重试次数 | 显示在"重试"列 |
| `max_retries` | 最大重试次数 | 显示在"重试"列 |
| `next_retry_at` | 下次重试时间戳（毫秒） | 判断是否正在重试 |
| `error_message` | 错误信息 | 显示在"错误信息"列 |
| `created_at` | 创建时间戳 | 显示在"创建时间"列 |
| `completed_at` | 完成时间戳 | 计算运行时间 |
| `duration_ms` | 运行时间（毫秒） | `completed_at - created_at` |
| `retry_status` | 重试状态 | `retrying`, `max_retries_exceeded`, `permanently_failed` |

---

## 重试状态说明

| retry_status | 显示 | 条件 |
|--------------|------|------|
| `retrying` | 🔄 2/3 | `status=failed` 且 `retry_count < max_retries` 且 `next_retry_at` 已设置 |
| `max_retries_exceeded` | ❌ 3/3 | `status=failed` 且 `retry_count >= max_retries` |
| `permanently_failed` | ❌ | `status=dead` |
| `null` | - | 任务未失败或未重试 |

---

## 文件清单

### 新增文件
- ✅ `apps/api/src/master_clash/api/tasks_router.py` - 添加了任务看板 API 端点
- ✅ `apps/api/src/master_clash/static/task_dashboard.html` - 任务看板 Web 界面
- ✅ `TASK_DASHBOARD_GUIDE.md` - 完整使用文档
- ✅ `test_task_dashboard.py` - 测试脚本

### 修改文件
- ✅ `apps/api/src/master_clash/api/main.py` - 添加了静态文件服务和 `/dashboard` 路由

---

## 部署步骤

### 1. 确保数据库迁移已应用

```bash
cd apps/api
python -m master_clash.database.migrations
```

### 2. 启动 FastAPI 服务

```bash
uvicorn master_clash.api.main:app --host 0.0.0.0 --port 8888 --reload
```

### 3. 访问任务看板

打开浏览器访问：
```
http://localhost:8888/dashboard
```

### 4. 测试 API

```bash
# 查看任务统计
curl http://localhost:8888/api/tasks/stats | jq

# 查看任务列表
curl "http://localhost:8888/api/tasks/dashboard?page=1&page_size=10&include_stats=true" | jq

# 查看失败任务
curl "http://localhost:8888/api/tasks/failed?include_retrying=true" | jq
```

---

## 使用示例

### cURL 示例

```bash
# 1. 查看所有任务统计
curl -s http://localhost:8888/api/tasks/stats | jq

# 2. 查看第一页任务（每页20条，包含统计）
curl -s "http://localhost:8888/api/tasks/dashboard?page=1&page_size=20&include_stats=true" | jq

# 3. 筛选失败任务
curl -s "http://localhost:8888/api/tasks/dashboard?status=failed&page=1" | jq '.tasks[] | {task_id, retry_count, max_retries, error_message}'

# 4. 查看特定项目的任务
curl -s "http://localhost:8888/api/tasks/dashboard?project_id=b630ef98..." | jq '.tasks[] | {task_id, status, duration_ms}'

# 5. 查看永久失败的任务
curl -s "http://localhost:8888/api/tasks/failed?include_retrying=false" | jq '.tasks[] | {task_id, retry_status, error_message}'
```

### Python 示例

```python
import requests

# 查看任务统计
response = requests.get("http://localhost:8888/api/tasks/stats")
stats = response.json()

print(f"总任务数: {stats['total_tasks']}")
print(f"成功率: {stats['success_rate']}%")
print(f"总重试次数: {stats['total_retries']}")

# 查看失败任务
response = requests.get("http://localhost:8888/api/tasks/failed", params={
    "include_retrying": True,
    "page": 1,
    "page_size": 10
})

tasks = response.json()["tasks"]
for task in tasks:
    print(f"任务: {task['task_id']}")
    print(f"  重试: {task['retry_count']}/{task['max_retries']}")
    print(f"  错误: {task['error_message']}")
```

---

## 总结

✅ **已完成的功能**:
- ✅ 任务列表查询（支持筛选、分页）
- ✅ **失败日志展示**（`error_message` 字段）
- ✅ **错误原因显示**（hover 显示完整错误）
- ✅ **重试次数统计**（`retry_count / max_retries`）
- ✅ **运行时间计算**（`duration_ms`）
- ✅ 任务统计（总数、成功率、平均耗时）
- ✅ 可视化 Web 界面
- ✅ 自动刷新功能

✅ **用户需求满足度**:
> "然后在后端端口透出一个简单的任务看板，给我查看任务运行状态，包括失败的日志，原因，重试次数，运行时间等等。"

- ✅ **任务运行状态**: 显示 pending, processing, completed, failed, dead 五种状态
- ✅ **失败的日志**: `error_message` 字段显示错误信息
- ✅ **失败原因**: hover 显示完整错误内容
- ✅ **重试次数**: `retry_count / max_retries` 显示
- ✅ **运行时间**: `duration_ms` 计算并显示（秒）

🎉 **任务看板已完全实现，可以投入使用！**
