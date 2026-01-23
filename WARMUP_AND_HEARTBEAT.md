# 🛡️ 主动防护机制说明 - Connection Pool Warmup & Heartbeat

## 问题：被动 vs 主动防护

### ❌ 之前的被动防护（不够）

你说得对，之前的方案虽然有 TCP keepalive 和重试，但都是**被动的**：

```
连接断了 → 等下次请求时发现 → 报错 → 重试 → 成功
              ↑                    ↑
           被动检测              用户受影响
```

**问题：**
- 用户第一个请求会失败（虽然会重试，但体验不好）
- 连接断了之后要等到有请求才知道
- 应用启动后第一个请求很慢（要现场建连接）

### ✅ 现在的主动防护（完整）

现在加上了**主动防护**：

```
应用启动 → 立即建好连接并测试 → 后台每60秒ping → 主动发现问题 → 自动修复
           ↑                        ↑                ↑
        预热机制                 心跳机制         用户无感知
```

**好处：**
- 用户请求永远能拿到好的连接
- 问题在后台就被发现和修复了
- 应用启动后连接就ready了

---

## 🔥 新增功能 1：连接池预热（Warmup）

### 作用

应用启动时**立即建立并验证连接**，不等第一个请求来了才建。

### 工作流程

```python
# 应用启动时
1. 打开连接池
2. ⭐ 立即建立 min_size (2个) 连接
3. ⭐ 对每个连接执行 SELECT 1 验证能用
4. ⭐ 如果有问题，立即报错（不是等用户请求时才报错）
5. 全部成功 → 应用ready
```

### 对比

| 情况 | 没有预热 | 有预热 ✅ |
|------|---------|----------|
| 应用启动后 | 连接池是空的 | 2个连接已ready |
| 第一个请求 | 慢（要现场建连接）| 快（直接用现成的） |
| 连接有问题 | 用户请求时才发现 | 启动时就发现 |

### 实现代码

```python
async def warmup_connection_pool():
    """应用启动时就建好连接并验证"""
    # 并发建立 2 个连接
    async def test_connection():
        async with pool.connection() as conn:
            await conn.execute("SELECT 1")  # 验证能用

    # 同时建立多个连接
    await asyncio.gather(*[test_connection() for _ in range(2)])
```

### 启动日志

```
INFO - PostgreSQL connection pool opened successfully (min=2, max=20)
INFO - Warming up connection pool...
INFO - Connection pool warmed up successfully (2 connections ready)
```

---

## ❤️ 新增功能 2：后台心跳（Heartbeat）

### 作用

**主动保持连接活跃**，不等连接断了才发现。

### 为什么需要？

TCP keepalive 是**被动检测**：
- 等连接空闲 30 秒才开始检测
- 检测发现连接断了 → 下次请求时报错 → 重试

心跳是**主动保活**：
- 每 60 秒主动发个查询
- 告诉数据库"我还在用，别断我"
- 发现问题立即修复，用户无感知

### 对比：TCP Keepalive vs 应用心跳

| 机制 | 层级 | 检测方式 | 修复方式 |
|------|------|---------|---------|
| TCP Keepalive | 网络层 | 被动检测（等空闲30s） | 标记连接死亡 |
| 应用心跳 ✅ | 应用层 | 主动探测（每60s查询） | 主动重置连接池 |

**两者配合：**
- TCP keepalive：兜底（防止网络层断连）
- 应用心跳：主动（应用层保活+自动修复）

### 工作流程

```
启动时：
  ↓
启动后台心跳任务
  ↓
每 60 秒循环：
  1. 从连接池获取一个连接
  2. 执行 SELECT 1
  3. 如果成功 → logger.debug("Connection heartbeat: OK")
  4. 如果失败（SSL错误）→ 重置连接池 → 下次心跳会用新连接
  ↓
无限循环（直到应用关闭）
```

### 实现代码

