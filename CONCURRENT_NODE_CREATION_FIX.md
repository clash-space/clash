# 并发创建节点挂住问题修复

## 问题现象

当Agent并行创建多个节点时（例如7个图片生成节点），系统会挂住：
- 前3个节点成功创建
- 后4个节点丢失
- Loro sync server（Cloudflare Worker）崩溃重启
- Python client无法重连或超时

## 根本原因分析

### 1. **Loro sync server并发导入冲突** ⚠️ 最关键

**位置**: `apps/loro-sync-server/src/LoroRoom.ts:318`

```typescript
// 问题代码：多个WebSocket消息并发到达时，同时修改LoroDoc
private async handleMessage(sender: WebSocket, data: ArrayBuffer) {
  const updates = new Uint8Array(data);
  this.doc.import(updates);  // ❌ 没有并发保护！
}
```

**问题**:
- 7个`create_generation_node`工具几乎同时执行（21:59:42.442-457ms，间隔仅15ms）
- 7个WebSocket消息几乎同时到达Loro sync server
- 7个`handleMessage`并发执行，同时调用`doc.import()`
- **Loro CRDT的import操作不是线程安全的**，导致内部状态冲突
- Worker崩溃并重启

### 2. **Python client发送超时无限等待** 🔥

**位置**: `apps/api/src/master_clash/loro_sync/connection.py:237`

```python
# 问题代码：发送update但不等待结果，没有超时
future = asyncio.run_coroutine_threadsafe(self.ws.send(update), self._ws_loop)
future.add_done_callback(on_done)  # ❌ 只添加callback，不等待！
# 如果WebSocket崩溃，future永远不会完成
```

**问题**:
- 当Worker崩溃时，WebSocket卡在发送状态
- `future.result()` 没有超时，线程永远等待
- 7个并发线程全部挂住

### 3. **Python client重连机制太弱**

**位置**: `apps/api/src/master_clash/loro_sync/connection.py:143`

```python
# 问题代码：只重试3次，Worker重启需要更长时间
async def _auto_reconnect(self, max_retries: int = 3, delay: float = 2.0):
    # 总共只等待 3 * 2 = 6秒
    # Worker重启可能需要10-15秒
```

**问题**:
- Worker重启需要5-15秒
- Python client只重试3次，每次延迟2秒（总共6秒）
- 重连失败后，后续节点创建时`loro_client.connected = False`
- 节点数据只存在Python内存中，没有同步到前端

## 修复方案

### ✅ 修复1: Loro sync server消息队列（最关键）

**文件**: `apps/loro-sync-server/src/LoroRoom.ts`

**改动**:
```typescript
export class LoroRoom {
  // 新增字段
  private messageQueue: Array<{ sender: WebSocket; data: Uint8Array }> = [];
  private isProcessingQueue: boolean = false;

  // 修改handleMessage：入队而不是直接处理
  private async handleMessage(sender: WebSocket, data: ArrayBuffer) {
    const updates = new Uint8Array(data);
    this.messageQueue.push({ sender, data: updates });

    if (!this.isProcessingQueue) {
      this.processMessageQueue();  // 启动串行处理
    }
  }

  // 新增：串行处理队列
  private async processMessageQueue() {
    this.isProcessingQueue = true;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      // 串行import，确保线程安全
      this.doc.import(message.data);
      await processPendingNodes(...);
      this.broadcast(message.data, message.sender);
    }

    this.isProcessingQueue = false;
  }
}
```

**效果**:
- ✅ 所有WebSocket消息进入队列
- ✅ 串行执行`doc.import()`，避免并发冲突
- ✅ Worker不再崩溃
- ✅ 所有7个节点都能成功创建

### ✅ 修复2: Python client发送超时机制

**文件**: `apps/api/src/master_clash/loro_sync/connection.py`

**改动**:
```python
def _send_update(self, update: bytes, timeout_s: float = 5.0):
    """发送更新，带超时机制"""
    future = asyncio.run_coroutine_threadsafe(self.ws.send(update), self._ws_loop)

    try:
        # ✅ 新增：等待发送完成，5秒超时
        future.result(timeout=timeout_s)
        logger.debug("✅ Update sent successfully")
    except TimeoutError:
        logger.error(f"❌ Send timed out after {timeout_s}s")
        self.connected = False  # 标记为断开，触发重连
        raise
    except Exception as e:
        logger.error(f"❌ Error sending: {e}")
        self.connected = False
        raise
```

