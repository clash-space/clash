# Workspace Group ID 传递问题分析与解决方案

## 问题描述

当 `task_delegation` subagent 在某个 group 里工作时，`create_generation_node` 创建的节点却出现在 group 外面。

### 问题现象

从截图可以看到：
1. `task_delegation` 的 INPUT 中有 `"workspace_group_id": "sector-cloud-sc"`
2. ConceptArtist subagent 被调用
3. 但是 `create_generation_node` 创建的节点没有在指定的 group 里

## 根本原因分析

### 当前实现流程

1. **在 subagents.py:189-191**：
```python
if workspace_group_id and target.workspace_aware:
    sub_state["workspace_group_id"] = workspace_group_id
```
`workspace_group_id` 被添加到 `sub_state` 字典中。

2. **在 subagents.py:209**：
```python
result = await graph.ainvoke(sub_state, run_config)
```
`sub_state` 被传递给 subagent 的 graph。

3. **在 generation_node.py:110-115**（修复前）：
```python
if parent_id is None:
    workspace_group_id = runtime.state.get("workspace_group_id")
    if workspace_group_id:
        parent_id = workspace_group_id
```
工具通过 `runtime.state.get("workspace_group_id")` 尝试获取 workspace_group_id。

### 问题所在

**核心问题**：`runtime.state` 访问的是 **LangGraph agent 的当前状态**，而这个状态需要通过 LangGraph 的状态管理系统正确传递。

虽然我们在 `sub_state` 中设置了 `workspace_group_id`，但是：
1. LangGraph 的状态是基于 **TypedDict 或 State Schema** 定义的
2. 如果 state schema 中没有包含某个字段，或者状态传递机制有问题，该字段可能在工具调用时丢失
3. `runtime.state` 是在工具执行时从 LangGraph 的状态获取的，而不是直接从 `sub_state` 获取的

## 解决方案

### 方案1：增强调试和日志（✅ 已实现）

**目的**：诊断问题，了解状态传递的具体情况。

**已完成的改动**：

1. **generation_node.py**：添加详细的调试日志
   - 记录 `parent_id` 参数
   - 记录 `workspace_group_id` 从 state 获取的值
   - 记录完整的 `runtime.state.keys()`
   - 如果检测到问题，输出警告

2. **create_node.py**：添加相同的调试日志

3. **subagents.py**：添加状态设置的日志
   - 记录是否添加了 `workspace_group_id` 到 `sub_state`
   - 记录最终的 `sub_state` 内容

**如何使用**：
运行系统后，查看日志输出，了解：
- `workspace_group_id` 是否被正确添加到 `sub_state`
- 工具执行时 `runtime.state` 是否包含 `workspace_group_id`
- 如果不包含，是哪个环节丢失的

### 方案2：硬性限制 - 强制传递 parent_id（推荐短期方案）

**思路**：既然自动从 state 获取可能不可靠，那么让 subagent 在调用工具时**显式传递 `parent_id` 参数**。

#### 2.1 修改 subagent 的 system prompt

修改 `subagents.py` 中的 subagent system prompt，明确要求传递 parent_id：

```python
concept_artist = SubAgent(
    name="ConceptArtist",
    description="Concept artist for visualizing characters and scenes",
    system_prompt="""You are a Concept Artist.
Your goal is to visualize the characters and scenes from the script.

**CRITICAL WORKSPACE RULES:**
- You are working inside a workspace group assigned by the Director.
- **ALWAYS pass parent_id parameter when creating nodes**:
  - The workspace_group_id is available in your state
  - When calling create_generation_node or create_node, ALWAYS use:
    `parent_id="<workspace_group_id>"`
  - Example: create_generation_node(node_type="image_gen", payload={...}, parent_id="sector-cloud-sc")
- **DO NOT create any group nodes** - the Director handles all group organization.
- Only create content nodes: text, image_gen, video_gen.

Tasks:
1. Read the script from the canvas.
2. For each character or scene:
   - Create a PromptActionNode (type='image_gen') with:
     * label: Descriptive name (e.g., "Character: Alice")
     * content: Detailed visual description in Markdown
     * actionType: 'image-gen'
     * **parent_id: The workspace group ID from your context**
   - The node contains both the prompt and generation capability.
3. AFTER creating a generation node, you MUST wait for it to complete before using its result.
   - Use wait_for_generation to check status.
   - If status is 'generating', WAIT and then RETRY.
   - Repeat until status is 'completed'.""",
    tools=[],
    model=model,
    middleware=[canvas_middleware],
    workspace_aware=True,
)
```

