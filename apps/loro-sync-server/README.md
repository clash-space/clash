# Loro Sync Server

> **Legacy sync-only package.** Current hosted collaboration lives in api-cf's
> `ProjectRoom`; this package is retained for migration evidence. It has no
> Asset upload, raw-key delivery, Resource authority, or R2 binding.

Cloudflare Worker + Durable Objects implementation for real-time Loro CRDT synchronization and AIGC task management.

📐 **[详细架构文档 →](./ARCHITECTURE.md)**

## Architecture

- **Cloudflare Workers**: Serverless request routing
- **Durable Objects**: Stateful WebSocket coordination (one per project)
- **D1 Database**: Persistent snapshot storage + AIGC task queue
- **Loro CRDT**: Conflict-free collaborative editing
- **Cron Triggers**: Automated task polling
- **Task Executors**: Dependency inversion pattern for AIGC service integration

### Task Executor Pattern

The system uses dependency inversion to abstract AIGC service integration:

```
┌──────────────────────────────────────────────────────┐
│          TaskExecutor (Abstract Interface)           │
│  - submit(params): ExecutionResult                   │
│  - poll(externalTaskId): ExecutionResult             │
│  - processWebhook(payload): ExecutionResult          │
└──────────────────┬───────────────────────────────────┘
                   │
         ┌─────────┴─────────┐
         │                   │
┌────────▼─────────┐  ┌──────▼──────────┐
│  KlingExecutor   │  │ GeminiExecutor  │
│  - Async (poll)  │  │ - Sync (direct) │
│  - Webhook       │  │ - No polling    │
└──────────────────┘  └─────────────────┘
```

**Benefits**:

- **Single Responsibility**: Each executor handles one service
- **Extensibility**: Add new AIGC services without modifying core logic
- **Testability**: Mock executors for testing
- **Unified Interface**: Three completion mechanisms work for all services:
  1. Synchronous (immediate results)
  2. Webhook (callback notification)
  3. Polling (Durable Object alarm-based, every 10 seconds per project)

## Features

### Real-time Collaboration

- Real-time WebSocket synchronization via Loro CRDT
- Automatic conflict resolution
- Better Auth session authentication (cookie-based)
- Periodic snapshot persistence (every 5 minutes)
- Auto-scaling per project

### AIGC Task Management

- Unified task queue for video/image generation
- Support for multiple AIGC services (Kling, Gemini, etc.)
- Three completion mechanisms:
  - **Durable Object Alarm**: Automatic polling every 10 seconds (per project)
  - **Webhook**: Instant notification from external services
  - **Manual Query**: REST API for status checks
- Real-time task status updates via Loro CRDT broadcast
- Per-project polling ensures tasks are checked frequently without global overhead

## Setup

### 1. Install Dependencies

```bash
cd apps/loro-sync-server
pnpm install
```

### 2. Create D1 Database (if not exists)

```bash
wrangler d1 create clash-d1
```

### 3. Run Migrations

```bash
wrangler d1 migrations apply clash-d1 --local  # For local dev
wrangler d1 migrations apply clash-d1           # For production
```

Migrations include:

- `0001_create_loro_snapshots.sql` - Loro document snapshots
- `0002_create_aigc_tasks.sql` - AIGC task queue

### 4. Configure Environment Variables

Update `wrangler.toml` with required vars:

```toml
[vars]
BETTER_AUTH_BASE_PATH = "/api/better-auth"

# Optional: AIGC Service API Keys
# Add these to Cloudflare Dashboard > Workers > Settings > Variables (encrypted)
# Or use wrangler secret put command

# For Kling AI video generation
# KLING_ACCESS_KEY = "your-kling-access-key"
# KLING_SECRET_KEY = "your-kling-secret-key"

# For Gemini image generation
# GEMINI_API_KEY = "your-gemini-api-key"
```

**Adding secrets via CLI**:

```bash
# For production
wrangler secret put KLING_ACCESS_KEY
wrangler secret put KLING_SECRET_KEY
wrangler secret put GEMINI_API_KEY

# For local dev, create .dev.vars file:
echo "KLING_ACCESS_KEY=your-key" >> .dev.vars
echo "KLING_SECRET_KEY=your-secret" >> .dev.vars
echo "GEMINI_API_KEY=your-api-key" >> .dev.vars
```

If your Better Auth endpoint is on a different origin (local dev), set:

```toml
[vars]
BETTER_AUTH_ORIGIN = "http://localhost:3000"
```

### 5. Development

```bash
pnpm dev
```

Server will be available at `http://localhost:8787`

### 6. Deploy

```bash
pnpm deploy
```

### Same-Domain Routing (OpenNext + DO)

To share cookies with Better Auth and avoid cross-site WebSocket issues, route both workers under the same hostname:

- `https://your-domain.example/*` → OpenNext worker (apps/web)
- `https://your-domain.example/sync/*` → this worker (apps/loro-sync-server)

This is configured in Cloudflare Workers Routes (or `wrangler` routes) and ensures the WebSocket handshake includes the Better Auth session cookie.

## API Endpoints

### 1. WebSocket Sync

```
wss://your-domain.example/sync/{projectId}
```

**Authentication**: Better Auth session cookie (same-domain).

**Protocol**:

1. Client connects with valid Better Auth session (cookie)
2. Server sends initial document snapshot
3. Client sends binary updates (Loro format)
4. Server broadcasts updates to all connected clients
5. Server periodically saves snapshots to D1

### 2. Task Submission

```http
POST /tasks
Content-Type: application/json

{
  "project_id": "proj_123",
  "task_type": "kling_video",
  "params": {
    "image_path": "path/to/image.png",
    "prompt": "A cat walking",
    "duration": 5
  }
}
```

**Response**:

```json
{
  "task_id": "task_1234567890_abc-123",
  "status": "pending",
  "created_at": 1234567890
}
```

**Supported Task Types**:

- `kling_video` - Kling AI video generation
- `nano_banana` - Gemini 2.5 Flash image generation
- `nano_banana_pro` - Gemini 3 Pro image generation

### 3. Task Status Query

```http
GET /tasks/{taskId}
```

**Response**:

```json
{
  "task_id": "task_1234567890_abc-123",
  "project_id": "proj_123",
  "task_type": "kling_video",
  "status": "completed",
  "external_task_id": "kling_task_xyz",
  "external_service": "kling",
  "result_url": "https://cdn.kling.ai/video.mp4",
  "result_data": "{...}",
  "created_at": 1234567890,
  "updated_at": 1234567891,
  "completed_at": 1234567891,
  "retry_count": 0,
  "max_retries": 3
}
```

### 4. Webhook Callback

```http
POST /webhooks/{service}
Content-Type: application/json

{
  "task_id": "external_task_id",
  "status": "success",
  "result_url": "https://cdn.service.com/result.mp4"
}
```

Supported services: `kling`, `gemini`

### 5. Health Check

```
GET /health
```

Returns `200 OK` if server is running.

## Data Flow

### Real-time Collaboration

```
Client A                 LoroRoom (DO)            Client B
   │                           │                     │
   ├─── WebSocket Connect ────▶│                     │
   │◀─── Initial Snapshot ─────┤                     │
   │                           │                     │
   ├─── Update ───────────────▶│                     │
   │                           ├── Apply CRDT ──────▶│
   │                           │                     │
   │                           ├── Broadcast ───────▶│
   │                           │                     │
   │                           ├─── Save to D1      │
   │                           │    (every 5 min)    │
```

### AIGC Task Management