**效果**:
- ✅ 发送超时5秒后抛出异常，不再无限等待
- ✅ 自动标记`connected = False`，触发重连机制
- ✅ 避免线程永久挂起

### ✅ 修复3: 增强Python client重连机制

**文件**: `apps/api/src/master_clash/loro_sync/connection.py`

**改动**:
```python
async def _auto_reconnect(self, max_retries: int = 10, initial_delay: float = 1.0):
    """增强的重连机制，指数退避"""
    delay = initial_delay
    for attempt in range(max_retries):
        logger.info(f"🔄 Reconnection attempt {attempt + 1}/{max_retries} (delay: {delay:.1f}s)")
        await asyncio.sleep(delay)

        try:
            await self.connect()
            logger.info("✅ Reconnected successfully")
            return
        except Exception as e:
            logger.error(f"❌ Attempt {attempt + 1} failed: {e}")
            delay = min(delay * 2, 30.0)  # 指数退避，最多30秒
```

**效果**:
- ✅ 重试次数: 3次 → 10次
- ✅ 延迟策略: 固定2秒 → 指数退避（1s, 2s, 4s, 8s, 16s, 30s...）
- ✅ 总重试时间: 6秒 → 最长约150秒
- ✅ 能够等待Worker完全重启

## 技术细节

### 为什么Loro需要串行import？

Loro CRDT内部维护了复杂的版本向量和操作历史：
```
Version: {client1: 5, client2: 3, client3: 7}
```

并发import时可能导致：
1. **版本向量冲突**: 两个import同时修改版本号
2. **操作历史乱序**: CRDT依赖因果顺序
3. **内存状态不一致**: JavaScript对象并发修改

### 为什么之前没有超时？

原始代码使用callback模式：
```python
future.add_done_callback(on_done)  # 异步callback，不阻塞
```

问题是当WebSocket崩溃时：
- callback永远不会被调用
- 但代码继续执行，以为发送成功了
- 7个线程同时卡住，资源耗尽

新代码使用同步等待：
```python
future.result(timeout=5.0)  # 阻塞等待，5秒超时
```

好处：
- 立即知道发送是否成功
- 超时后触发重连
- 资源及时释放

## 验证方法

### 测试场景
让Agent并行创建7个图片节点：
```
用户: "生成三只小猪的7个关键场景"
```

### 预期结果
**修复前**:
- ❌ Worker崩溃
- ❌ 只创建3个节点
- ❌ Python client挂住

**修复后**:
- ✅ Worker稳定运行
- ✅ 所有7个节点创建成功
- ✅ 前端实时显示所有节点
- ✅ Python client正常重连（如果需要）

### 日志检查

**成功的日志**应该显示：
```
[LoroRoom] 📥 Processing update from queue (611 bytes, 6 remaining)
[LoroRoom] 📥 Processing update from queue (615 bytes, 5 remaining)
[LoroRoom] 📥 Processing update from queue (618 bytes, 4 remaining)
...
[LoroRoom] 📥 Processing update from queue (612 bytes, 0 remaining)
```

**关键指标**:
- `remaining` 数字递减（队列正常消费）
- 没有Worker重启日志
- 所有节点都收到`✅ Node added`日志

## 额外收益

1. **性能提升**: 消息队列避免了锁竞争，实际上可能比原来更快
2. **容错性增强**: 超时机制让系统自愈能力更强
3. **可观测性**: 队列长度日志帮助监控系统负载

## 后续优化建议

### 短期（可选）
1. **批量处理**: 队列累积到一定数量后批量import
   ```typescript
   if (this.messageQueue.length >= 5) {
     // 批量import 5个updates
   }
   ```

2. **监控告警**: 队列长度超过阈值时告警
   ```typescript
   if (this.messageQueue.length > 50) {
     console.warn("⚠️ Message queue backlog!");
   }
   ```

### 长期（架构）
1. 考虑使用专门的消息队列（如Redis）
2. Worker横向扩展（多个Durable Objects）
3. 前端乐观更新 + 后台同步

## 总结

这次修复解决了3个层次的问题：
1. **根本原因**: Loro并发import冲突 → 消息队列串行化
2. **传播问题**: Python client无限等待 → 5秒超时 + 自动重连
3. **恢复问题**: 重连机制太弱 → 10次重试 + 指数退避

**核心思想**: 分布式系统要假设任何操作都可能失败，必须有超时、重试、降级机制。