#### 2.2 在工具参数描述中强调 parent_id

修改 `CreateGenerationNodeInput` 的 `parent_id` 字段描述：

```python
parent_id: str | None = Field(
    default=None,
    description="Parent group ID. REQUIRED for workspace-aware subagents - use the workspace_group_id from your context. If omitted, will try to auto-detect from state (may fail).",
)
```

#### 优点
- 简单直接，不依赖状态传递机制
- 让 subagent 显式地控制节点的位置
- 不需要修改框架层面的代码

#### 缺点
- 需要修改所有 subagent 的 system prompt
- 增加了 prompt 的复杂度
- 不够优雅（不是自动化的）

### 方案3：修复状态传递机制（推荐长期方案）

**思路**：确保 `workspace_group_id` 能够正确地从 `sub_state` 传递到工具的 `runtime.state`。

#### 3.1 检查 State Schema

确保 LangGraph 的 State Schema 包含 `workspace_group_id` 字段。

在 `middleware.py:48-53` 中已经定义了：
```python
class AgentState:
    """Base agent state schema."""

    messages: Annotated[list[BaseMessage], add_messages]
    project_id: str
    workspace_group_id: str | None  # Optional workspace scope for sub-agents
```

但是需要确认：
1. subagent 编译时使用的是这个 state schema 吗？
2. LangGraph 是否正确处理了这个字段的传递？

#### 3.2 验证 StateGraph 的状态定义

检查 `_compile_subagent` 函数（subagents.py:236-261）：

```python
def _compile_subagent(self, subagent: SubAgent) -> Runnable:
    # Import here to avoid circular dependency
    from langchain.agents import create_agent

    # Compile the sub-agent with its middleware
    graph = create_agent(
        model=subagent.model,
        tools=subagent.tools,
        system_prompt=subagent.system_prompt,
        middleware=list(subagent.middleware) if subagent.middleware else [],
    )

    self._compiled_agents[subagent.name] = graph
    return graph
```

**问题**：`create_agent` 可能没有正确设置 state schema。

**解决方法**：
可能需要显式传递 state schema 或者检查 LangGraph 的默认行为。

#### 3.3 使用 configurable 传递 workspace_group_id（备选方案）

如果 state 传递不可靠，可以通过 `config` 的 `configurable` 字段传递：

在 `subagents.py` 中：
```python
run_config: RunnableConfig = config.copy()
if "configurable" not in run_config:
    run_config["configurable"] = config.get("configurable", {})

# Add workspace_group_id to configurable
if workspace_group_id and target.workspace_aware:
    run_config["configurable"]["workspace_group_id"] = workspace_group_id

result = await graph.ainvoke(sub_state, run_config)
```

然后在工具中：
```python
# Try to get from state first, fallback to config
workspace_group_id_from_state = runtime.state.get("workspace_group_id")
if not workspace_group_id_from_state:
    workspace_group_id_from_state = runtime.config.get("configurable", {}).get("workspace_group_id")
```

#### 优点
- 自动化，不需要修改 prompt
- 更加可靠（config 传递通常比 state 更稳定）
- 优雅的解决方案

#### 缺点
- 需要修改框架层面的代码
- 需要测试以确保不会影响其他功能

### 方案4：在 tool 调用前通过 middleware 注入 parent_id（最优雅的方案）

**思路**：创建一个 middleware，在工具调用前自动注入 `parent_id` 参数。

#### 实现示例

创建一个新的 middleware：

