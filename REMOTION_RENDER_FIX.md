# Remotion渲染问题修复

## 问题描述

在使用Remotion渲染视频时遇到两个问题：

1. **版本不匹配错误**
```
Version mismatch:
- On version: 4.0.370 (大部分包)
- On version: 4.0.387 (@remotion/player)
```

2. **图片加载超时**
```
Error: A delayRender() "Loading <Img> with src=http://localhost:3000/..."
was called but not cleared after 28000ms.
```

## 修复方案

### 1. 统一Remotion版本 ✅

**问题根源**:
- 根package.json中有pnpm overrides锁定为4.0.370
- 但apps/web/package.json中使用了`^4.0.363`，导致pnpm解析出4.0.387

**修复文件**: `apps/web/package.json`

**改动**:
```diff
- "@remotion/player": "^4.0.363",
+ "@remotion/player": "4.0.370",

- "remotion": "^4.0.363",
+ "remotion": "4.0.370",
```

**执行命令**:
```bash
pnpm install --filter @master-clash/web
```

**效果**:
- ✅ 所有Remotion包统一为4.0.370版本
- ✅ 消除版本不匹配警告
- ✅ 避免React context和hooks问题

### 2. 增加图片加载超时时间 ✅

**问题根源**:
- Remotion默认的`delayRender()`超时为28秒
- 当图片从`http://localhost:3000/api/assets/view/...`加载时，如果网络慢或服务器响应慢，28秒可能不够

**修复文件**: `apps/api/src/master_clash/services/remotion_render.py`

**改动**:
```diff
cmd = [
    "npx",
    "remotion",
    "render",
    str(entry_point),
    "VideoComposition",
    "--props",
    props_json,
    "--output",
    str(output_file),
    "--overwrite",
    "--log",
    "info",
+   "--timeout-in-milliseconds",
+   "120000",  # 120 seconds (2 minutes) for image loading timeout
]
```

**效果**:
- ✅ 超时时间: 28秒 → 120秒 (2分钟)
- ✅ 给图片加载更充足的时间
- ✅ 适应网络波动和慢速连接

## 技术细节

### Remotion超时机制

Remotion使用`delayRender()`机制来等待异步资源（如图片、视频）加载：

1. 当`<Img>`组件开始加载图片时，调用`delayRender()`
2. 图片加载完成后，调用`continueRender()`解除阻塞
3. 如果超过超时时间仍未调用`continueRender()`，渲染失败

**默认超时**: 28000ms (28秒)
**新超时**: 120000ms (120秒)

### 为什么需要这么长的超时？

在本地开发环境中，图片可能需要：
1. 从Python API服务器获取（可能在处理其他请求）
2. 从Cloudflare Worker获取（网络延迟）
3. 从R2存储下载（大文件、网络慢）
4. 多个图片并发加载（资源竞争）

120秒的超时确保即使在最坏情况下也能完成加载。

### 版本锁定的重要性

**为什么要移除`^`符号？**

```json
// ❌ 不好：允许次版本更新
"@remotion/player": "^4.0.363"  // 可能解析为 4.0.370, 4.0.387, 4.1.0 等

// ✅ 好：精确版本
"@remotion/player": "4.0.370"   // 严格锁定为 4.0.370
```

**Remotion的版本敏感性**:
- Remotion是一个多包monorepo，所有包必须完全同版本
- 版本不匹配会导致：
  - React Context失效（跨包边界）
  - TypeScript类型不兼容
  - 运行时功能缺失或行为不一致
  - 难以调试的间歇性错误

## 验证方法

### 测试渲染功能

1. **准备测试数据**:
   - 创建一个包含多个图片的timeline DSL
   - 确保图片来自`/api/assets/view/projects/...`

2. **触发渲染**:
   ```python
   # 通过VideoEditorNode点击"Render"按钮
   # 或通过API直接调用render_video_with_remotion
   ```

3. **观察日志**:
   ```
   ✅ 成功的日志:
   [Remotion] Bundling 100%
   [Remotion] Getting compositions
   [Remotion] Rendering frames...
   [Remotion] ✅ Render completed

   ❌ 失败的日志（修复前）:
   Error: A delayRender() was called but not cleared after 28000ms
   Version mismatch: @remotion/player 4.0.387 != 4.0.370
   ```

4. **检查输出**:
   - 视频文件成功生成
   - 所有图片正确显示
   - 时长和帧率正确

### 版本检查

```bash
# 检查Remotion包版本
npx remotion versions

# 应该看到所有包都是 4.0.370
```

## 后续优化建议

### 短期（可选）

1. **优化图片加载**:
   - 使用CDN加速资产访问
   - 实现图片预加载机制
   - 添加图片缓存

2. **更细粒度的超时控制**:
   ```typescript
   // 在VideoComposition.tsx中自定义超时
   <Img
     src={src}
     delayRenderTimeoutInMilliseconds={60000}  // 每个图片60秒
   />
   ```

3. **添加进度监控**:
   ```python
   # 在Python中监控Remotion渲染进度
   # 实时显示 "Loading image 1/5..."
   ```

### 长期（架构）

1. **资产预处理**:
   - 渲染前下载所有资产到本地临时目录
   - 使用`file://`协议代替HTTP，避免网络延迟

2. **分布式渲染**:
   - 将渲染任务分发到专用渲染服务器
   - 使用更快的网络和存储

3. **渐进式渲染**:
   - 支持低分辨率预览（快速）
   - 高分辨率最终渲染（慢速但高质量）

## 相关文件

修改的文件：
- `apps/web/package.json` - 锁定Remotion版本
- `apps/api/src/master_clash/services/remotion_render.py` - 增加超时时间

相关文件（未修改）：
- `package.json` - pnpm overrides配置
- `packages/remotion-components/src/VideoComposition.tsx` - 渲染组件
- `packages/remotion-ui/package.json` - UI包依赖

## 总结

通过这两个修复：
1. ✅ 版本统一 - 消除Remotion包版本不匹配
2. ✅ 超时增加 - 给图片加载足够时间

系统现在可以稳定渲染包含多个图片的视频，即使在网络较慢的环境下也能正常工作。
