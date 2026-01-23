# Workspace Group ID 传递问题 - 实施总结

## 已完成的改动

### 1. 增强调试日志（方案1）✅

#### 修改的文件：
- `apps/api/src/master_clash/workflow/tools/generation_node.py`
- `apps/api/src/master_clash/workflow/tools/create_node.py`
- `apps/api/src/master_clash/workflow/subagents.py`

#### 改动内容：
1. **subagents.py**：
   - 添加了 `workspace_group_id` 设置的详细日志
   - 记录 `sub_state` 的最终内容
   - 记录是否成功添加 `workspace_group_id` 到子代理状态

2. **generation_node.py**：
   - 添加 `parent_id` 参数的调试日志
   - 记录 `workspace_group_id` 从 state 和 config 获取的值
   - 记录完整的 `runtime.state.keys()`
   - 当检测到问题时输出警告

3. **create_node.py**：
   - 相同的调试日志机制

### 2. Configurable Fallback 机制（方案3.3）✅

#### 核心思路：
通过 `runtime.config.configurable` 传递 `workspace_group_id`，作为 state 传递的可靠 fallback。

#### 改动细节：

**subagents.py:219-225**：
```python
# CRITICAL FIX: Pass workspace_group_id via configurable as a reliable fallback
# This ensures tools can access it even if state propagation fails
if workspace_group_id and target.workspace_aware:
    run_config["configurable"]["workspace_group_id"] = workspace_group_id
    logger.info(
        f"[task_delegation] Added workspace_group_id to run_config.configurable: {workspace_group_id}"
    )
```

**generation_node.py:110-122**：
```python
# Get workspace_group_id from runtime state (with configurable fallback)
workspace_group_id_from_state = runtime.state.get("workspace_group_id")
workspace_group_id_from_config = runtime.config.get("configurable", {}).get("workspace_group_id")

# Use state first, fallback to config
workspace_group_id = workspace_group_id_from_state or workspace_group_id_from_config

# Debug logging
logger.info(f"[create_generation_node] Debug - workspace_group_id from state: {workspace_group_id_from_state}")
logger.info(f"[create_generation_node] Debug - workspace_group_id from config: {workspace_group_id_from_config}")
logger.info(f"[create_generation_node] Debug - final workspace_group_id: {workspace_group_id}")
```

**create_node.py:67-79**：
```python
# Get workspace_group_id from runtime state (with configurable fallback)
workspace_group_id_from_state = runtime.state.get("workspace_group_id")
workspace_group_id_from_config = runtime.config.get("configurable", {}).get("workspace_group_id")

# Use state first, fallback to config
workspace_group_id = workspace_group_id_from_state or workspace_group_id_from_config
```

#### 工作原理：
1. 当 Director 调用 `task_delegation` 时，`workspace_group_id` 被添加到 `sub_state` 和 `run_config.configurable`
2. Subagent 执行时，两个地方都有 `workspace_group_id`
3. 工具函数首先尝试从 `runtime.state` 获取（理想情况）
4. 如果 state 中没有，从 `runtime.config.configurable` 获取（fallback）
5. 这样确保了即使 state 传递失败，仍然能正确获取 `workspace_group_id`

## 测试步骤

### 准备工作

1. 确保所有改动已保存
2. 重启 API 服务：
   ```bash
   cd apps/api
   # 停止当前服务
   # 启动服务并查看日志
   ```

### 测试场景1：基本的 workspace 创建和使用

**目标**：验证 workspace_group_id 能够正确传递到 subagent 的工具调用中。

**步骤**：
1. 在前端创建一个新项目
2. 发送消息：`"创建一个太空探险者角色设计"`
3. Director 应该：
   - 创建一个 group（例如：`group-space-explorer`）
   - 调用 `task_delegation(agent="ConceptArtist", workspace_group_id="group-space-explorer", ...)`
4. ConceptArtist 应该：
   - 创建 image_gen 节点
   - 节点应该自动在 `group-space-explorer` 里面

**预期日志输出**：
```
[task_delegation] Added workspace_group_id to sub_state for ConceptArtist: group-space-explorer
[task_delegation] Added workspace_group_id to run_config.configurable: group-space-explorer
[task_delegation] Final sub_state keys: ['messages', 'project_id', 'workspace_group_id']

[create_generation_node] Debug - parent_id arg: None
[create_generation_node] Debug - workspace_group_id from state: group-space-explorer
[create_generation_node] Debug - workspace_group_id from config: group-space-explorer
[create_generation_node] Debug - final workspace_group_id: group-space-explorer
[create_generation_node] Auto-set parent_id from workspace (state): group-space-explorer
[create_generation_node] Creating image_gen node with parent_id=group-space-explorer
```

**验证**：
- 在前端 canvas 中，检查创建的节点是否在正确的 group 里
- 检查 Loro 数据结构中的 `parentId` 字段

### 测试场景2：State 传递失败的情况（测试 fallback）

**目标**：验证即使 state 传递失败，configurable fallback 仍然能工作。

**如何模拟**：
如果你想测试 fallback 机制，可以临时注释掉 subagents.py:189-191 的代码：
```python
# if workspace_group_id and target.workspace_aware:
#     sub_state["workspace_group_id"] = workspace_group_id
```

然后重新测试场景1。

