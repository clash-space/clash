# Collaboration Visibility: Presence + Activity

## Problem

When an external agent (via CLI) edits a Clash project canvas, the browser user has no awareness of what's happening. Loro CRDT syncs the data, but there's no indication of *who* made changes or *what* is being done. This makes multi-client collaboration feel invisible.

## Solution

Figma-style collaboration visibility:
- **Presence**: Toolbar avatars showing connected clients (humans + CLI agents)
- **Activity**: On-canvas highlights with labels when nodes change, plus mini-toasts for off-screen changes

## Architecture: Sideband WebSocket Messages

Presence and activity are ephemeral — they don't belong in the CRDT. Instead, ProjectRoom DO sends JSON text messages alongside binary Loro updates. The existing `onMessage` already distinguishes binary vs text.

---

## 1. Connection Identity

### Server: `ProjectRoom.onConnect`

On connect, build `ClientInfo` from auth result + headers:

```typescript
interface ClientInfo {
  connectionId: string;
  userId: string;
  clientType: "browser" | "cli";
  name: string;        // user name or "CLI Agent"
  avatar?: string;     // user avatar URL, undefined for CLI
  connectedAt: number;
}
```

- **Browser clients**: `clientType = "browser"`, name/avatar from Better Auth session user data
- **CLI clients**: detected by `x-client-type: cli` header (CLI sets this on WebSocket upgrade), name = `"CLI Agent"`

Store in `Map<string, ClientInfo>` on the ProjectRoom instance. Remove on `onClose`.

### CLI change

In `LoroSyncClient.connect()`, set custom header `x-client-type: cli` on the WebSocket upgrade request. The `ws` package supports this via the `headers` option.

---

## 2. Sideband Protocol

### Message types

Two JSON text message types, sent via `connection.send(JSON.stringify(msg))`:

**`presence`** — broadcast to all clients when any client connects or disconnects:

```typescript
interface PresenceMessage {
  type: "presence";
  clients: Array<{
    id: string;
    clientType: "browser" | "cli";
    userId: string;
    name: string;
    avatar?: string;
  }>;
}
```

**`activity`** — broadcast to all clients (except the actor) when canvas changes:

```typescript
interface ActivityMessage {
  type: "activity";
  actor: { clientType: "browser" | "cli"; name: string };
  action: "added" | "updated" | "deleted";
  nodeId: string;
  nodeType: string;
  label: string;
  timestamp: number;
}
```

### Server implementation

**ProjectRoom additions:**

```
private clients: Map<string, ClientInfo> = new Map();

broadcastPresence(): void
  → serialize clients map → send JSON text to all connections

broadcastActivity(sender: Connection, action, nodeId, nodeType, label): void
  → build ActivityMessage → send JSON text to all connections except sender
```

**Activity detection:** In `processMessageQueue`, after `doc.import(update)`:
1. Snapshot the nodes map keys + data before import
2. After import, diff to find added/updated/deleted nodes
3. For each change, call `broadcastActivity()`

Throttle: max 1 activity message per node per 500ms to avoid flooding during batch operations.

---

## 3. Frontend: Presence Toolbar

### Component: `PresenceBar`

Location: Top-right of the project editor, next to existing controls.

**Design:**
- Row of overlapping circular avatars (32px, -8px overlap), max 5 visible + "+N" overflow
- Browser users: avatar image or initials
- CLI agents: bot icon (Robot from Phosphor Icons) with a subtle terminal-green accent ring
- Tooltip on hover: name + client type

**State:** `usePresence` hook stores `clients[]` from latest `presence` message. Updates on every presence message via the existing WebSocket connection in `useLoroSync`.

### Integration with useLoroSync

Extend the existing `onmessage` handler:
```
ws.onmessage = (event) => {
  if (typeof event.data === 'string') {
    const msg = JSON.parse(event.data);
    if (msg.type === 'presence') onPresenceChange?.(msg.clients);
    if (msg.type === 'activity') onActivity?.(msg);
    return;
  }
  // existing binary Loro handling...
};
```

Add `onPresenceChange` and `onActivity` callbacks to `LoroSyncOptions`.

---

## 4. Frontend: Canvas Activity

### Node Highlights

When an `activity` message arrives for a visible node:

1. Add a colored ring to the node (2px, bot-blue `#3B82F6` for CLI, user-color for browser)
2. Show a small floating label above the node: `"CLI Agent added"` / `"CLI Agent updated"`
3. Fade out after 3 seconds (CSS animation, no JS timer cleanup needed)

Implementation: Maintain a `Map<nodeId, ActivityEvent>` in state. ReactFlow custom node wrapper checks this map and renders the ring + label overlay. Entries auto-expire via timestamp comparison in render.

### Off-screen Mini-Toast

When an `activity` message arrives for a node NOT currently in viewport:

1. Show a compact toast in the bottom-right corner: `"CLI Agent added 'Scene 1'"` with a small "Go to" link
2. Clicking "Go to" centers the canvas on that node (ReactFlow `fitView` or `setCenter`)
3. Toast auto-dismisses after 4 seconds, max 3 stacked

Implementation: `useActivityToast` hook. Viewport check via ReactFlow's `getViewport()` + node position comparison.

---

## 5. Files to Create / Modify

### New files
| File | Purpose |
|------|---------|
| `packages/shared-canvas/src/presence.ts` | `ClientInfo`, `PresenceMessage`, `ActivityMessage` type definitions |
| `apps/web/app/components/PresenceBar.tsx` | Toolbar presence avatars |
| `apps/web/app/components/ActivityOverlay.tsx` | Canvas node highlight + label overlay |
| `apps/web/app/components/ActivityToast.tsx` | Off-screen change toasts |
| `apps/web/app/hooks/usePresence.ts` | Presence state from WebSocket |
| `apps/web/app/hooks/useActivityToast.ts` | Toast state + viewport check |

### Modified files
| File | Change |
|------|--------|
| `apps/api-cf/src/agents/project-room.ts` | Add `clients` map, `broadcastPresence()`, `broadcastActivity()`, identity in `onConnect`/`onClose`, diff detection in `processMessageQueue` |
| `apps/web/app/hooks/useLoroSync.ts` | Handle text messages, add `onPresenceChange`/`onActivity` callbacks |
| `packages/shared-canvas/src/loro-client.ts` | Add `x-client-type: cli` header on WS connect |
| `packages/shared-canvas/src/index.ts` | Re-export presence types |

---

## 6. Verification

1. **Presence**: Open project in browser → run `clash canvas list --project <id>` → see "CLI Agent" avatar appear in toolbar → CLI disconnects → avatar disappears
2. **Activity highlight**: Open project in browser → run `clash canvas add --project <id> --type text --label "Test"` → see node appear with blue ring + "CLI Agent added" label → fades after 3s
3. **Off-screen toast**: Zoom into a corner of canvas → CLI adds a node far away → toast appears "CLI Agent added 'Test'" with "Go to" link → click centers canvas on node
4. **Multiple clients**: Open 2 browser tabs + 1 CLI → all three appear in presence bar → CLI adds node → both browser tabs show highlight + toast
