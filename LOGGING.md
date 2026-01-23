# 日志配置说明

本项目的三个服务都配置了独立的日志系统，日志文件统一存放在项目根目录的 `.log` 目录下。

## 日志文件位置

```
.log/
├── api.log                 # API 服务日志
├── loro-sync-server.log    # Loro Sync Server 日志
└── web.log                 # Web 前端服务日志
```

**注意：** `.log` 目录已添加到 `.gitignore`，不会提交到版本控制系统。

## 各服务日志配置

### 1. API 服务 (Python/FastAPI)

**配置文件：** `apps/api/src/master_clash/api/main.py`

**日志格式：**
```
%(asctime)s - %(name)s - %(levelname)s - %(message)s
```

**日志级别：** 通过环境变量 `LOG_LEVEL` 配置（默认：INFO）

**输出目标：**
- 文件：`.log/api.log` (UTF-8 编码)
- 控制台：标准输出

**使用示例：**
```python
from master_clash.api.main import logger

logger.info("API server started")
logger.error("Error occurred", exc_info=True)
```

### 2. Loro Sync Server (Cloudflare Workers/TypeScript)

**配置文件：** `apps/loro-sync-server/src/lib/logger.ts`

**日志格式：** JSON 格式（结构化日志）
```json
{
  "timestamp": "2024-01-20T10:00:00.000Z",
  "level": "INFO",
  "module": "loro-sync",
  "requestId": "req-123",
  "message": "Request processed",
  "context": {}
}
```

**环境差异：**
- **本地开发 (wrangler dev)：** 同时输出到控制台和文件（`.log/loro-sync-server.log`）
- **生产环境 (Cloudflare Workers)：** 仅输出到控制台，由 Cloudflare Logpush 收集

**使用示例：**
```typescript
import { createLogger } from './lib/logger';

const logger = createLogger('my-module');

logger.info('Processing request', { requestId: 'req-123' });
logger.error('Error occurred', new Error('Something went wrong'), { context: 'data' });

// 创建子日志器
const childLogger = logger.child('sub-module');
childLogger.debug('Debug message');
```

### 3. Web 服务 (Next.js/TypeScript)

**配置文件：** `apps/web/lib/logger.ts`

**日志格式：** JSON 格式（结构化日志）
```json
{
  "timestamp": "2024-01-20T10:00:00.000Z",
  "level": "INFO",
  "module": "web",
  "message": "Page rendered"
}
```

**环境差异：**
- **服务器端 (SSR/API Routes)：** 同时输出到控制台和文件（`.log/web.log`）
- **客户端 (浏览器)：** 仅输出到浏览器控制台

**使用示例：**
```typescript
import { createLogger, logger } from '@/lib/logger';

// 使用全局日志器
logger.info('Application started');

// 创建模块专用日志器
const pageLogger = createLogger('page:dashboard');
pageLogger.info('Dashboard page rendered', { userId: '123' });

// 错误日志
try {
  // some code
} catch (error) {
  logger.error('Failed to process', error as Error, { context: 'data' });
}
```

## 日志级别

所有服务支持以下日志级别（从低到高）：

- `DEBUG`: 详细的调试信息
- `INFO`: 常规信息消息
- `WARN`: 警告消息
- `ERROR`: 错误消息

## 日志管理

### 查看日志

```bash
# 查看 API 服务日志
tail -f .log/api.log

# 查看 Loro Sync Server 日志
tail -f .log/loro-sync-server.log

# 查看 Web 服务日志
tail -f .log/web.log

# 查看所有日志
tail -f .log/*.log
```

### 清理日志

```bash
# 清理所有日志文件
rm -rf .log/*.log

# 清理特定服务日志
rm .log/api.log
```

### 日志轮转（可选）

对于生产环境，建议配置日志轮转以避免日志文件过大。可以使用 `logrotate` 或类似工具。

**示例 logrotate 配置：**
```
/path/to/clash/.log/*.log {
    daily
    rotate 7
    compress
    delaycompress
    notifempty
    missingok
    copytruncate
}
```

## 环境变量

### API 服务

在 `.env` 文件中配置：

```bash
# 日志级别：DEBUG, INFO, WARN, ERROR
LOG_LEVEL=INFO
```

## 注意事项

1. **敏感信息：** 避免在日志中记录敏感信息（密码、API 密钥、个人数据等）
2. **性能影响：** 在高频路径中使用 DEBUG 级别日志会影响性能，生产环境建议使用 INFO 或更高级别
3. **文件大小：** 定期清理或轮转日志文件，避免磁盘空间占用过大
4. **编码问题：** 所有日志文件使用 UTF-8 编码，确保中文等字符正确显示

## 故障排查

### 日志文件未创建

1. 检查 `.log` 目录是否存在且有写权限
2. 检查服务启动日志是否有错误信息
3. 确认代码中正确导入和使用了日志器

### 日志未写入文件

1. 确认是在服务器端运行（Web 服务客户端代码不写文件）
2. 检查文件系统权限
3. 查看控制台是否有日志写入失败的警告

### Cloudflare Workers 日志

在生产环境中，使用 `wrangler tail` 命令查看实时日志：

```bash
cd apps/loro-sync-server
pnpm tail
```