**预期日志输出**：
```
[create_generation_node] Debug - workspace_group_id from state: None
[create_generation_node] Debug - workspace_group_id from config: group-space-explorer
[create_generation_node] Debug - final workspace_group_id: group-space-explorer
[create_generation_node] Auto-set parent_id from workspace (config): group-space-explorer
```

**验证**：
- 节点仍然应该在正确的 group 里
- 说明 configurable fallback 机制正常工作

### 测试场景3：多个 subagent 依次工作

**目标**：验证多个 subagent 在同一个 workspace 中工作。

**步骤**：
1. 发送消息：`"为《三只小猪》创建故事和角色设计"`
2. Director 应该：
   - 创建 group
   - 先 delegate 给 ScriptWriter
   - 再 delegate 给 ConceptArtist
3. 验证两个 agent 创建的节点都在同一个 group 里

### 测试场景4：检测问题的情况

**目标**：验证当 workspace_group_id 完全缺失时，系统能够检测并警告。

**如何模拟**：
临时注释掉两个地方：
```python
# subagents.py
# if workspace_group_id and target.workspace_aware:
#     sub_state["workspace_group_id"] = workspace_group_id
#     run_config["configurable"]["workspace_group_id"] = workspace_group_id
```

**预期日志输出**：
```
[create_generation_node] ISSUE DETECTED: parent_id is None and workspace_group_id not found in state or config.
This may indicate a state propagation problem in subagent execution.
```

## 日志监控

### 关键日志标识

1. **成功的 workspace 传递**：
   ```
   [task_delegation] Added workspace_group_id to sub_state
   [task_delegation] Added workspace_group_id to run_config.configurable
   [create_generation_node] Auto-set parent_id from workspace (state)
   ```

2. **Fallback 机制启用**：
   ```
   [create_generation_node] Debug - workspace_group_id from state: None
   [create_generation_node] Debug - workspace_group_id from config: <group-id>
   [create_generation_node] Auto-set parent_id from workspace (config)
   ```

3. **问题检测**：
   ```
   [create_generation_node] ISSUE DETECTED: parent_id is None
   ```

### 推荐的日志查看命令

```bash
# 实时查看所有相关日志
tail -f <log-file> | grep -E "(task_delegation|create_generation_node|create_node|workspace_group_id)"

# 只看关键的 workspace 传递日志
tail -f <log-file> | grep "workspace_group_id"

# 查看问题检测日志
tail -f <log-file> | grep "ISSUE DETECTED"
```

## 数据验证

### 检查 Loro 数据结构

创建节点后，检查 Loro CRDT 中的节点数据：

```python
# 在 Python shell 或调试器中
nodes_map = loro_client.doc.get_map("nodes")
node_data = nodes_map.get("<node-id>")

# 检查 parentId
print(node_data.get("parentId"))  # 应该是 group-<something>
```

### 检查数据库

如果使用了持久化存储，检查数据库中的节点记录：

```sql
-- 检查节点的 parent_id
SELECT id, type, label, parent_id
FROM nodes
WHERE project_id = '<project-id>'
ORDER BY created_at DESC
LIMIT 10;
```

## 已知问题和限制

### 当前限制

1. **调试日志过多**：
   - 为了诊断问题，添加了大量的 DEBUG 级别日志
   - 在生产环境中应该调整为 INFO 或更高级别

2. **双重传递**：
   - 目前同时通过 `sub_state` 和 `run_config.configurable` 传递
   - 理论上只需要一个，但为了兼容性和可靠性保留了两种方式

### 后续优化建议

1. **降低日志级别**：
   - 将 "Debug - " 开头的日志改为 `logger.debug()`
   - 只在真正出问题时才输出 WARNING

2. **简化代码**：
   - 确认 configurable 方式稳定后，可以考虑移除 state 方式
   - 或者反过来，如果 state 方式修复后稳定，可以移除 configurable fallback

3. **实现 WorkspaceAwareMiddleware**（方案4）：
   - 最优雅的长期方案
   - 完全自动化，无需修改 prompt 或工具代码

## 回滚方案

如果改动导致问题，可以通过 git 回滚：

```bash
# 查看改动
git diff apps/api/src/master_clash/workflow/

# 回滚所有改动
git checkout apps/api/src/master_clash/workflow/tools/generation_node.py
git checkout apps/api/src/master_clash/workflow/tools/create_node.py
git checkout apps/api/src/master_clash/workflow/subagents.py
```

## 总结

### 完成的工作

1. ✅ 添加了详细的调试日志
2. ✅ 实现了 configurable fallback 机制
3. ✅ 确保 workspace_group_id 能够可靠地传递到工具调用中

### 预期效果

- **问题应该被修复**：subagent 创建的节点现在应该正确地出现在指定的 group 里
- **可诊断性提升**：如果仍然有问题，详细的日志能帮助快速定位原因
- **可靠性提升**：双重传递机制（state + configurable）确保即使一个方式失败，另一个仍然可用

### 下一步

1. **立即测试**：按照上面的测试场景进行验证
2. **查看日志**：确认 workspace_group_id 传递是否正常
3. **反馈结果**：如果仍有问题，提供日志输出以便进一步诊断
4. **考虑实现方案4**（可选）：WorkspaceAwareMiddleware 作为最终的优雅方案