```python
class WorkspaceAwareMiddleware(AgentMiddleware):
    """Middleware that auto-injects parent_id from workspace_group_id."""

    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolCallWrapper],
    ) -> ToolCallWrapper:
        """Auto-inject parent_id from workspace_group_id if not provided."""
        tool_name = request.tool_call.get("name")

        # Only apply to node creation tools
        if tool_name in ["create_node", "create_generation_node"]:
            args = request.tool_call.get("args", {})

            # If parent_id is not provided, try to get from state
            if args.get("parent_id") is None:
                workspace_group_id = request.state.get("workspace_group_id")
                if workspace_group_id:
                    # Inject parent_id into tool args
                    args["parent_id"] = workspace_group_id
                    logger.info(
                        f"[WorkspaceAwareMiddleware] Auto-injected parent_id={workspace_group_id} "
                        f"into {tool_name} call"
                    )

        return handler(request)
```

然后在 subagent 定义时添加这个 middleware：

```python
concept_artist = SubAgent(
    name="ConceptArtist",
    # ...
    middleware=[WorkspaceAwareMiddleware(), canvas_middleware],
    workspace_aware=True,
)
```

#### 优点
- **最优雅**：完全自动化，不需要修改 prompt 或工具代码
- 中心化的逻辑，易于维护
- 不影响其他功能

#### 缺点
- 需要实现新的 middleware
- 需要理解 LangGraph 的 middleware 机制

## 推荐方案

### 短期（立即可用）：
1. **方案1（已完成）** + **方案2**
   - 使用调试日志诊断问题
   - 修改 subagent system prompt，要求显式传递 parent_id
   - 快速解决问题，不需要深入修改框架

### 中期（1-2周）：
2. **方案3.3**
   - 通过 `configurable` 传递 workspace_group_id
   - 作为 fallback 机制，增强可靠性

### 长期（优化和重构）：
3. **方案4**
   - 实现 WorkspaceAwareMiddleware
   - 完全自动化，最优雅的解决方案

## 实施步骤

### 立即执行（方案1 + 方案2）

1. ✅ 添加调试日志（已完成）
2. 运行系统，查看日志，确认问题的具体表现
3. 修改 subagent system prompt，要求显式传递 parent_id
4. 测试验证

### 后续优化（方案3.3 + 方案4）

1. 实现 configurable 传递机制作为 fallback
2. 实现 WorkspaceAwareMiddleware
3. 逐步迁移到自动化方案
4. 简化 system prompt

## 测试验证

### 测试场景

1. **场景1：Director 创建 group，然后 delegate 给 ConceptArtist**
   - 预期：ConceptArtist 创建的节点应该在 group 里

2. **场景2：ConceptArtist 创建多个 image_gen 节点**
   - 预期：所有节点都应该在同一个 workspace group 里

3. **场景3：没有 workspace_group_id 的情况**
   - 预期：节点创建在 root 层级

### 验证方法

1. 查看日志：
   ```
   [task_delegation] Added workspace_group_id to sub_state for ConceptArtist: sector-cloud-sc
   [create_generation_node] Debug - workspace_group_id from state: sector-cloud-sc
   [create_generation_node] Auto-set parent_id from workspace: sector-cloud-sc
   ```

2. 检查数据库/Loro：
   - 查看创建的节点的 `parent_id` 字段
   - 确认节点确实在正确的 group 里

3. 前端验证：
   - 打开 canvas，查看节点的层级关系
   - 确认节点在正确的 group 里

## 总结

问题的根本原因是 **状态传递机制不够可靠**。`workspace_group_id` 虽然被添加到 `sub_state`，但可能没有正确传递到工具的 `runtime.state`。

**推荐的解决路径**：
1. 先用调试日志诊断问题（已完成）
2. 短期使用显式 parent_id 参数（方案2）
3. 中期添加 configurable fallback（方案3.3）
4. 长期实现 WorkspaceAwareMiddleware（方案4）

这样可以**立即解决问题**，同时**逐步优化**到最优雅的方案。