```python
async def connection_heartbeat():
    """后台心跳任务"""
    while True:
        await asyncio.sleep(60)  # 每60秒

        try:
            async with pool.connection() as conn:
                await conn.execute("SELECT 1")
            logger.debug("Connection heartbeat: OK")
        except OperationalError as e:
            # 发现SSL错误 → 立即重置连接池
            if "ssl connection has been closed" in str(e).lower():
                logger.error("SSL connection lost detected by heartbeat, resetting pool")
                await reset_connection_pool()
```

### 心跳日志

```
# 启动时
INFO - Connection pool heartbeat task started

# 运行中（每60秒）
DEBUG - Connection heartbeat: OK
DEBUG - Connection heartbeat: OK
DEBUG - Connection heartbeat: OK

# 发现问题时
WARNING - Connection heartbeat failed (will retry): SSL connection has been closed
ERROR - SSL connection lost detected by heartbeat, resetting pool
INFO - Connection pool reset. Next request will create a fresh pool.

# 修复后
DEBUG - Connection heartbeat: OK  # 用新连接，恢复正常
```

---

## 🔁 新增功能 3：连接获取时重试

### 作用

从连接池获取连接时，如果失败自动重试（不用每次手动写重试代码）。

### 使用方式

```python
# 之前：需要手动处理重试
async with pool.connection() as conn:
    await conn.execute(query)  # 失败就失败了

# 现在：自动重试
async with get_connection_with_retry() as conn:
    await conn.execute(query)  # 失败会自动重试3次
```

### 重试逻辑

```python
for attempt in range(3):
    try:
        async with pool.connection() as conn:
            yield conn
            return  # 成功就返回
    except OperationalError:
        if attempt < 2:
            delay = 0.5 * (2 ** attempt)  # 0.5s, 1s, 2s
            logger.warning(f"Retrying in {delay}s...")

            # SSL错误 → 重置连接池
            if "ssl connection has been closed" in error:
                await reset_connection_pool()

            await asyncio.sleep(delay)
        else:
            raise  # 3次都失败才抛异常
```

---

## 📊 完整防护体系

现在有了**多层防护**：

```
┌─────────────────────────────────────────────────────────┐
│                     用户请求                             │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  第1层：连接获取重试（get_connection_with_retry）        │
│  • 获取连接失败 → 自动重试3次                            │
│  • SSL错误 → 重置连接池 → 用新连接重试                   │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  第2层：连接池预热（warmup_connection_pool）              │
│  • 应用启动时就建好连接                                   │
│  • 用户请求来了直接用，不用等                              │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  第3层：后台心跳（connection_heartbeat）                  │
│  • 每60秒主动ping数据库                                   │
│  • 发现SSL错误 → 立即重置连接池                           │
│  • 在后台修复，用户无感知                                  │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  第4层：TCP Keepalive（被动检测）                         │
│  • 空闲30s后开始探测                                      │
│  • 5次失败 → 标记连接死亡                                 │
│  • 连接池自动移除死连接                                    │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  第5层：连接回收（max_lifetime=1800s）                    │
│  • 30分钟后强制重建连接                                   │
│  • 防止连接过期/SSL session超时                           │
└─────────────────────────────────────────────────────────┘
```

---

## 🎯 实际效果

### 场景 1：应用启动

```
# 没有预热
应用启动 → 连接池空的 → 第一个用户请求 → 现场建连接（慢）→ 返回

# 有预热 ✅
应用启动 → 立即建2个连接 → 第一个用户请求 → 直接用现成连接（快）→ 返回
```

### 场景 2：SSL 连接断开

```
# 只有被动防护
SSL断开 → 等用户请求 → 发现连接断了 → 报错 → 重试 → 成功
           ↑（可能几分钟后）  ↑用户等待

# 有心跳 ✅
SSL断开 → 心跳60s内发现 → 自动重置连接池 → 用户请求时连接已是好的 → 成功
           ↑后台发现            ↑用户无感知
```

### 场景 3：网络抖动