```
┌─────────────────────┐
│  Backend Agent (Python)  │
└──────────┬──────────┘
           │ 1. POST /tasks
           ▼
┌─────────────────────┐
│  Cloudflare Worker  │
│  - Insert to D1     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────┐
│    D1 Database (aigc_tasks) │
│  - task_id                  │
│  - status: pending          │
│  - params: {...}            │
└──────────┬──────────────────┘
           │
           ▼
    ┌──────────────────────┐
    │  Cron Trigger        │  ◄─── Runs every minute
    │  (scheduled)         │
    └──────┬───────────────┘
           │ 2. Query pending tasks
           ▼
    ┌──────────────────────┐
    │  External API        │
    │  (Kling/Gemini/etc)  │
    └──────┬───────────────┘
           │ 3. Poll status
           ▼
    ┌──────────────────────┐
    │  Update D1:          │
    │  status = completed  │
    │  result_url = ...    │
    └──────┬───────────────┘
           │ 4. Notify LoroRoom
           ▼
    ┌──────────────────────┐
    │  LoroRoom (DO)       │
    │  - Update Loro Doc   │
    │  - Broadcast to WS   │
    └──────┬───────────────┘
           │
           ▼
    ┌──────────────────────┐
    │  Frontend Clients    │
    │  - Receive update    │
    │  - Update UI         │
    └──────────────────────┘
```

## Project Structure

```
apps/loro-sync-server/
├── src/
│   ├── index.ts              # Worker entry point
│   ├── app.ts                # Hono app + routes
│   ├── LoroRoom.ts           # Durable Object (orchestrator)
│   ├── TaskDO.ts             # Task Durable Object
│   ├── types.ts              # TypeScript types
│   ├── generators/           # AIGC generation modules
│   │   ├── DescriptionGenerator.ts
│   │   ├── ImageGeneration.ts
│   │   └── VideoGeneration.ts
│   ├── polling/              # Task polling
│   │   └── TaskPolling.ts
│   ├── processors/           # Node processing
│   │   └── NodeProcessor.ts
│   ├── sync/                 # Loro sync utilities
│   │   └── NodeUpdater.ts
│   ├── routes/               # API routes
│   │   ├── generate.ts
│   │   ├── tasks.ts
│   │   └── webhooks.ts
│   ├── middleware/           # Hono middleware
│   │   ├── error-handler.ts
│   │   └── logger.ts
│   └── lib/                  # Shared libraries
│       └── executor/         # Task executors (Kling, Gemini)
├── migrations/               # D1 migrations
├── wrangler.toml             # Cloudflare config
└── .dev.vars                 # Local env vars
```

## Environment Variables

### Required

- `BETTER_AUTH_BASE_PATH`: Better Auth base path (default `/api/better-auth`)
- `BETTER_AUTH_ORIGIN`: Better Auth origin override (optional, for local dev)
- `ENVIRONMENT`: `development` or `production` (string)

### Optional (AIGC Services)

- `KLING_ACCESS_KEY`: Kling AI access key (string)
- `KLING_SECRET_KEY`: Kling AI secret key (string)
- `GEMINI_API_KEY`: Google Gemini API key (string)

## D1 Database Schema

### loro_snapshots

```sql
CREATE TABLE loro_snapshots (
  project_id TEXT PRIMARY KEY,
  snapshot BLOB NOT NULL,
  version TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### aigc_tasks

```sql
CREATE TABLE aigc_tasks (
  task_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL,
  external_task_id TEXT,
  external_service TEXT,
  params TEXT NOT NULL,
  result_url TEXT,
  result_data TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3
);
```

## Extending with New AIGC Services

The executor pattern makes it easy to add new AIGC services:

### Step 1: Create New Executor

```typescript
// src/executors.ts

export class MyNewServiceExecutor implements TaskExecutor {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || "";
  }

  getServiceName(): ExternalService {
    return "my_service";
  }

  async submit(params: Record<string, any>): Promise<ExecutionResult> {
    // Call external service API
    const response = await fetch("https://api.myservice.com/generate", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(params),
    });

    const result = await response.json();

    // Return sync result or async task ID
    if (result.completed) {
      return {
        completed: true,
        result_url: result.url,
        external_service: "my_service",
      };
    } else {
      return {
        completed: false,
        external_task_id: result.task_id,
        external_service: "my_service",
      };
    }
  }

  async poll(externalTaskId: string): Promise<ExecutionResult> {
    // Poll task status from external service
    const response = await fetch(
      `https://api.myservice.com/tasks/${externalTaskId}`,
    );
    const result = await response.json();

    if (result.status === "completed") {
      return { completed: true, result_url: result.url };
    }
    return { completed: false };
  }

  async processWebhook(payload: any): Promise<ExecutionResult> {
    // Process webhook callback
    return {
      completed: payload.status === "completed",
      result_url: payload.result_url,
      error: payload.error,
    };
  }
}
```

### Step 2: Register Executor

```typescript
// src/executors.ts - Update createExecutorFactory()

