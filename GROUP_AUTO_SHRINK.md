# Group Auto-Shrink Feature

## 概述

在 group 节点内部 relayout 之后，group 会自动调整大小以移除多余的空白空间，同时保持合理的 padding。

## 实现细节

### 新增函数

在 `apps/web/lib/layout/group/auto-scale.ts` 中添加了两个新函数：

#### 1. `shrinkGroupsToFit()`

```typescript
/**
 * 收缩 groups 以紧密包裹其子节点
 * 移除多余的空白空间，同时保持最小 padding
 *
 * @param nodes - 所有节点
 * @param parentId - 要处理的父作用域 (undefined 表示根级别)
 * @param padding - 子节点周围要保持的 padding
 * @returns 更新后的节点数组，包含收缩后的 groups
 */
export function shrinkGroupsToFit(
    nodes: Node[],
    parentId: string | undefined = undefined,
    padding: number = DEFAULT_PADDING
): Node[]
```

**特性：**
- 只处理指定作用域内的 groups
- 根据子节点计算最优大小
- 只收缩，不扩展（如果当前大小小于最优大小，保持不变）
- 尊重用户手动调整的大小

#### 2. `recursiveShrinkGroups()`

```typescript
/**
 * 递归地收缩树中所有 groups 以适应其子节点
 * 从最内层到最外层处理
 *
 * @param nodes - 所有节点
 * @param padding - 子节点周围要保持的 padding
 * @returns 更新后的节点数组，所有 groups 都收缩以适应
 */
export function recursiveShrinkGroups(
    nodes: Node[],
    padding: number = DEFAULT_PADDING
): Node[]
```

**特性：**
- 处理所有嵌套级别的 groups
- 按深度从深到浅处理，确保子 groups 在父 groups 之前调整大小
- 适用于复杂的嵌套场景

### 集成到 Relayout 流程

在 `apps/web/app/components/ProjectEditor.tsx` 的 `relayoutParent` 函数中：

```typescript
const relayoutParent = useCallback(
    (parentId: string | undefined) => {
        setNodes((current) => {
            let updated = [...current];

            // 1. 预处理：确保所有 group 大小足够容纳子节点
            // ... (扩展 groups)

            // 2. 执行 relayout
            updated = relayoutToGrid(updated, {
                gapX: 80,
                gapY: 60,
                centerInCell: false,
                scopeParentId: parentId,
                edges,
                compact: true,
            });

            // 3. 后处理：确保所有子节点仍在边界内
            // ... (再次扩展 groups 如果需要)

            // 4. 新增：收缩 groups 以移除多余空白
            updated = shrinkGroupsToFit(updated, parentId, 40);

            return updated;
        });
    },
    [setNodes, applyAutoZIndex, loroSync, edges]
);
```

## 工作流程

1. **Relayout 前扩展**：确保所有 groups 足够大以容纳其子节点
2. **执行 Relayout**：使用拓扑感知的紧凑布局重新排列节点
3. **Relayout 后扩展**：检查并扩展任何子节点超出边界的 groups
4. **自动收缩**：收缩 groups 以移除多余的空白空间，保持 40px padding

## 配置

- **Padding**: 当前设置为 40px（从默认的 60px 减少以获得更紧凑的布局）
- **最小尺寸**: Groups 保持最小尺寸 200x200px
- **收缩策略**: 只收缩，从不扩展（保护用户手动调整）

## 优势

1. **自动化**: 无需手动调整 group 大小
2. **紧凑**: 移除不必要的空白空间
3. **一致性**: 所有 groups 使用相同的 padding 标准
4. **智能**: 尊重最小尺寸和用户手动调整
5. **嵌套支持**: 正确处理多层嵌套的 groups

## 测试建议

1. 创建一个包含多个节点的 group
2. 对该 group 执行 relayout
3. 观察 group 是否自动收缩以紧密包裹子节点
4. 验证仍保持合理的 padding（40px）
5. 测试嵌套 groups 的场景