```
# 只有被动防护
网络抖动 → 连接获取失败 → 报错给用户

# 有连接获取重试 ✅
网络抖动 → 连接获取失败 → 自动重试(0.5s) → 成功 → 用户无感知
```

---

## 🔍 如何验证新机制生效？

### 1. 查看启动日志

```bash
# 重启 API
cd apps/api
uvicorn master_clash.api.main:app --port 8888 --reload

# 应该看到这些日志：
INFO - PostgreSQL connection pool opened successfully (min=2, max=20)
INFO - Warming up connection pool...                           # ← 预热开始
INFO - Connection pool warmed up successfully (2 connections ready)  # ← 预热成功
INFO - Connection pool heartbeat task started                  # ← 心跳启动
```

### 2. 查看心跳日志

```bash
# 等待60秒后查看日志
tail -f backend.log | grep -i heartbeat

# 应该每60秒看到：
DEBUG - Connection heartbeat: OK
DEBUG - Connection heartbeat: OK
```

### 3. 测试预热效果

```bash
# 重启 API 后立即发请求（不用等）
curl "http://localhost:8888/api/v1/stream/test?thread_id=test1&user_input=hello"

# 应该立即响应（因为连接已经ready）
```

### 4. 测试心跳修复

```bash
# 模拟网络中断（需要 sudo）
sudo iptables -A OUTPUT -d <neon-ip> -j DROP

# 等待最多 60 秒，心跳会发现问题并重置连接池
tail -f backend.log | grep -i "heartbeat failed"

# 恢复网络
sudo iptables -D OUTPUT -d <neon-ip> -j DROP

# 下次心跳（60s内）会自动恢复
tail -f backend.log | grep -i "heartbeat: OK"
```

---

## 📈 性能影响

### 资源消耗

| 机制 | CPU | 内存 | 网络 |
|------|-----|------|------|
| 预热 | 启动时一次性 | +2个连接 | 启动时2个查询 |
| 心跳 | 每60s一次查询 | 无额外 | 每60s一个SELECT 1 |
| 重试 | 失败时才有 | 无额外 | 失败时重试 |

**总结：** 几乎无影响，但可靠性大幅提升

### 心跳间隔选择

```python
心跳间隔 = 60秒

为什么是60秒？
- 太短（如10s）→ 增加数据库负载
- 太长（如300s）→ 问题发现太慢
- 60s是最佳平衡：
  • 比 TCP keepalive (30s) 要长（避免重复）
  • 足够快发现问题（1分钟内）
  • 对数据库负载几乎无影响
```

---

## 🛠️ 配置选项

如果需要调整，可以修改这些参数：

```python
# apps/api/src/master_clash/database/pg_checkpointer.py

# 预热连接数（默认 min_size=2）
warmup_tasks = [test_connection() for _ in range(2)]

# 心跳间隔（默认 60 秒）
async def connection_heartbeat():
    while True:
        await asyncio.sleep(60)  # ← 改这里

# 连接获取重试次数（默认 3 次）
async def get_connection_with_retry(max_retries: int = 3):
    # ← 改这里
```

---

## ✅ 总结

### 修复前 ❌

- 被动等问题发生
- 用户第一个请求可能失败
- 连接断了要等用户请求才知道

### 修复后 ✅

- **预热：** 应用启动就准备好连接
- **心跳：** 后台主动保活，发现问题立即修复
- **重试：** 连接获取失败自动重试
- **多层防护：** 预热 + 心跳 + 重试 + TCP keepalive + 连接回收

**用户体验：**
- ✅ 第一个请求很快（连接已ready）
- ✅ 网络抖动无感知（自动重试）
- ✅ SSL断开自动恢复（后台心跳修复）
- ✅ 永远拿到健康的连接

---

**这才是真正的"治病"！** 🎉

---

**创建时间：** 2026-01-20
**版本：** 2.0.0（新增主动防护）
**作者：** Antigravity Team