export function createExecutorFactory(env?: Env): ExecutorFactory {
  const factory = new ExecutorFactory();

  // Existing executors...
  factory.register('kling_video', new KlingExecutor(...));
  factory.register('nano_banana', new GeminiExecutor(...));

  // Register new executor
  const myServiceExecutor = new MyNewServiceExecutor(env?.MY_SERVICE_API_KEY);
  factory.register('my_new_task_type', myServiceExecutor);

  return factory;
}
```

### Step 3: Update Types

```typescript
// src/types.ts

export type TaskType =
  "kling_video" | "nano_banana" | "nano_banana_pro" | "my_new_task_type";
export type ExternalService = "kling" | "gemini" | "my_service";

export interface Env {
  // ...existing
  MY_SERVICE_API_KEY?: string;
}
```

### Step 4: Done!

The new service now supports all three completion mechanisms automatically:

- ✅ Synchronous execution (if `submit()` returns `completed: true`)
- ✅ Webhook callbacks (via `POST /webhooks/my_service`)
- ✅ Cron polling (via `scheduled()` handler)

## Backend Integration (Python)

### Install Client

```python
# apps/api/src/clash/tools/sync_server_client.py
from clash.tools.sync_server_client import submit_kling_video_task

# Submit task
task_id = submit_kling_video_task(
    project_id="proj_123",
    image_path="./assets/cat.png",
    prompt="A cat walking in a garden",
    duration=5
)

print(f"Task submitted: {task_id}")
# Task will complete asynchronously
# Results broadcast via Loro to all connected clients
```

### Environment Setup

```bash
# In backend/.env
SYNC_SERVER_URL=http://localhost:8787  # or production URL
```

## Troubleshooting

### Issue: WebSocket connection fails

- Check JWT token is valid
- Verify `projectId` in JWT matches URL parameter
- Ensure Better Auth is reachable from this worker (same domain routing or set `BETTER_AUTH_ORIGIN`)

### Issue: Task not processing

- Check Cron Trigger is enabled: `wrangler tail` to see logs
- Verify D1 migrations are applied
- Check external API credentials (Kling, Gemini)

### Issue: Task stuck in pending

- Check retry_count < max_retries
- Verify external service is responding
- Check Cron logs for errors

## Development Notes

- Each project gets a dedicated LoroRoom Durable Object
- Tasks are stored in D1, NOT in Durable Objects
- Cron Trigger polls all pending tasks every minute
- Durable Objects only handle WebSocket connections and broadcasting
- Snapshots are saved every 5 minutes
- Old snapshots are overwritten (single version per project)

## Production Checklist

- [ ] Per-project authorization: ensure `project.owner_id` is set on creation
- [ ] Configure custom domain
- [ ] Set up monitoring and alerts
- [ ] Test with multiple concurrent clients
- [ ] Verify D1 database backups
- [ ] Load test WebSocket connections
- [ ] Review Cloudflare rate limits
- [ ] Configure external API credentials (Kling, Gemini)
- [ ] Set up webhook endpoints for external services
- [ ] Test Cron Trigger in production

## Next Steps

1. ✅ Integrate AIGC task management
2. Frontend Loro integration (`apps/web`)
3. Backend Agent integration (`apps/api`)
4. Timeline integration
5. Awareness (cursor positions, user presence)
6. Encryption for sensitive data
7. Monitoring and logging
