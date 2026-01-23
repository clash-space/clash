# Relayout 垂直堆叠问题修复

## 问题描述

当对没有边（edges）连接的 group 内节点执行 relayout 时，所有节点会被垂直堆叠成一列，而不是保持原有的网格布局。

### 问题表现
- **图1（修复前）**: 节点水平、垂直分布，形成自然的网格布局
- **图2（修复后）**: 所有节点垂直堆叠成一列，"硬插进去"

## 根本原因

在 `apps/web/lib/layout/grid/relayout.ts` 中的 `relayoutToGrid` 函数：

### 原始实现的问题

```typescript
// 有 edges：使用拓扑分层
if (options.edges && options.edges.length > 0) {
    // 拓扑分层逻辑...
} else {
    // ❌ 问题：创建一个包含所有节点的单行
    rows = [{
        ids: sortedSiblings.map(n => n.id),
        span: { ... },
        centerY: (minY + maxY) / 2,
    }];
}

// Compact 模式
if (isCompact) {
    // ❌ 问题：将这个"单行"当作"列"处理
    for (let c = 0; c < rows.length; c++) {
        const column = rows[c];  // 所有节点都在这一"列"里
        for (const id of column.ids) {
            // 垂直堆叠所有节点
            nextPosById.set(id, { x: xCursor, y: yCursor });
            yCursor += size.height + opts.gapY;
        }
    }
}
```

**问题逻辑链：**
1. 无 edges → 创建单个 row，包含所有节点
2. Compact 模式 → 将 rows 当作 columns 处理
3. 单个 row → 单个 column → 所有节点垂直堆叠

## 修复方案

### 1. 无 edges 时使用基于位置的行列分组

```typescript
if (options.edges && options.edges.length > 0) {
    // 拓扑分层（工作流场景）
    const siblingIds = siblings.map(n => n.id);
    const layers = topologicalLayering(siblingIds, options.edges);
    rows = layers.map((layerIds) => { ... });
} else {
    // ✅ 修复：使用基于位置的行分组
    rows = assignToRows(siblings, rectsById, {
        gapY: opts.gapY,
        rowOverlapThreshold: opts.rowOverlapThreshold,
    });
}
```

### 2. Compact 模式区分场景

```typescript
// 有 edges + compact：拓扑感知的垂直列布局（适合工作流）
if (isCompact && options.edges && options.edges.length > 0) {
    // 左到右流动，垂直堆叠
    let xCursor = origin.x;
    for (let c = 0; c < rows.length; c++) {
        const column = rows[c];  // 每个拓扑层是一列
        let yCursor = origin.y;
        for (const id of column.ids) {
            nextPosById.set(id, { x: xCursor, y: yCursor });
            yCursor += size.height + opts.gapY;
        }
        xCursor += colWidth + opts.gapX;
    }
}
// ✅ 无 edges + compact：传统网格布局（保持行列结构）
else if (isCompact) {
    // 计算每列宽度和每行高度
    const colWidths = [...];
    const rowHeights = [...];

    // 根据行列网格放置节点
    for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        for (const id of row.ids) {
            const c = colIndexById.get(id) ?? 0;
            const pos: Point = {
                x: colX[c],
                y: rowY[r],
            };
            nextPosById.set(id, pos);
        }
    }
}
```

## 修复效果

### 有 edges（工作流场景）
- ✅ 保持拓扑感知的左到右流动布局
- ✅ 每个拓扑层垂直堆叠（符合工作流视觉习惯）

### 无 edges（普通内容场景）
- ✅ 使用基于位置的行列分组
- ✅ 保持原有的网格布局结构
- ✅ 不会将所有节点强制垂直堆叠

## 应用场景

### 适合拓扑布局（有 edges）
- 数据处理工作流
- 任务依赖图
- 状态机图

### 适合网格布局（无 edges）
- 内容卡片
- 媒体画廊
- 文档章节
- 任何没有明确依赖关系的节点集合

## 文件修改

- `apps/web/lib/layout/grid/relayout.ts`:
  - Line 403-410: 无 edges 时使用 `assignToRows()`
  - Line 425-489: 区分有/无 edges 的 compact 布局逻辑

## 测试建议

1. **无 edges 场景**：
   - 创建一个 group，添加多个没有连接的节点
   - 将节点排列成网格（如 2x3）
   - 执行 relayout
   - ✅ 验证：节点保持网格布局，不会垂直堆叠

2. **有 edges 场景**：
   - 创建一个 group，添加有连接关系的节点
   - 执行 relayout
   - ✅ 验证：节点按拓扑层级左到右排列，每层内垂直堆叠

3. **混合场景**：
   - 部分节点有连接，部分节点无连接
   - 执行 relayout
   - ✅ 验证：布局合理，无异常堆叠
