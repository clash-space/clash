# 层次化布局系统（Hierarchical Layout）

## 概述

新的布局系统采用**层次化结构**，在任何层级（大画布或 group 内部）都遵循统一的布局规则。

## 布局规则

### 基本结构

```
Canvas 或 Group 内部：
┌─────────────┬───────────────────────────────┐
│             │                               │
│   Text      │   散户节点（Assets, Actions）   │
│   Nodes     │   (网格布局)                    │
│   (左列)     │                               │
│   垂直堆叠   ├───────────────────────────────┤
│             │                               │
│             │   Group 1                     │
│             │   ├─ (递归应用相同规则)          │
│             │                               │
│             │   Group 2                     │
│             │   ├─ (递归应用相同规则)          │
│             │                               │
│             │   ...                         │
└─────────────┴───────────────────────────────┘
```

### 详细规则

#### 1. Text 节点
- **位置**: 最左侧列
- **排列**: 垂直堆叠
- **间距**: gapY (默认 60px)
- **优先级**: 最高（总是在最左）

#### 2. 散户节点（非 text、非 group）
- **位置**: text 列右侧，顶部
- **包括**: image、video、audio、action 等
- **排列**: 网格布局（保持行列结构）
- **对齐**: 基于当前位置的行列分组

#### 3. Group 节点
- **位置**: 散户节点下方
- **排列**: 垂直堆叠
- **间距**: gapY (默认 60px)
- **递归**: group 内部应用相同的层次化规则

## 代码实现

### 核心函数：`layoutHierarchical()`

```typescript
function layoutHierarchical(
    siblings: Node[],      // 同一层级的所有节点
    nodes: Node[],         // 全局节点列表
    rectsById: Map<string, RectLike>,
    origin: Point,         // 起始位置
    opts: LayoutOptions,
    edges: Edge[]
): Map<string, Point>
```

### 处理流程

```typescript
// 1. 分类节点
const textNodes = siblings.filter(n => n.type === 'text');
const groupNodes = siblings.filter(n => n.type === 'group');
const otherNodes = siblings.filter(n =>
    n.type !== 'text' && n.type !== 'group'
);

// 2. 布局 text 节点（左列）
let textY = origin.y;
for (const textNode of textNodes) {
    positions.set(textNode.id, { x: origin.x, y: textY });
    textY += nodeHeight + gapY;
}

// 3. 布局散户节点（右上）
// 使用网格布局保持行列结构
const rightX = origin.x + maxTextWidth + gapX * 2;
// ... 行列分组和定位 ...

// 4. 布局 groups（右下）
const groupsY = Math.max(textY, otherNodesMaxY);
let groupYCursor = groupsY;
for (const group of groupNodes) {
    positions.set(group.id, { x: rightX, y: groupYCursor });
    groupYCursor += groupHeight + gapY;
}
```

## 优势

### 1. **清晰的视觉层次**
- Text 节点在左侧，容易快速浏览
- 资产节点在右上，形成工作区
- Groups 在底部，层次分明

### 2. **递归一致性**
- 无论在哪个层级，布局规则完全一致
- Group 内部自动应用相同结构
- 易于理解和预测

### 3. **避免布局混乱**
- 不同类型节点有固定区域
- 不会出现垂直堆叠问题
- 网格保持整齐

### 4. **灵活性**
- 支持任意嵌套深度
- 自动计算尺寸和位置
- 适应不同内容量

## 布局参数

```typescript
{
    gapX: 80,        // 水平间距
    gapY: 60,        // 垂直间距（text 和 group 之间）
    rowOverlapThreshold: 0.25,   // 行重叠阈值
    colOverlapThreshold: 0.25,   // 列重叠阈值
}
```

## 示例场景

### 场景 1：简单画布
```
Input:
- 3 个 text 节点
- 6 个 image 节点
- 2 个 group 节点

Output:
┌─────────┬─────────────┐
│ Text 1  │ Img1  Img2  │
│ Text 2  │ Img3  Img4  │
│ Text 3  │ Img5  Img6  │
│         ├─────────────┤
│         │ Group 1     │
│         │ Group 2     │
└─────────┴─────────────┘
```

### 场景 2：嵌套 Group
```
Group 1 内部:
┌─────────┬─────────────┐
│ Text A  │ Video 1     │
│ Text B  │ Video 2     │
│         ├─────────────┤
│         │ Subgroup 1  │
└─────────┴─────────────┘
```

### 场景 3：只有散户节点（无 text、无 group）
```
┌─────────────────────┐
│ Asset1  Asset2      │
│ Asset3  Asset4      │
│ Asset5              │
└─────────────────────┘
```

## 与之前系统的对比

### 旧系统问题
❌ 没有 edges 时所有节点垂直堆叠
❌ 布局不可预测
❌ Text 和其他节点混在一起
❌ Group 位置不固定

### 新系统优势
✅ 固定的三区布局（text / 散户 / groups）
✅ 完全可预测的布局结果
✅ Text 节点有专属区域
✅ Groups 总是在底部
✅ 递归一致性

## 集成到现有流程

布局在 `relayoutParent()` 中自动触发：

```typescript
const relayoutParent = useCallback((parentId: string | undefined) => {
    setNodes((current) => {
        let updated = [...current];

        // 1. 扩展 groups（确保容纳子节点）
        // ...

        // 2. 执行层次化布局
        updated = relayoutToGrid(updated, {
            gapX: 80,
            gapY: 60,
            scopeParentId: parentId,
            edges,
        });

        // 3. 后处理（扩展、收缩）
        // ...

        return updated;
    });
}, [setNodes, edges]);
```

## 注意事项

1. **Text 宽度**: 左列宽度由最宽的 text 节点决定
2. **Group 尺寸**: Group 的高度在布局时已确定，需提前计算
3. **空白处理**: 如果没有 text 节点，散户节点从 origin.x 开始
4. **递归深度**: 理论上支持无限嵌套，但建议不超过 3 层

## 未来扩展

- [ ] 支持自定义节点类型的布局优先级
- [ ] 支持水平方向的 text 节点排列
- [ ] 支持 group 的水平排列选项
- [ ] 支持更复杂的网格对齐策略

## 测试建议

### 测试用例 1：基本布局
1. 创建 2 个 text、3 个 image、1 个 group
2. 执行 relayout
3. 验证：text 在左，image 在右上网格，group 在右下

### 测试用例 2：嵌套 group
1. 创建 group，内部添加 text 和 image
2. 执行 relayout
3. 验证：group 内部也遵循三区结构

### 测试用例 3：只有一种类型
1. 只创建 text 节点
2. 执行 relayout
3. 验证：text 在左列垂直堆叠

### 测试用例 4：空 group
1. 创建空 group
2. 执行 relayout
3. 验证：group 位置正确，不报错
