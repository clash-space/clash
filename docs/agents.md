# Historical: Task System and Agent Architecture

> **Status:** Superseded implementation snapshot. This document describes the
> retired Python task stack, node-owned storage fields, and older frontend sync
> topology; its paths, schemas, status names, and execution flow are not a
> current contract. Use the
> [Asset system](../apps/docs/guide/asset-system.md) for media identity and the
> [Durable Run protocol](../apps/docs/guide/durable-run-protocol.md) for
> Provider/Host execution. Cloud Asset storage and Cloud execution in those
> guides remain design-only.

## Overview

This document provides a comprehensive overview of the task system and agent architecture in the Clash project. The system is designed as a multi-layered architecture that handles AIGC (AI-Generated Content) tasks through atomic execution units, multi-agent workflows, and real-time synchronization.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Task System](#task-system)
3. [Agent System](#agent-system)
4. [Database Schemas](#database-schemas)
5. [Frontend Integration](#frontend-integration)
6. [API Endpoints](#api-endpoints)
7. [Execution Flow](#execution-flow)
8. [Design Patterns](#design-patterns)

---

## Architecture Overview

The system consists of six primary layers:

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend Layer                           │
│  (Loro CRDT Sync + React Flow Canvas)                       │
└──────────────────────┬──────────────────────────────────────┘
                       │ SSE + HTTP
┌──────────────────────▼──────────────────────────────────────┐
│                  Communication Layer                         │
│  (SSE for real-time updates, HTTP for state sync)           │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                    Agent Layer                               │
│  (LangGraph Multi-Agent Workflow + Middleware)               │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                     API Layer                                │
│  (REST endpoints for task submission and tracking)           │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                    Task Layer                                │
│  (Atomic AIGC tasks: image/video/description generation)     │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                  Database Layer                              │
│  (D1/SQLite for task persistence with lease-based exec)      │
└─────────────────────────────────────────────────────────────┘
```

---

## Task System

### Task Types

**Location**: [packages/shared-types/src/tasks.ts](../packages/shared-types/src/tasks.ts)

The system supports three atomic task types:

#### 1. Image Generation (`image_gen`)

Generates images using AI models (Gemini/Nano Banana).

```typescript
ImageGenParams {
  prompt: string                        // Text description of desired image
  model: string                         // Default: 'nano-banana-pro'
  model_params?: Record<string, any>    // Model-specific parameters
  reference_images?: string[]           // Reference images for style/composition
  aspect_ratio?: string                 // Image aspect ratio
}
```

**Supported Models**:
- `nano-banana-pro` (default)
- `gemini-imagen-3`

#### 2. Video Generation (`video_gen`)

Generates videos using Kling AI models.

```typescript
VideoGenParams {
  prompt: string                        // Text description of video content
  image_r2_key?: string                 // Source image for image-to-video
  duration: number | string             // Default: 5 seconds
  model: string                         // Default: 'kling-image2video'
  model_params?: Record<string, any>    // Model-specific parameters
  reference_images?: string[]           // Reference images
  reference_mode?: string               // How to use reference images
  aspect_ratio?: string                 // Video aspect ratio
  negative_prompt?: string              // What to avoid in generation
  cfg_scale?: number                    // Classifier-free guidance scale
}
```

**Supported Models**:
- `kling-image2video` (default)
- `kling-text2video`

#### 3. Description Generation (`description`)

Generates descriptions for existing assets using Gemini Vision.

```typescript
DescriptionParams {
  r2_key: string                        // R2 storage key for asset
  mime_type: string                     // MIME type (image/* or video/*)
}
```

### Task Status Lifecycle

```
pending → processing → completed
                    └→ failed
```

**Status Descriptions**:
- `pending`: Task submitted, waiting for worker
- `processing`: Worker claimed task and is executing
- `completed`: Task finished successfully
- `failed`: Task encountered error

### Lease-Based Execution

To prevent orphan tasks and ensure reliability:

```python
LEASE_DURATION_MS = 3 * 60 * 1000      # 3 minutes
HEARTBEAT_INTERVAL_MS = 30 * 1000      # 30 seconds
WORKER_ID = f"worker_{uuid.uuid4().hex[:8]}"
```

**Mechanism**:
1. Worker claims task by setting `lease_expires_at` timestamp
2. Worker sends heartbeat every 30 seconds to renew lease
3. If worker dies, lease expires and task becomes available for retry
4. Background job scans for expired leases and resets tasks

---

## Agent System

### Multi-Agent Workflow

**Location**: [apps/api/src/clash/workflow/](../apps/api/src/clash/workflow/)

Inspired by the deepagents architecture, the system uses a supervisor-subordinate pattern:

```
Supervisor Agent (Coordinator)
    ├── ScriptWriter          - Creates story outlines and narratives
    ├── ConceptArtist         - Visualizes characters and scenes
    ├── StoryboardDesigner    - Creates shot sequences
    └── Editor                - Assembles final video
```

### Middleware System

**Location**: [apps/api/src/clash/workflow/middleware.py](../apps/api/src/clash/workflow/middleware.py)

Middleware provides composable capabilities to agents:

#### 1. CanvasMiddleware

Provides tools for canvas manipulation:
- `list_nodes()` - List all nodes on canvas
- `create_node()` - Create new nodes
- `wait_for_generation()` - Wait for task completion

#### 2. TimelineMiddleware

Provides tools for video timeline editing:
- `timeline_edit()` - Edit video timeline

#### 3. SubAgentMiddleware

Enables task delegation to specialist agents:
- Route tasks to appropriate subordinate agents
- Aggregate results from multiple agents

### Canvas Backend Protocol

**Location**: [apps/api/src/clash/workflow/backends.py](../apps/api/src/clash/workflow/backends.py)

Two implementations:

#### StateCanvasBackend (Default)
- In-memory state management
- Reads from `get_project_context()`
- Fast, suitable for agent operations

#### APICanvasBackend (Future)
- External API calls
- Suitable for distributed systems
- Not yet implemented

### Canvas Tools

**Location**: [apps/api/src/clash/workflow/tools.py](../apps/api/src/clash/workflow/tools.py)

Available tools for agents:

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_canvas_nodes` | Scan all nodes on canvas | None |
| `read_canvas_node` | Read specific node details | `node_id` |
| `create_canvas_node` | Create text/group nodes | `node_type`, `data` |
| `create_generation_node` | Create PromptActionNode | `prompt`, `action_type` |
| `run_generation_node` | Trigger generation task | `node_id` |
| `wait_for_generation` | Wait for task completion | `node_id`, `timeout` |
| `search_canvas` | Search nodes by content | `query` |

---

## Database Schemas

### AIGC Tasks Table (D1/SQLite)

**Historical note**: this schema belonged to the removed standalone sync Worker. Hosted generation now uses `GenerationWorkflow`; current D1 schema migrations live in [`apps/web/drizzle/`](../apps/web/drizzle/).

```sql
CREATE TABLE aigc_tasks (
  -- Primary identification
  task_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_type TEXT NOT NULL,           -- 'image_gen', 'video_gen', 'description'
  status TEXT NOT NULL,               -- 'pending', 'processing', 'completed', 'failed'

  -- External API tracking
  external_task_id TEXT,              -- ID from external service (Kling, etc.)
  external_service TEXT,              -- 'kling', 'gemini', 'nano_banana'

  -- Task data
  params TEXT NOT NULL,               -- JSON-encoded task parameters
  result_url TEXT,                    -- Final asset URL (R2)
  result_data TEXT,                   -- JSON-encoded result metadata
  error_message TEXT,                 -- Error details if failed

  -- Timestamps
  created_at INTEGER NOT NULL,        -- Unix timestamp (ms)
  updated_at INTEGER NOT NULL,        -- Unix timestamp (ms)
  completed_at INTEGER,               -- Unix timestamp (ms)

  -- Retry tracking
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,

  -- Lease/heartbeat (orphan prevention)
  heartbeat_at INTEGER,               -- Last heartbeat timestamp
  lease_expires_at INTEGER,           -- When lease expires
  worker_id TEXT,                     -- Worker that claimed task
  provider TEXT DEFAULT 'kling'       -- Provider name
);
```

**Indexes**:
- `idx_aigc_tasks_project_id` - Fast project queries
- `idx_aigc_tasks_status` - Status filtering
- `idx_aigc_tasks_external` - External service tracking
- `idx_aigc_tasks_pending` - Find pending tasks efficiently
- `idx_aigc_tasks_lease` - Detect orphan tasks

### PostgreSQL Schema (Session/Agent Tracking)

**Location**: [apps/api/src/clash/database/pg_schema.py](../apps/api/src/clash/database/pg_schema.py)

#### Sessions Table
```sql
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT,
  project_id TEXT,
  created_at TIMESTAMPTZ,
  metadata JSONB
);
```

#### Agents Table
```sql
CREATE TABLE agents (
  agent_id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(session_id),
  agent_type TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status TEXT,
  metadata JSONB
);
```

#### Tool Calls Table
```sql
CREATE TABLE tool_calls (
  tool_call_id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES agents(agent_id),
  tool_name TEXT,
  parameters JSONB,
  result JSONB,
  called_at TIMESTAMPTZ,
  duration_ms INTEGER
);
```

---

## Frontend Integration

### Asset Status Management

**Location**: [apps/web/lib/assetStatus.ts](../apps/web/lib/assetStatus.ts)

```typescript
type AssetStatus = 'uploading' | 'generating' | 'completed' | 'fin' | 'failed'

// Status flow:
// uploading → generating → completed
//           \            \-> failed
//            \-> completed (for direct uploads)
```

### Loro Sync Integration

**Location**: [apps/web/app/hooks/useLoroSync.ts](../apps/web/app/hooks/useLoroSync.ts)

Real-time CRDT-based synchronization:

```typescript
interface UseLoroSyncReturn {
  doc: LoroDoc | null              // Loro document instance
  connected: boolean                // WebSocket connection status

  // Node operations
  addNode: (nodeId: string, nodeData: any) => void
  updateNode: (nodeId: string, nodeData: any) => void
  removeNode: (nodeId: string) => void

  // Edge operations
  addEdge: (edgeId: string, edgeData: any) => void
  updateEdge: (edgeId: string, edgeData: any) => void
  removeEdge: (edgeId: string) => void

  // Undo/Redo
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}
```

**Features**:
- WebSocket connection to sync server
- IndexedDB persistence for offline support
- Automatic conflict resolution via CRDT
- Real-time updates across all clients

### Node Types

**Location**: [apps/web/app/components/ProjectEditor.tsx](../apps/web/app/components/ProjectEditor.tsx)

| Node Type | Component | Description |
|-----------|-----------|-------------|
| `video` | VideoNode | Video asset with playback controls |
| `image` | ImageNode | Image asset with preview |
| `text` | TextNode | Text content block |
| `audio` | AudioNode | Audio asset with waveform |
| `action-badge` | PromptActionNode | Merged prompt + action for generation |
| `group` | GroupNode | Container for organizing nodes |
| `video-editor` | VideoEditorNode | Advanced video editing interface |

---

## API Endpoints

### Task Management API

**Location**: [apps/api/src/clash/api/tasks_router.py](../apps/api/src/clash/api/tasks_router.py)

#### Submit Task

```http
POST /api/tasks/submit

Request Body:
{
  "task_type": "image_gen" | "video_gen" | "image_desc" | "video_desc",
  "project_id": "string",
  "node_id": "string",                    // Optional
  "params": {
    // Task-specific parameters (see Task Types)
  },
  "callback_url": "string"                // Optional
}

Response:
{
  "task_id": "string",
  "status": "pending"
}
```

#### Get Task Status

```http
GET /api/tasks/{task_id}

Response:
{
  "task_id": "string",
  "task_type": "string",
  "status": "pending" | "processing" | "completed" | "failed",
  "result_url": "string",                 // If completed
  "result_data": {                        // If completed
    // Task-specific result data
  },
  "error": "string",                      // If failed
  "project_id": "string",
  "node_id": "string"
}
```

#### Task Heartbeat

```http
POST /api/tasks/{task_id}/heartbeat

Request Body:
{
  "worker_id": "string"
}

Response:
{
  "success": true,
  "lease_expires_at": 1234567890000      // Unix timestamp (ms)
}
```

### Description Generation API

**Location**: [apps/api/src/clash/api/describe_router.py](../apps/api/src/clash/api/describe_router.py)

```http
POST /api/describe/submit
GET /api/describe/{task_id}
```

Same interface as task API, specialized for description generation.

### Generation Models Service

**Location**: [apps/api/src/clash/services/generation_models.py](../apps/api/src/clash/services/generation_models.py)

#### Key Functions

```python
# Synchronous image generation
async def generate_image(
    prompt: str,
    model: str = 'nano-banana-pro',
    model_params: dict = None,
    reference_images: list = None,
    aspect_ratio: str = None
) -> dict:
    """Returns: { 'url': str, 'metadata': dict }"""

# Async video generation (submit)
async def submit_video_job(
    prompt: str,
    image_r2_key: str = None,
    duration: int = 5,
    model: str = 'kling-image2video',
    **kwargs
) -> dict:
    """Returns: { 'external_task_id': str, 'external_service': str }"""

# Async video generation (poll)
async def poll_video_job(
    external_task_id: str,
    external_service: str
) -> dict:
    """Returns: { 'status': str, 'url': str, 'metadata': dict }"""
```

---

## Execution Flow

### 1. Task Submission Flow

```
┌──────────┐
│ Frontend │
└────┬─────┘
     │ POST /api/tasks/submit
     ▼
┌──────────────────┐
│  Task Router     │
│  (FastAPI)       │
└────┬─────────────┘
     │ Create task record
     ▼
┌──────────────────┐
│  D1 Database     │
│  (status=pending)│
└────┬─────────────┘
     │ Background task
     ▼
┌──────────────────┐
│  Task Processor  │
└──────────────────┘
```

### 2. Task Processing Flow

```
┌──────────────────┐
│  Task Processor  │
└────┬─────────────┘
     │ 1. Claim task (set lease)
     ▼
┌──────────────────┐
│  Start heartbeat │
│  (every 30s)     │
└────┬─────────────┘
     │ 2. Process task
     ▼
┌──────────────────┐
│  Generation      │
│  Service         │
└────┬─────────────┘
     │ 3. Upload result to R2
     ▼
┌──────────────────┐
│  Update status   │
│  (completed)     │
└────┬─────────────┘
     │ 4. Callback to sync server
     ▼
┌──────────────────┐
│  Loro Sync       │
│  (update node)   │
└────┬─────────────┘
     │ 5. Cancel heartbeat
     ▼
┌──────────────────┐
│  Frontend        │
│  (SSE update)    │
└──────────────────┘
```

### 3. Agent-Driven Task Generation

```
┌──────────────────┐
│  User Message    │
└────┬─────────────┘
     │ POST /api/v1/chat
     ▼
┌──────────────────┐
│  Supervisor      │
│  Agent           │
└────┬─────────────┘
     │ Delegate tasks
     ├──────────┬──────────┬──────────┐
     ▼          ▼          ▼          ▼
┌─────────┐┌─────────┐┌─────────┐┌─────────┐
│ Script  ││Concept  ││Storybd  ││ Editor  │
│ Writer  ││Artist   ││Designer ││         │
└────┬────┘└────┬────┘└────┬────┘└────┬────┘
     │          │          │          │
     │ create_generation_node()       │
     └──────────┼──────────┴──────────┘
                ▼
┌──────────────────────────────────────┐
│  Canvas Backend                      │
│  (emit SSE proposal)                 │
└────┬─────────────────────────────────┘
     │ Frontend accepts/modifies
     ▼
┌──────────────────────────────────────┐
│  POST /api/tasks/submit              │
│  (internal call)                     │
└────┬─────────────────────────────────┘
     │ Task processing (see above)
     ▼
```

### 4. Real-Time Synchronization

```
┌──────────────┐                    ┌──────────────┐
│  Frontend A  │◄───WebSocket──────►│ Loro Sync    │
└──────────────┘                    │ Server       │
                                    └──────┬───────┘
┌──────────────┐                           │
│  Frontend B  │◄───WebSocket──────────────┤
└──────────────┘                           │
                                           │
┌──────────────┐                           │
│  Backend API │◄───HTTP Callback──────────┘
└──────────────┘   (task completion)
```

**Synchronization Flow**:
1. Frontend maintains authoritative canvas state
2. User edits → Loro doc updates → WebSocket broadcast
3. Task completion → API callback → Loro node update → WebSocket broadcast
4. All clients receive updates via CRDT merge

---

## Design Patterns

### 1. Atomic Task System

**Principle**: Tasks are indivisible units of work.

**Benefits**:
- Simple retry logic
- Clear failure boundaries
- Easy to monitor and debug
- Composable for complex workflows

**Implementation**:
- Each task type has single responsibility
- No nested task dependencies
- Orchestration handled at higher level (agents/workflows)

### 2. Lease-Based Execution

**Principle**: Workers claim exclusive execution rights with time-bound lease.

**Benefits**:
- Prevents duplicate execution
- Automatic failover on worker crash
- No centralized coordination needed
- Simple to implement and reason about

**Implementation**:
```python
# Claim task
UPDATE aigc_tasks
SET lease_expires_at = NOW() + INTERVAL '3 minutes',
    worker_id = 'worker_abc123',
    status = 'processing'
WHERE task_id = '...' AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
```

### 3. SSE + Loro CRDT Sync

**Principle**: Backend proposes changes via SSE, frontend maintains authority via CRDT.

**Benefits**:
- Real-time collaboration
- Automatic conflict resolution
- Optimistic UI updates
- Offline support via IndexedDB

**Implementation**:
- Backend emits SSE events with proposed node updates
- Frontend applies updates to Loro doc
- Loro CRDT merges concurrent changes
- WebSocket broadcasts to all connected clients

### 4. Middleware Composition

**Principle**: Add capabilities to agents via composable middleware layers.

**Benefits**:
- Separation of concerns
- Reusable components
- Easy to test and maintain
- Flexible configuration

**Implementation**:
```python
# Stack middleware
agent = create_agent(model)
agent = CanvasMiddleware(agent, canvas_backend)
agent = TimelineMiddleware(agent, timeline_service)
agent = SubAgentMiddleware(agent, subordinate_agents)
```

### 5. Backend Abstraction

**Principle**: Separate storage interface from implementation.

**Benefits**:
- Swap storage backends without code changes
- Test with in-memory backend
- Support distributed systems
- Gradual migration path

**Implementation**:
```python
class CanvasBackend(ABC):
    @abstractmethod
    async def list_nodes(self) -> list: pass

    @abstractmethod
    async def create_node(self, node_data: dict) -> dict: pass
```

---

## Integration Guidelines

### Adding a New Task Type

1. **Define Schema** ([packages/shared-types/src/tasks.ts](../packages/shared-types/src/tasks.ts)):
   ```typescript
   export const MyTaskParamsSchema = z.object({
     // Define parameters
   })
   ```

2. **Implement Generation Service** ([apps/api/src/clash/services/generation_models.py](../apps/api/src/clash/services/generation_models.py)):
   ```python
   async def generate_my_task(params: dict) -> dict:
       # Implement generation logic
   ```

3. **Add Task Router Handler** ([apps/api/src/clash/api/tasks_router.py](../apps/api/src/clash/api/tasks_router.py)):
   ```python
   async def process_my_task(task_id: str, params: dict):
       # Handle task processing
   ```

4. **Add Frontend Support** ([apps/web/app/components/](../apps/web/app/components/)):
   - Create node component
   - Add to ProjectEditor node types
   - Implement status polling

### Adding a New Agent

1. **Define Agent** ([apps/api/src/clash/workflow/agents/](../apps/api/src/clash/workflow/agents/)):
   ```python
   class MyAgent:
       def __init__(self, model, canvas_backend):
           self.model = model
           self.canvas = canvas_backend
   ```

2. **Register with Supervisor**:
   ```python
   supervisor.add_subordinate('my-agent', MyAgent(...))
   ```

3. **Add Tools** ([apps/api/src/clash/workflow/tools.py](../apps/api/src/clash/workflow/tools.py)):
   ```python
   @tool
   def my_agent_tool(param: str) -> str:
       """Tool description"""
       # Implementation
   ```

---

## Best Practices

### Task Design

1. **Keep tasks atomic**: One task = one generation
2. **Idempotent operations**: Retries should be safe
3. **Explicit parameters**: No implicit dependencies
4. **Clear error messages**: Include actionable context

### Agent Design

1. **Single responsibility**: Each agent has one purpose
2. **Stateless execution**: No shared mutable state
3. **Tool-based interaction**: Agents interact via tools, not direct calls
4. **Graceful degradation**: Handle tool failures gracefully

### Frontend Integration

1. **Optimistic updates**: Update UI immediately, rollback on error
2. **Debounce sync**: Batch Loro updates for performance
3. **Progressive enhancement**: Core functionality without WebSocket
4. **Error boundaries**: Isolate component failures

---

## Troubleshooting

### Common Issues

#### Task Stuck in Processing

**Symptom**: Task status never changes from `processing`.

**Diagnosis**:
```sql
SELECT task_id, lease_expires_at, worker_id, heartbeat_at
FROM aigc_tasks
WHERE status = 'processing' AND lease_expires_at < NOW();
```

**Solution**: Orphan task cleanup job will reset it automatically.

#### Agent Tool Call Fails

**Symptom**: Agent returns error instead of creating node.

**Diagnosis**: Check agent logs for tool execution errors.

**Solution**: Verify middleware stack and backend configuration.

#### Loro Sync Conflicts

**Symptom**: Concurrent edits produce unexpected state.

**Diagnosis**: Check CRDT merge history in browser console.

**Solution**: Loro CRDT automatically resolves conflicts. Ensure clients use same schema version.

---

## Performance Considerations

### Task Processing

- **Heartbeat overhead**: 30-second intervals minimize DB writes
- **Polling frequency**: Video generation polls every 30s (max 30min)
- **Concurrent tasks**: Limited by API rate limits (Kling, etc.)

### Agent Execution

- **Token usage**: Minimize context by using `read_canvas_node()` vs `list_canvas_nodes()`
- **Tool latency**: Async tool execution prevents blocking
- **State caching**: StateCanvasBackend caches project context

### Frontend Sync

- **WebSocket bandwidth**: ~1KB per node update
- **IndexedDB size**: Scales linearly with canvas size
- **Render performance**: React Flow handles 100+ nodes efficiently

---

## Future Roadmap

### Planned Features

1. **Distributed Task Queue**: Replace lease-based system with Redis queue
2. **Advanced Retry Logic**: Exponential backoff, jitter
3. **Task Dependencies**: Support DAG-based workflows
4. **Agent Memory**: Persistent memory across sessions
5. **APICanvasBackend**: External API integration
6. **Batch Operations**: Submit multiple tasks atomically

### Architecture Evolution

```
Current:  Single-server → D1 → Worker threads
Future:   API Gateway → Redis Queue → Worker pool → PostgreSQL
```

---

## References

- [Loro CRDT Documentation](./loro-crdt-explained.md)
- [Kling Video Generation Guide](../apps/api/docs/kling_video_guide.md)
- [D1 Integration Guide](../apps/api/docs/D1_INTEGRATION.md)
- [Deployment Guide](../apps/api/docs/DEPLOYMENT.md)

---

## Appendix: Code Locations

### Backend

- **Task Router**: [apps/api/src/clash/api/tasks_router.py](../apps/api/src/clash/api/tasks_router.py)
- **Task Processor**: [apps/api/src/clash/services/task_processor.py](../apps/api/src/clash/services/task_processor.py)
- **Generation Service**: [apps/api/src/clash/services/generation_models.py](../apps/api/src/clash/services/generation_models.py)
- **Agent System**: [apps/api/src/clash/workflow/](../apps/api/src/clash/workflow/)
- **Database Schema**: [apps/api/src/clash/database/](../apps/api/src/clash/database/)

### Frontend

- **Loro Sync Hook**: [apps/web/app/hooks/useLoroSync.ts](../apps/web/app/hooks/useLoroSync.ts)
- **Project Editor**: [apps/web/app/components/ProjectEditor.tsx](../apps/web/app/components/ProjectEditor.tsx)
- **Node Components**: [apps/web/app/components/nodes/](../apps/web/app/components/nodes/)
- **Asset Status**: [apps/web/lib/assetStatus.ts](../apps/web/lib/assetStatus.ts)

### Shared

- **Type Definitions**: [packages/shared-types/src/tasks.ts](../packages/shared-types/src/tasks.ts)
- **Database Migrations**: [apps/web/drizzle/](../apps/web/drizzle/)

---

**Document Version**: 1.0
**Last Updated**: 2026-01-12
**Maintainer**: Clash Development Team
