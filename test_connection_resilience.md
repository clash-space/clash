# 测试连接弹性（验证 SSL 问题已修复）

## 测试 1：验证 TCP Keepalive 生效

### 步骤：
```bash
# 1. 启动 API
cd apps/api
source .venv/bin/activate
uvicorn master_clash.api.main:app --port 8888 --reload

# 2. 在另一个终端监控连接
watch -n 1 'curl -s http://localhost:8888/api/health | jq .database.postgres'

# 3. 等待 30 秒，观察连接池保持健康
```

### 预期结果：
```json
{
  "is_healthy": true,
  "pool_size": 2,        // 应该保持稳定
  "pool_available": 2    // 应该 >= 1
}
```

---

## 测试 2：验证连接回收机制

### 查看日志确认连接定期刷新：
```bash
# 监控连接池事件
tail -f backend.log | grep -E "PostgreSQL connection pool|max_lifetime"
```

### 预期：
30 分钟后，旧连接会被自动关闭和重建（max_lifetime=1800s）

---

## 测试 3：模拟网络中断（高级）

### 使用防火墙规则模拟网络问题：
```bash
# ⚠️ 仅在测试环境使用！

# 1. 查找 Neon 的 IP
nslookup ep-restless-fog-a1orav9n-pooler.ap-southeast-1.aws.neon.tech

# 2. 阻断到该 IP 的连接（需要 sudo）
sudo iptables -A OUTPUT -d 13.228.184.177 -j DROP

# 3. 等待 60 秒（超过 keepalive 超时时间）
sleep 60

# 4. 检查健康状态（应该显示 unhealthy）
curl http://localhost:8888/api/health | jq .database.postgres

# 5. 恢复连接
sudo iptables -D OUTPUT -d 13.228.184.177 -j DROP

# 6. 检查自动恢复（应该在 1-4 秒内恢复）
watch -n 1 'curl -s http://localhost:8888/api/health | jq .database.postgres.is_healthy'
```

### 预期行为：
1. 阻断后：`is_healthy: false`
2. 日志显示：重试机制启动
3. 恢复后：1-4 秒内 `is_healthy: true`

---

## 测试 4：验证重试机制

### 查看重试日志：
```bash
# 临时断网或重启 Neon 数据库（在 Neon 控制台）

# 监控日志
tail -f backend.log | grep -i "retry\|SSL connection"
```

### 预期日志：
```
WARNING - SSL connection error on attempt 1/3: SSL connection has been closed unexpectedly
INFO - Retrying in 1.00s (attempt 1/3)
INFO - PostgreSQL connection pool opened successfully (min=2, max=20)
```

---

## 测试 5：压力测试连接池

### 使用 Apache Bench 测试并发：
```bash
# 安装 ab
sudo apt-get install apache2-utils  # Ubuntu/Debian
# 或
brew install apache2  # macOS

# 发送 100 并发请求
ab -n 1000 -c 100 http://localhost:8888/api/health

# 同时监控连接池
watch -n 1 'curl -s http://localhost:8888/api/health | jq .database.postgres'
```

### 预期：
- `pool_size` 应该从 2 增长到最多 20
- `pool_available` 应该 > 0
- `requests_waiting` 应该 = 0 或很低

---

## 测试 6：验证 Neon Pooler 兼容性

### 检查启动日志：
```bash
# 启动 API 时观察日志
tail -f backend.log | grep -A 5 "PostgreSQL connection pool"
```

### 预期：
✅ **成功日志：**
```
INFO - Added sslmode=require to connection string for production security
INFO - PostgreSQL connection pool opened successfully (min=2, max=20)
INFO - PostgreSQL checkpointer schema initialized successfully
```

❌ **不应该出现：**
```
ERROR: unsupported startup parameter in options: statement_timeout
```

---

## 测试 7：长时间运行测试（可选）

### 让 API 运行 1 小时，观察连接稳定性：
```bash
# 启动 API
uvicorn master_clash.api.main:app --port 8888

# 每分钟检查一次健康状态（运行 1 小时）
for i in {1..60}; do
  echo "Check $i/60"
  curl -s http://localhost:8888/api/health | jq -r '.database.postgres.is_healthy'
  sleep 60
done
```

### 预期：
所有 60 次检查都应该返回 `true`

---

## 问题诊断

### 如果看到 SSL 错误：
```bash
# 1. 检查 keepalive 设置
grep -A 20 "keepalives" apps/api/src/master_clash/database/pg_checkpointer.py

# 2. 检查连接字符串
echo $POSTGRES_CONNECTION_STRING

# 3. 测试直连
psql "$POSTGRES_CONNECTION_STRING" -c "SELECT version();"
```

### 如果看到 Neon pooler 错误：
```bash
# 1. 确认已移除 statement_timeout
grep "statement_timeout" apps/api/src/master_clash/database/pg_checkpointer.py
# 应该只在注释中出现

# 2. 检查是否使用了 pooler 端点
echo $POSTGRES_CONNECTION_STRING | grep pooler
```

---

## 成功标准

✅ 所有测试通过，系统应该：
1. 启动时无 Neon pooler 错误
2. 连接池保持健康（`is_healthy: true`）
3. TCP keepalive 检测死连接
4. 网络中断后自动恢复
5. 30 分钟后自动回收旧连接
6. 并发请求不会耗尽连接池
7. 长时间运行保持稳定

---

## 监控生产环境

### 设置告警（推荐）：
```bash
# 使用 cron 每分钟检查健康状态
*/1 * * * * curl -s http://localhost:8888/api/health | jq -e '.database.postgres.is_healthy == true' || echo "DATABASE UNHEALTHY!" | mail -s "Alert" admin@example.com
```

### 或使用监控服务（更好）：
- **Prometheus + Grafana**
- **Datadog**
- **New Relic**
- **CloudWatch** (if on AWS)

配置健康检查端点：`http://your-api:8888/api/health`
