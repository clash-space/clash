import { useEffect, useRef, useCallback, useState } from 'react';
import { LoroDoc, UndoManager } from 'loro-crdt';
import { Node, Edge } from '@xyflow/react';
import { runtimeSyncWebSocketUrl } from '../lib/runtimeConfig';
import type {
  PresenceClient,
  ActivityMessage,
  RoomMessageEvent,
  AwarenessBroadcastMessage,
} from '@clash/shared-types';
import {
  Canvas,
  canvasGraphReconciliationChanged,
  DEFAULT_CANVAS_ID,
  createProjectCanvas,
  createProjectTimeline,
  deleteProjectCanvas,
  detachTimelineFromCanvas,
  ensureProjectCanvas,
  attachTimelineToCanvas,
  listProjectCanvases,
  listProjectTimelines,
  projectTimelineReadToken,
  reconcileCanvasGraph,
  reconcileProjectTimelineOwnership,
  renameProjectCanvas,
  updateProjectTimelineState,
  canvasBatchDeleteReadToken,
  canvasEdgeReadToken,
  canvasEdgesReadToken,
  canvasNodeReadToken,
  hostMutationRejected,
  hostMutationSucceeded,
  isSidebandMessage,
  validateHostMutationEnvelope,
  validateCanvasBatchDeleteReadProof,
  validateCanvasDelete,
  validateCanvasBatchDelete,
  validateCanvasEdgeAdd,
  validateCanvasEdgeDelete,
  validateCanvasEdgePatch,
  validateCanvasEdgeReadProof,
  validateCanvasEdgesReadProof,
  validateCanvasNodePatch,
  validateCanvasReadProof,
  validateAgentObservation,
  type HostMutationEnvelope,
  type HostMutationRecord,
  type ProjectCanvas,
  type ProjectCanvasDeleteResult,
  type ProjectCanvasMutationResult,
  type ProjectTimeline,
  type ProjectTimelineMutationResult,
} from '@clash/shared-types';
import { sanitizeNodesForReactFlow } from '../lib/canvasNodeOrder';

function reconcileImportedWorkspace(doc: LoroDoc): void {
  const graph = reconcileCanvasGraph(doc);
  const timelines = reconcileProjectTimelineOwnership(doc);
  if (
    canvasGraphReconciliationChanged(graph) ||
    timelines.removedActionNodeIds.length > 0 ||
    timelines.detachedTimelineIds.length > 0
  ) {
    doc.commit({ origin: 'sys:workspace-reconcile' });
  }
}

interface LoroSyncOptions {
  projectId: string;
  canvasId?: string;
  syncServerUrl?: string;
  onNodesChange?: (nodes: Node[]) => void;
  onEdgesChange?: (edges: Edge[]) => void;
  onTaskUpdate?: (taskId: string, taskData: any) => void;
  onPresenceChange?: (clients: PresenceClient[]) => void;
  onActivity?: (activity: ActivityMessage) => void;
  onMutation?: (mutation: HostMutationRecord) => void;
  /** Group-chat IM: a new message just landed in this project's room. */
  onRoomMessage?: (msg: RoomMessageEvent) => void;
  /**
   * Live cursor + selection awareness from peers.
   *
   * Server fans out the latest snapshot of every connected browser client
   * except the recipient. This callback is called every time that snapshot
   * changes (throttled server-side to ~12Hz).
   */
  onAwareness?: (msg: AwarenessBroadcastMessage) => void;
}

type LoroHostWriteOptions = {
  actorClientType?: string;
  ifMatch?: string;
};

export interface UseLoroSyncReturn {
  /** The project ID this sync is connected to */
  projectId: string;
  doc: LoroDoc | null;
  connected: boolean;
  /** Whether initial load from IndexedDB is complete */
  isInitialized: boolean;
  canvases: ProjectCanvas[];
  createCanvas: (input: {
    id: string;
    name: string;
  }) => ProjectCanvasMutationResult;
  renameCanvas: (canvasId: string, name: string) => ProjectCanvasMutationResult;
  deleteCanvas: (canvasId: string) => ProjectCanvasDeleteResult;
  timelines: ProjectTimeline[];
  standaloneTimelines: ProjectTimeline[];
  createTimeline: (input: {
    id: string;
    name: string;
    state: unknown;
  }) => ProjectTimelineMutationResult;
  attachTimeline: (input: {
    timelineId: string;
    actionNodeId: string;
    position: { x: number; y: number };
  }) => ProjectTimelineMutationResult;
  detachTimeline: (timelineId: string) => ProjectTimelineMutationResult;
  addNode: (nodeId: string, nodeData: any) => boolean;
  updateNode: (nodeId: string, nodeData: any, options?: LoroHostWriteOptions) => boolean;
  applyTimelineDsl: (nodeId: string, timelineDsl: unknown, options?: LoroHostWriteOptions) => boolean;
  removeNode: (nodeId: string, options?: LoroHostWriteOptions) => boolean;
  removeNodes: (nodeIds: string[], options?: LoroHostWriteOptions) => boolean;
  addEdge: (edgeId: string, edgeData: any, options?: LoroHostWriteOptions) => boolean;
  updateEdge: (edgeId: string, edgeData: any, options?: LoroHostWriteOptions) => boolean;
  removeEdge: (edgeId: string, options?: LoroHostWriteOptions) => boolean;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Send a JSON sideband message over the same WS used for binary CRDT sync.
   * Best-effort: silently dropped if the socket isn't OPEN (the server side
   * tolerates missing presence updates — disconnect releases any held lock
   * automatically). Currently used for the timeline soft edit-lock.
   */
  sendSideband: (msg: object) => void;
}

// IndexedDB helpers
const DB_NAME = 'loro-sync-db';
const STORE_NAME = 'snapshots';

// Schema version for migration - increment when data format changes
// v1-reference-only: Timeline DSL uses assetId references only, no redundant src/type
// v2-sanitize-parentid: Force clear IndexedDB to fix invalid parentId references
const LORO_SCHEMA_VERSION = 'v2-sanitize-parentid';

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
};

// Returns true if the IndexedDB appears corrupted (NotReadableError). Caller should wipe and continue.
const isCorruptionError = (err: unknown): boolean => {
  const name = (err as { name?: string })?.name;
  return name === 'NotReadableError' || name === 'InvalidStateError';
};

const wipeDB = async (): Promise<void> => {
  try {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onerror = () => resolve();
      req.onsuccess = () => resolve();
      req.onblocked = () => resolve();
    });
  } catch {
    // best-effort
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readGuardrailEdges(rawEdges: Iterable<unknown>): Array<{ source: string; target: string }> {
  return [...rawEdges]
    .filter(isRecord)
    .map((edge) => ({
      source: typeof edge.source === 'string' ? edge.source : '',
      target: typeof edge.target === 'string' ? edge.target : '',
    }))
    .filter((edge) => edge.source && edge.target);
}

function readProofEdges(rawEdges: Iterable<[unknown, unknown]>): Array<Record<string, unknown> & { id: string }> {
  const edges: Array<Record<string, unknown> & { id: string }> = [];
  for (const [edgeId, rawEdge] of rawEdges) {
    if (typeof edgeId !== 'string' || !isRecord(rawEdge)) continue;
    edges.push({ id: edgeId, ...rawEdge });
  }
  return edges;
}

function readGuardrailNodes(rawNodes: Iterable<[unknown, unknown]>,
  canvasId?: string,
): Array<{ id: string; type?: string; data?: Record<string, unknown> }> {
  const nodes: Array<{ id: string; type?: string; data?: Record<string, unknown>;
  }> = [];
  for (const [id, rawNode] of rawNodes) {
    if (typeof id !== 'string' || !isRecord(rawNode)) continue;
    const nodeCanvasId =
      typeof rawNode.canvasId === "string"
        ? rawNode.canvasId
        : DEFAULT_CANVAS_ID;
    if (canvasId && nodeCanvasId !== canvasId) continue;
    nodes.push({
      id,
      type: typeof rawNode.type === 'string' ? rawNode.type : undefined,
      data: isRecord(rawNode.data) ? rawNode.data : undefined,
    });
  }
  return nodes;
}

function readNodeToken(nodeId: string, rawNode: unknown): string | undefined {
  if (!isRecord(rawNode)) return undefined;
  return canvasNodeReadToken({
    id: nodeId,
    type: typeof rawNode.type === 'string' ? rawNode.type : undefined,
    data: isRecord(rawNode.data) ? rawNode.data : undefined,
    parentId: typeof rawNode.parentId === 'string' ? rawNode.parentId : null,
    parent_id: typeof rawNode.parent_id === 'string' ? rawNode.parent_id : null,
    position: rawNode.position,
  });
}

function readProofNode(nodeId: string, rawNode: unknown) {
  if (!isRecord(rawNode)) return null;
  return {
    id: nodeId,
    type: typeof rawNode.type === 'string' ? rawNode.type : undefined,
    data: isRecord(rawNode.data) ? rawNode.data : undefined,
    parentId: typeof rawNode.parentId === 'string' ? rawNode.parentId : null,
    parent_id: typeof rawNode.parent_id === 'string' ? rawNode.parent_id : null,
    position: rawNode.position,
  };
}

function readEdgeToken(edgeId: string, rawEdge: unknown): string | undefined {
  if (!isRecord(rawEdge)) return undefined;
  return canvasEdgeReadToken({ id: edgeId, ...rawEdge });
}

function readEdgesToken(rawEdges: Iterable<[unknown, unknown]>): string {
  return canvasEdgesReadToken(readProofEdges(rawEdges));
}

function readBatchDeleteToken(
  nodeIds: string[],
  rawNodes: Iterable<[unknown, unknown]>,
  rawEdges: Iterable<[unknown, unknown]>,
): string {
  const nodeIdSet = new Set(nodeIds);
  const nodes = [...rawNodes]
    .map(([nodeId, rawNode]) => typeof nodeId === 'string' && nodeIdSet.has(nodeId) ? readProofNode(nodeId, rawNode) : null)
    .filter((node): node is NonNullable<ReturnType<typeof readProofNode>> => Boolean(node));
  return canvasBatchDeleteReadToken({
    nodes,
    edges: readProofEdges(rawEdges),
  });
}

function readProofEdge(edgeId: string, rawEdge: unknown) {
  if (!isRecord(rawEdge)) return null;
  return { id: edgeId, ...rawEdge };
}

const saveToDB = async (projectId: string, snapshot: Uint8Array): Promise<void> => {
  try {
    const db = await initDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(snapshot, projectId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (err) {
    console.error('[useLoroSync] Failed to save to IndexedDB:', err);
    if (isCorruptionError(err)) await wipeDB();
  }
};

const loadFromDB = async (projectId: string): Promise<Uint8Array | undefined> => {
  try {
    const db = await initDB();
    return await new Promise<Uint8Array | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(projectId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  } catch (err) {
    console.error('[useLoroSync] Failed to load from IndexedDB:', err);
    if (isCorruptionError(err)) await wipeDB();
    return undefined;
  }
};

const deleteFromDB = async (projectId: string): Promise<void> => {
  try {
    const db = await initDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(projectId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (err) {
    console.error('[useLoroSync] Failed to delete from IndexedDB:', err);
    if (isCorruptionError(err)) await wipeDB();
  }
};

/**
 * Custom hook for Loro CRDT sync with the sync server
 * Manages WebSocket connection and document synchronization
 *
 * Architecture:
 * - Loro doc is the source of truth for persistence/sync
 * - React state is derived from Loro for UI
 * - Local changes: update Loro doc -> subscribeLocalUpdate sends to server
 * - Remote changes: import into Loro doc -> subscribe updates React state
 */
export function useLoroSync(options: LoroSyncOptions): UseLoroSyncReturn {
  const {
    projectId,
    canvasId = DEFAULT_CANVAS_ID,
    syncServerUrl,
    onNodesChange,
    onEdgesChange,
    onTaskUpdate,
    onPresenceChange,
    onActivity,
    onMutation,
    onRoomMessage,
    onAwareness,
  } = options;

  const [doc] = useState(() => new LoroDoc());
  // Explicit config per Loro docs:
  // - mergeInterval 300ms: tight enough that each user action is its own step,
  //   loose enough that React's batched commits within a single handler merge.
  // - excludeOriginPrefixes ["sys:"]: commits tagged `sys:<thing>` (internal
  //   repairs like the parentId sanitizer) are kept OUT of the user undo stack.
  const canvasIdRef = useRef(canvasId);
  canvasIdRef.current = canvasId;
  // Explicit config per Loro docs:
  // - mergeInterval 300ms: tight enough that each user action is its own step,
  //   loose enough that React's batched commits within a single handler merge.
  // - excludeOriginPrefixes ["sys:"]: commits tagged `sys:<thing>` (internal
  //   repairs like the parentId sanitizer) are kept OUT of the user undo stack.
  const [undoManager] = useState(() => new UndoManager(doc, {
    mergeInterval: 300,
    maxUndoSteps: 200,
    excludeOriginPrefixes: ["sys:"],
  }));

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Stash callbacks in a ref so init / subscribe effects don't re-run when the caller
  // passes inline closures (which get a new reference on every parent render).
  const [canvases, setCanvases] = useState<ProjectCanvas[]>([]);
  const [timelines, setTimelines] = useState<ProjectTimeline[]>([]);

  useEffect(() => {
    if (doc.getMap("canvases").size === 0) {
      ensureProjectCanvas(doc, DEFAULT_CANVAS_ID);
      doc.commit({ origin: "sys:canvas-registry" });
    }
    setCanvases(listProjectCanvases(doc));
    setTimelines(listProjectTimelines(doc));
  }, [doc]);

  // Stash callbacks in a ref so init / subscribe effects don't re-run when the caller
  // passes inline closures (which get a new reference on every parent render).
  const callbacksRef = useRef({ onNodesChange, onEdgesChange, onTaskUpdate, onPresenceChange, onActivity, onMutation, onRoomMessage, onAwareness });
  useEffect(() => {
    callbacksRef.current = { onNodesChange, onEdgesChange, onTaskUpdate, onPresenceChange, onActivity, onMutation, onRoomMessage, onAwareness };
  }, [onNodesChange, onEdgesChange, onTaskUpdate, onPresenceChange, onActivity, onMutation, onRoomMessage, onAwareness]);

  // Track pending local updates that haven't been acknowledged by server
  

  // Update undo/redo state.
  //
  // Loro's `doc.subscribe` fires synchronously during commit, and our listener
  // may run BEFORE the UndoManager's own internal subscription has pushed the
  // new op onto its stack. Reading `canUndo()` at that moment returns stale
  // `false`. Defer one microtask so every subscriber has drained.
  const updateUndoRedoState = useCallback(() => {
    queueMicrotask(() => {
      setCanUndo(undoManager.canUndo());
      setCanRedo(undoManager.canRedo());
    });
  }, [undoManager]);

  // Helper to read current state from Loro doc
  const readStateFromLoro = useCallback(() => {
    const nodesMap = doc.getMap('nodes');
    const tasksMap = doc.getMap('tasks');

    const nodeIds = new Set<string>();
    for (const [key, value] of nodesMap.entries()) {
      if (!isRecord(value)) continue;
      const nodeCanvasId =
        typeof value.canvasId === "string" ? value.canvasId : DEFAULT_CANVAS_ID;
      if (nodeCanvasId === canvasIdRef.current) nodeIds.add(key);
    }

    const nodes: Node[] = [];
    const nodesToFix: Array<{ key: string; cleanedData: any }> = [];

    for (const [key, value] of nodesMap.entries()) {
      const nodeData = value as any;
      // Validate parentId - remove if parent doesn't exist to prevent ReactFlow errors
      if (!nodeIds.has(key)) continue;
      // Validate parentId - remove if parent doesn't exist to prevent ReactFlow errors
      if (nodeData.parentId && !nodeIds.has(nodeData.parentId)) {
        console.warn(`[useLoroSync] Removing invalid parentId ${nodeData.parentId} from node ${key}`);
        const { parentId: _parentId, extent: _extent, ...rest } = nodeData;
        const cleanedData = { ...rest, parentId: undefined, extent: undefined };
        nodes.push({ id: key, ...cleanedData });
        // Mark for permanent fix in Loro doc
        nodesToFix.push({ key, cleanedData });
      } else {
        nodes.push({ id: key, ...nodeData });
      }
    }

    // Permanently fix invalid parentIds in Loro doc (deferred to avoid triggering loops).
    // Tagged `sys:parent-fix` so the UndoManager's excludeOriginPrefixes keeps it
    // out of the user's undo stack — repairs aren't something the user asked for.
    if (nodesToFix.length > 0) {
      queueMicrotask(() => {
        for (const { key, cleanedData } of nodesToFix) {
          nodesMap.set(key, cleanedData);
        }
        doc.commit({ origin: "sys:parent-fix" });
      });
    }

    const sortedNodes = sanitizeNodesForReactFlow(nodes);

    const edges: Edge[] = new Canvas(doc, () => {}, canvasIdRef.current)
      .listEdges()
      .map((edge) => ({
        ...edge,
        interactionWidth: 30,
        focusable: true,
        selectable: true,
        deletable: true,
      }));

    const tasks: Array<{ id: string; data: any }> = [];
    for (const [key, value] of tasksMap.entries()) {
      tasks.push({ id: key, data: value });
    }

    return { nodes: sortedNodes, edges, tasks };
  }, [doc]);

  // Load from local storage on mount - MUST complete before WebSocket connects
  useEffect(() => {
    if (!isInitialized) return;
    const { nodes, edges, tasks } = readStateFromLoro();
    const cb = callbacksRef.current;
    cb.onNodesChange?.(nodes);
    cb.onEdgesChange?.(edges);
    if (cb.onTaskUpdate)
      tasks.forEach((task) => cb.onTaskUpdate?.(task.id, task.data));
  }, [canvasId, isInitialized, readStateFromLoro]);

  // Load from local storage on mount - MUST complete before WebSocket connects
  useEffect(() => {
    let mounted = true;
    const initialize = async () => {
      // Step 0: Migration check - clear old data if schema version changed
      // This ensures clean transition to reference-only timeline model
      const versionKey = `loro-schema-version-${projectId}`;
      const currentVersion = localStorage.getItem(versionKey);

      if (currentVersion !== LORO_SCHEMA_VERSION) {
        console.log(`[useLoroSync] Schema version mismatch for project ${projectId}, clearing old data`, { currentVersion, expected: LORO_SCHEMA_VERSION });

        await deleteFromDB(projectId);
        localStorage.setItem(versionKey, LORO_SCHEMA_VERSION);
      }

      // Step 1: Load from IndexedDB
      const snapshot = await loadFromDB(projectId);
      if (!mounted) return;

      if (snapshot) {
        try {
          doc.import(snapshot);
          reconcileImportedWorkspace(doc);
        } catch (err) {
          console.error('[useLoroSync] Failed to import local snapshot:', err);
        }
      }

      // Step 2: Update React state from Loro
      const { nodes, edges, tasks } = readStateFromLoro();
      const cb = callbacksRef.current;
      if (cb.onNodesChange && nodes.length > 0) {
        cb.onNodesChange(nodes);
      }
      if (cb.onEdgesChange && edges.length > 0) {
        cb.onEdgesChange(edges);
      }
      if (cb.onTaskUpdate) {
        tasks.forEach((t) => cb.onTaskUpdate!(t.id, t.data));
      }

      updateUndoRedoState();
      setCanvases(listProjectCanvases(doc));
      setTimelines(listProjectTimelines(doc));
      setIsInitialized(true);
    };

    initialize();
    return () => { mounted = false; };
  }, [projectId, doc, readStateFromLoro, updateUndoRedoState]);

  // Subscribe to document changes - only for remote updates
  useEffect(() => {
    if (!isInitialized) return;

    const unsubscribe = doc.subscribe((event: any) => {
      // event.by: "local" | "import" | "checkout"

      // Save to local storage (debounced) for ALL changes
      const snapshot = doc.export({ mode: 'snapshot' });
      if ((window as any)._loroSaveTimeout) {
        clearTimeout((window as any)._loroSaveTimeout);
      }
      (window as any)._loroSaveTimeout = setTimeout(() => {
        saveToDB(projectId, snapshot).catch((err) => console.error('Failed to save local snapshot:', err));
      }, 1000);

      // Update undo/redo state
      updateUndoRedoState();
      setCanvases(listProjectCanvases(doc));
      setTimelines(listProjectTimelines(doc));

      // CRITICAL: Only update React state for REMOTE changes
      // Local changes are already in React state - updating would cause loops/overwrites
      if (event.by === 'local') {
        return;
      }

      // Read fresh state from Loro and update React
      const { nodes, edges, tasks } = readStateFromLoro();

      const cb = callbacksRef.current;
      if (cb.onNodesChange) {
        cb.onNodesChange(nodes);
      }
      if (cb.onEdgesChange) {
        cb.onEdgesChange(edges);
      }
      if (cb.onTaskUpdate) {
        tasks.forEach((t) => cb.onTaskUpdate!(t.id, t.data));
      }
    });

    return () => {
      unsubscribe();
    };
  }, [doc, isInitialized, projectId, readStateFromLoro, updateUndoRedoState]);

  // WebSocket connection state
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);
  const isUnmountingRef = useRef(false);
  const localUpdateSubRef = useRef<any>(null);

  // Send update to server (used by subscribeLocalUpdate)
  const sendUpdate = useCallback((update: Uint8Array) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(update);
    } else {
    }
  }, []);

  // Send a JSON sideband message (presence-style) on the same WS. Best-effort:
  // if the socket isn't open we silently drop. The server treats absence of
  // presence updates as "no lock held", which is the right semantic for a
  // soft-lock — a disconnected client cannot be editing.
  const sendSideband = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        // Send failure is recoverable: next openEditor / closeEditor will retry.
      }
    }
  }, []);

  // Forward declaration for recursion
  const connectRef = useRef<() => void>(() => {});

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    const delay = Math.min(500 * Math.pow(1.5, retryCountRef.current), 5000);
    reconnectTimeoutRef.current = setTimeout(() => {
      retryCountRef.current++;
      // Call the latest connect function via ref to avoid circular dependency
      connectRef.current();
    }, delay);
  }, []);

  // Connect function - only called after initialization
  const connect = useCallback(() => {
    if (isUnmountingRef.current) return;

    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close();
      }
    }

    const wsUrl = syncServerUrl
      ? `${syncServerUrl.replace(/\/+$/, '')}/sync/${encodeURIComponent(projectId)}`
      : runtimeSyncWebSocketUrl(projectId);
    console.log('[useLoroSync] connecting WebSocket', wsUrl);

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[useLoroSync] ws open', wsUrl);
      if (isUnmountingRef.current) {
        ws.close();
        return;
      }
      setConnected(true);
      retryCountRef.current = 0;

      // Send full snapshot on connect to sync with server
      const snapshot = doc.export({ mode: 'snapshot' });
      ws.send(snapshot);

      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          // Placeholder for app-level ping
        }
      }, 30000);
    };

    ws.onmessage = async (event) => {
      // Text messages = JSON sideband (presence/activity)
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (isSidebandMessage(msg)) {
            if (msg.type === 'presence' && callbacksRef.current.onPresenceChange) {
              callbacksRef.current.onPresenceChange(msg.clients);
            } else if (msg.type === 'activity' && callbacksRef.current.onActivity) {
              callbacksRef.current.onActivity(msg);
            } else if (msg.type === 'room.message' && callbacksRef.current.onRoomMessage) {
              callbacksRef.current.onRoomMessage(msg);
            } else if (msg.type === 'awareness.broadcast' && callbacksRef.current.onAwareness) {
              callbacksRef.current.onAwareness(msg);
            }
          }
        } catch {
          // Ignore unparseable text messages
        }
        return;
      }

      // Binary messages = Loro CRDT updates
      try {
        const update = new Uint8Array(event.data);
        doc.import(update);
      } catch (error: any) {
        console.error('[useLoroSync] Error importing update:', error);
        // Don't reload — just log the error. The next full snapshot
        // from the server (on reconnect) will fix the state.
      }
    };

    ws.onerror = (error) => {
      console.error('[useLoroSync] WebSocket error:', error);
    };

    ws.onclose = (event) => {
      console.log('[useLoroSync] ws close', { code: event.code, reason: event.reason, wasClean: event.wasClean });
      setConnected(false);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (!isUnmountingRef.current) {
        scheduleReconnect();
      }
    };
  }, [projectId, syncServerUrl, doc, scheduleReconnect]);

  // Keep ref updated
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // Only connect WebSocket AFTER initialization is complete
  useEffect(() => {
    if (!isInitialized) return;

    isUnmountingRef.current = false;

    // Subscribe to local updates - this is the recommended way to send changes to server
    // subscribeLocalUpdates automatically gives us the bytes to send whenever local changes happen
    localUpdateSubRef.current = doc.subscribeLocalUpdates((update: Uint8Array) => {
      sendUpdate(update);
    });

    connect();

    return () => {
      isUnmountingRef.current = true;
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (localUpdateSubRef.current) {
        localUpdateSubRef.current();
        localUpdateSubRef.current = null;
      }
    };
  }, [isInitialized, connect, doc, sendUpdate]);

  // Helper methods for modifying the document
  // Note: subscribeLocalUpdate automatically sends changes to server
  // So we just need to modify the Loro doc - no manual export needed
  const addNode = useCallback((nodeId: string, nodeData: any) => {
    const nodesMap = doc.getMap('nodes');
    if (!doc.getMap("canvases").get(canvasId)) {
      callbacksRef.current.onMutation?.(hostMutationRejected({
        operation: 'canvas_add_node',
        entity: { kind: 'canvas-node', id: nodeId },
      }, `Canvas ${canvasId} not found`));
      return false;
    }
    const existing = nodesMap.get(nodeId);
    if (existing !== undefined) {
      console.warn(`[useLoroSync] Blocked addNode for existing node ${nodeId}`);
      callbacksRef.current.onMutation?.(hostMutationRejected({
        operation: 'canvas_add_node',
        entity: { kind: 'canvas-node', id: nodeId },
        beforeReadToken: readNodeToken(nodeId, existing),
      }, `Node already exists: ${nodeId}`));
      return false;
    }
    nodesMap.set(nodeId, {
      ...nodeData,
      canvasId,
      upstream: Array.isArray(nodeData?.upstream) ? nodeData.upstream : [],
    });
    doc.commit(); // Commit to trigger subscribeLocalUpdate
    updateUndoRedoState();
    callbacksRef.current.onMutation?.(hostMutationSucceeded({
      operation: 'canvas_add_node',
      entity: { kind: 'canvas-node', id: nodeId },
    }, {
      resultEntityId: nodeId,
      afterReadToken: readNodeToken(nodeId, nodesMap.get(nodeId)),
    }));
    return true;
  }, [canvasId, doc, updateUndoRedoState]);

  const createCanvas = useCallback(
    (input: { id: string; name: string }) => {
      const result = createProjectCanvas(doc, input);
      if (result.ok) {
        doc.commit();
        setCanvases(listProjectCanvases(doc));
      }
      return result;
    },
    [doc],
  );

  const renameCanvas = useCallback(
    (targetCanvasId: string, name: string) => {
      const result = renameProjectCanvas(doc, targetCanvasId, name);
      if (result.ok) {
        doc.commit();
        setCanvases(listProjectCanvases(doc));
      }
      return result;
    },
    [doc],
  );

  const deleteCanvas = useCallback(
    (targetCanvasId: string) => {
      const result = deleteProjectCanvas(doc, targetCanvasId);
      if (result.ok) {
        doc.commit();
        setCanvases(listProjectCanvases(doc));
      }
      return result;
    },
    [doc],
  );

  const createTimeline = useCallback(
    (input: { id: string; name: string; state: unknown }) => {
      const result = createProjectTimeline(doc, input);
      if (result.ok) {
        doc.commit();
        setTimelines(listProjectTimelines(doc));
      }
      return result;
    },
    [doc],
  );

  const attachTimeline = useCallback(
    (input: {
      timelineId: string;
      actionNodeId: string;
      position: { x: number; y: number };
    }) => {
      const result = attachTimelineToCanvas(doc, {
        ...input,
        canvasId: canvasIdRef.current,
      });
      if (result.ok) {
        doc.commit();
        setTimelines(listProjectTimelines(doc));
        const state = readStateFromLoro();
        callbacksRef.current.onNodesChange?.(state.nodes);
        callbacksRef.current.onEdgesChange?.(state.edges);
      }
      return result;
    },
    [doc, readStateFromLoro],
  );

  const detachTimeline = useCallback(
    (timelineId: string) => {
      const result = detachTimelineFromCanvas(doc, timelineId);
      if (result.ok) {
        doc.commit();
        setTimelines(listProjectTimelines(doc));
        const state = readStateFromLoro();
        callbacksRef.current.onNodesChange?.(state.nodes);
        callbacksRef.current.onEdgesChange?.(state.edges);
      }
      return result;
    },
    [doc, readStateFromLoro],
  );

  const updateNode = useCallback((nodeId: string, nodeData: any, options?: LoroHostWriteOptions) => {
    const nodesMap = doc.getMap('nodes');
    const existing = nodesMap.get(nodeId) as any;
    let mutationEnvelope: HostMutationEnvelope | undefined;
    if (!existing) {
      callbacksRef.current.onMutation?.(hostMutationRejected({
        operation: 'canvas_update',
        entity: { kind: 'canvas-node', id: nodeId },
      }, `Node not found: ${nodeId}`));
      return false;
    } else {
      const beforeReadToken = readNodeToken(nodeId, existing);
      const currentEdges = new Canvas(
          doc,
          () => {},
          canvasIdRef.current,
        ).listEdges();
      const nodesForGuard = readGuardrailNodes(nodesMap.entries(),
          canvasIdRef.current,
        );
      const proofNode = readProofNode(nodeId, existing);
      const readProof = proofNode
        ? validateCanvasReadProof({
            operation: 'update',
            actorClientType: options?.actorClientType,
            node: proofNode,
            expectedReadToken: options?.ifMatch,
            })
        : { ok: true as const };
      const patchGuard = validateCanvasNodePatch({
        nodeId,
        node: {
          type: typeof existing.type === 'string' ? existing.type : undefined,
          data: isRecord(existing.data) ? existing.data : undefined,
        },
        nodes: nodesForGuard,
        edges: currentEdges,
        patch: isRecord(nodeData) ? nodeData : {},
      });
      const guard = readProof.ok ? patchGuard : readProof;
      const hostMutation = validateHostMutationEnvelope({
        operation: 'canvas_update',
        entity: { kind: 'canvas-node', id: nodeId },
        expectedReadToken: options?.ifMatch,
        currentReadToken: beforeReadToken,
          guard,
      });
      if (!guard.ok) {
        console.warn(`[useLoroSync] Blocked node update for ${nodeId}: ${guard.error}`);
        if (!hostMutation.ok) callbacksRef.current.onMutation?.(hostMutation.mutation);
        const { nodes, edges, tasks } = readStateFromLoro();
        const cb = callbacksRef.current;
        if (cb.onNodesChange) cb.onNodesChange(nodes);
        if (cb.onEdgesChange) cb.onEdgesChange(edges);
        if (cb.onTaskUpdate) tasks.forEach((t) => cb.onTaskUpdate!(t.id, t.data));
        return false;
      }
      if (hostMutation.ok) mutationEnvelope = hostMutation.envelope;
      const updated = {
        ...existing,
        ...nodeData,
        data: { ...(existing?.data || {}), ...(nodeData.data || {}) },
      };
      nodesMap.set(nodeId, updated);
    }
    doc.commit(); // Commit to trigger subscribeLocalUpdate
    updateUndoRedoState();
    const updatedNode = nodesMap.get(nodeId);
    callbacksRef.current.onMutation?.(hostMutationSucceeded(
      mutationEnvelope ?? {
        operation: 'canvas_update',
        entity: { kind: 'canvas-node', id: nodeId },
      },
      {
        resultEntityId: nodeId,
        afterReadToken: readNodeToken(nodeId, updatedNode),
      },
    ));
    return true;
  }, [doc, readStateFromLoro, updateUndoRedoState]);

  const applyTimelineDsl = useCallback((nodeId: string, timelineDsl: unknown, options?: LoroHostWriteOptions) => {
    const nodesMap = doc.getMap('nodes');
    const existing = nodesMap.get(nodeId) as any;
    if (!existing) {
      console.warn(`[useLoroSync] Blocked timeline apply for ${nodeId}: node not found`);
      callbacksRef.current.onMutation?.(hostMutationRejected({
        operation: 'timeline_apply',
        entity: { kind: 'timeline', id: nodeId },
            }, `Node not found: ${nodeId}`));
      return false;
    }

    const timelineId =
        typeof existing.data?.timelineId === "string"
          ? existing.data.timelineId
          : undefined;
      if (!timelineId) {
        const error = `Timeline Action ${nodeId} must reference a Project Timeline`;
        console.warn(
          `[useLoroSync] Blocked timeline apply for ${nodeId}: ${error}`,
        );
        callbacksRef.current.onMutation?.(
          hostMutationRejected(
            {
              operation: "timeline_apply",
              entity: { kind: "timeline", id: nodeId },
            },
            error,
          ),
        );
        return false;
      }
      const timeline = listProjectTimelines(doc).find(
        (candidate) => candidate.id === timelineId,
      );
      if (!timeline) {
        const error = `Timeline ${timelineId} not found`;
        console.warn(
          `[useLoroSync] Blocked timeline apply for ${nodeId}: ${error}`,
        );
        callbacksRef.current.onMutation?.(
          hostMutationRejected(
            {
          operation: "timeline_apply",
              entity: { kind: "timeline", id: timelineId },
            },
            error,
          ),
        );
        return false;
      }

      const beforeReadToken = projectTimelineReadToken(timeline);
    const guard = validateAgentObservation({
        actorClientType: options?.actorClientType,
        operation: "applying Timeline state",
        observedVersion: options?.ifMatch,
        currentVersion: beforeReadToken,
      });
    const hostMutation = validateHostMutationEnvelope({
      operation: 'timeline_apply',
      entity: { kind: 'timeline', id: timelineId },
      expectedReadToken: options?.ifMatch,
      currentReadToken: beforeReadToken,
        guard,
    });
    if (!guard.ok) {
      console.warn(`[useLoroSync] Blocked timeline apply for ${nodeId}: ${guard.error}`);
      if (!hostMutation.ok) callbacksRef.current.onMutation?.(hostMutation.mutation);
      const { nodes, edges, tasks } = readStateFromLoro();
      const cb = callbacksRef.current;
      if (cb.onNodesChange) cb.onNodesChange(nodes);
      if (cb.onEdgesChange) cb.onEdgesChange(edges);
      if (cb.onTaskUpdate) tasks.forEach((t) => cb.onTaskUpdate!(t.id, t.data));
      return false;
    }

      const updated = updateProjectTimelineState(doc, timelineId, timelineDsl);
      if (!updated.ok) return false;
      setTimelines(listProjectTimelines(doc));
    doc.commit();
    updateUndoRedoState();
    callbacksRef.current.onMutation?.(hostMutationSucceeded(
      hostMutation.ok ? hostMutation.envelope : {
        operation: 'timeline_apply',
        entity: { kind: 'timeline', id: timelineId },
              },
      {
        resultEntityId: timelineId,
        afterReadToken: projectTimelineReadToken(updated.timeline),
          },
    ));
    return true;
  }, [doc, readStateFromLoro, updateUndoRedoState]);

  const removeNode = useCallback((nodeId: string, options?: LoroHostWriteOptions) => {
    const nodesMap = doc.getMap('nodes');
    const existing = nodesMap.get(nodeId);
    if (!isRecord(existing)) {
      const error = `Node not found: ${nodeId}`;
      console.warn(`[useLoroSync] Blocked node delete for ${nodeId}: ${error}`);
      callbacksRef.current.onMutation?.(hostMutationRejected({
        operation: 'canvas_delete',
        entity: { kind: 'canvas-node', id: nodeId },
        expectedReadToken: options?.ifMatch,
            }, error));
      return false;
    }
    const beforeReadToken = readNodeToken(nodeId, existing);
    const canvas = new Canvas(doc, () => {}, canvasIdRef.current);
      const edges = canvas.listEdges();
    const proofNode = readProofNode(nodeId, existing);
    const readProof = proofNode
      ? validateCanvasReadProof({
          operation: 'delete',
          actorClientType: options?.actorClientType,
          node: proofNode,
          expectedReadToken: options?.ifMatch,
          })
      : { ok: true as const };
    const deleteGuard = validateCanvasDelete({
      nodeId,
      edges,
      });
    const guard = readProof.ok ? deleteGuard : readProof;
    const hostMutation = validateHostMutationEnvelope({
      operation: 'canvas_delete',
      entity: { kind: 'canvas-node', id: nodeId },
      expectedReadToken: options?.ifMatch,
      currentReadToken: beforeReadToken,
        guard,
    });
    if (!guard.ok) {
      console.warn(`[useLoroSync] Blocked node delete for ${nodeId}: ${guard.error}`);
      if (!hostMutation.ok) callbacksRef.current.onMutation?.(hostMutation.mutation);
      const { nodes, edges: currentEdges, tasks } = readStateFromLoro();
      const cb = callbacksRef.current;
      if (cb.onNodesChange) cb.onNodesChange(nodes);
      if (cb.onEdgesChange) cb.onEdgesChange(currentEdges);
      if (cb.onTaskUpdate) tasks.forEach((t) => cb.onTaskUpdate!(t.id, t.data));
      return false;
    }

      if (!canvas.deleteNode(nodeId)) return false;
      doc.commit(); // Commit to trigger subscribeLocalUpdate
    updateUndoRedoState();
    callbacksRef.current.onMutation?.(hostMutationSucceeded(
      hostMutation.ok ? hostMutation.envelope : {
        operation: 'canvas_delete',
        entity: { kind: 'canvas-node', id: nodeId },
              },
      { resultEntityId: nodeId },
    ));
    return true;
  }, [doc, readStateFromLoro, updateUndoRedoState]);

  const removeNodes = useCallback((nodeIds: string[], options?: LoroHostWriteOptions) => {
    const uniqueNodeIds = [...new Set(nodeIds.map((nodeId) => nodeId.trim()).filter(Boolean))];
    if (uniqueNodeIds.length === 0) return true;
    if (uniqueNodeIds.length === 1) return removeNode(uniqueNodeIds[0], options);

    const nodesMap = doc.getMap('nodes');
    const canvas = new Canvas(doc, () => {}, canvasIdRef.current);
    const existingIds = uniqueNodeIds.filter((nodeId) =>
        Boolean(canvas.readNode(nodeId)));
    const batchId = existingIds.join(',');
    if (existingIds.length === 0) {
      callbacksRef.current.onMutation?.(hostMutationRejected({
        operation: 'canvas_batch_delete',
        entity: { kind: 'canvas-node-batch', id: batchId || uniqueNodeIds.join(',') },
            }, `Node(s) not found: ${uniqueNodeIds.join(', ')}`));
      return false;
    }

    const currentEdges = canvas.listEdges();
      const edgeEntries: Array<[string, (typeof currentEdges)[number]]> =
        currentEdges.map((edge) => [edge.id, edge]);
      const beforeReadToken = readBatchDeleteToken(existingIds, nodesMap.entries(),
        edgeEntries,
      );
    const readProof = validateCanvasBatchDeleteReadProof({
      actorClientType: options?.actorClientType,
      nodes: existingIds.map((nodeId) => readProofNode(nodeId, nodesMap.get(nodeId))).filter((node): node is NonNullable<ReturnType<typeof readProofNode>> => Boolean(node)),
      edges: readProofEdges(edgeEntries),
      expectedReadToken: options?.ifMatch,
      });
    const edges = currentEdges;
    const deleteGuard = validateCanvasBatchDelete({
      nodeIds: existingIds,
      edges,
      });
    const guard = readProof.ok ? deleteGuard : readProof;
    const hostMutation = validateHostMutationEnvelope({
      operation: 'canvas_batch_delete',
      entity: { kind: 'canvas-node-batch', id: batchId },
      expectedReadToken: options?.ifMatch,
      currentReadToken: beforeReadToken,
        guard,
    });
    if (!guard.ok) {
      console.warn(`[useLoroSync] Blocked batch node delete for ${batchId}: ${guard.error}`);
      if (!hostMutation.ok) callbacksRef.current.onMutation?.(hostMutation.mutation);
      const { nodes, edges: currentEdges, tasks } = readStateFromLoro();
      const cb = callbacksRef.current;
      if (cb.onNodesChange) cb.onNodesChange(nodes);
      if (cb.onEdgesChange) cb.onEdgesChange(currentEdges);
      if (cb.onTaskUpdate) tasks.forEach((t) => cb.onTaskUpdate!(t.id, t.data));
      return false;
    }

      canvas.deleteNodes(existingIds);
      doc.commit();
    updateUndoRedoState();
    callbacksRef.current.onMutation?.(hostMutationSucceeded(
      hostMutation.ok ? hostMutation.envelope : {
        operation: 'canvas_batch_delete',
        entity: { kind: 'canvas-node-batch', id: batchId },
        ...(options?.ifMatch ? { expectedReadToken: options.ifMatch } : {}),
        beforeReadToken,
              },
      { resultEntityId: batchId },
    ));
    return true;
  }, [doc, readStateFromLoro, removeNode, updateUndoRedoState]);

  const addEdge = useCallback((edgeId: string, edgeData: any, options?: LoroHostWriteOptions) => {
    const canvas = new Canvas(doc, () => {}, canvasIdRef.current);
      const currentEdges = canvas.listEdges();
    const edgeEntries: Array<[string, (typeof currentEdges)[number]]> =
        currentEdges.map((edge) => [edge.id, edge]);
      const needsReadProof =
      options?.actorClientType === 'agent' ||
      typeof options?.ifMatch === 'string';
    const beforeReadToken = needsReadProof ? readEdgesToken(edgeEntries)
        : undefined;
    if (isRecord(edgeData)) {
      const source = typeof edgeData.source === 'string' ? edgeData.source : '';
      const target = typeof edgeData.target === 'string' ? edgeData.target : '';
      if (source && target) {
        const readProof = needsReadProof
          ? validateCanvasEdgesReadProof({
              operation: 'add',
              actorClientType: options?.actorClientType,
              edges: readProofEdges(edgeEntries),
              expectedReadToken: options?.ifMatch,
              })
          : { ok: true as const };
        const edgeGuard = validateCanvasEdgeAdd({
          edge: { source, target },
          nodes: readGuardrailNodes(doc.getMap('nodes').entries()),
          edges: currentEdges,
          });
        const guard = readProof.ok ? edgeGuard : readProof;
        const hostMutation = validateHostMutationEnvelope({
          operation: 'canvas_add_edge',
          entity: { kind: 'canvas-edge', id: edgeId },
          expectedReadToken: options?.ifMatch,
          currentReadToken: beforeReadToken,
            guard,
        });
        if (!guard.ok) {
          console.warn(`[useLoroSync] Blocked edge add for ${edgeId}: ${guard.error}`);
          if (!hostMutation.ok) callbacksRef.current.onMutation?.(hostMutation.mutation);
          const { nodes, edges, tasks } = readStateFromLoro();
          const cb = callbacksRef.current;
          if (cb.onNodesChange) cb.onNodesChange(nodes);
          if (cb.onEdgesChange) cb.onEdgesChange(edges);
          if (cb.onTaskUpdate) tasks.forEach((t) => cb.onTaskUpdate!(t.id, t.data));
          return false;
        }
          canvas.insertEdge(edgeId,
            source,
            target,
            typeof edgeData.type === "string" ? edgeData.type : "default",
          );
          if (
            typeof edgeData.sourceHandle === "string" ||
            typeof edgeData.targetHandle === "string"
          ) {
            canvas.updateEdge(edgeId, {
              ...(typeof edgeData.sourceHandle === "string"
                ? { sourceHandle: edgeData.sourceHandle }
                : {}),
              ...(typeof edgeData.targetHandle === "string"
                ? { targetHandle: edgeData.targetHandle }
                : {}),
            });
          }
        } else {
          return false;
        }
      } else {
        return false;
      }
      doc.commit(); // Commit to trigger subscribeLocalUpdate
    callbacksRef.current.onMutation?.(hostMutationSucceeded({
      operation: 'canvas_add_edge',
      entity: { kind: 'canvas-edge', id: edgeId },
      ...(options?.ifMatch ? { expectedReadToken: options.ifMatch } : {}),
      ...(beforeReadToken ? { beforeReadToken } : {}),
          }, {
      resultEntityId: edgeId,
      afterReadToken: needsReadProof ? readEdgesToken(
                  canvas.listEdges().map((edge) => [edge.id, edge] as const),
                )
              : undefined,
    }));
    return true;
  }, [doc, readStateFromLoro]);

  const updateEdge = useCallback((edgeId: string, edgeData: any, options?: LoroHostWriteOptions) => {
    const canvas = new Canvas(doc, () => {}, canvasIdRef.current);
      const currentEdges = canvas.listEdges();
    const existing = currentEdges.find((edge) => edge.id === edgeId);
    const beforeReadToken = readEdgeToken(edgeId, existing);
    const existingEdge = isRecord(existing) &&
      typeof existing.source === 'string' &&
      typeof existing.target === 'string'
      ? { source: existing.source, target: existing.target }
      : null;
    const proofEdge = readProofEdge(edgeId, existing);
    const readProof = proofEdge
      ? validateCanvasEdgeReadProof({
          operation: 'update',
          actorClientType: options?.actorClientType,
          edge: proofEdge,
          expectedReadToken: options?.ifMatch,
          })
      : { ok: true as const };
    const patchGuard = validateCanvasEdgePatch({
      existingEdge,
      patch: isRecord(edgeData) ? edgeData : {},
      nodes: readGuardrailNodes(doc.getMap('nodes').entries()),
      edges: currentEdges,
      });
    const guard = readProof.ok ? patchGuard : readProof;
    const hostMutation = validateHostMutationEnvelope({
      operation: 'canvas_update_edge',
      entity: { kind: 'canvas-edge', id: edgeId },
      expectedReadToken: options?.ifMatch,
      currentReadToken: beforeReadToken,
        guard,
    });
    if (!guard.ok) {
      console.warn(`[useLoroSync] Blocked edge update for ${edgeId}: ${guard.error}`);
      if (!hostMutation.ok) callbacksRef.current.onMutation?.(hostMutation.mutation);
      const { nodes, edges, tasks } = readStateFromLoro();
      const cb = callbacksRef.current;
      if (cb.onNodesChange) cb.onNodesChange(nodes);
      if (cb.onEdgesChange) cb.onEdgesChange(edges);
      if (cb.onTaskUpdate) tasks.forEach((t) => cb.onTaskUpdate!(t.id, t.data));
      return false;
    }
      if (!canvas.updateEdge(edgeId, isRecord(edgeData) ? edgeData : {}))
        return false;
    doc.commit(); // Commit to trigger subscribeLocalUpdate
      const updated = canvas.listEdges().find((edge) => edge.id === edgeId);
      callbacksRef.current.onMutation?.(hostMutationSucceeded(
      hostMutation.ok ? hostMutation.envelope : {
        operation: 'canvas_update_edge',
        entity: { kind: 'canvas-edge', id: edgeId },
              },
      { resultEntityId: edgeId, afterReadToken: readEdgeToken(edgeId, updated),
          },
    ));
    return true;
  }, [doc, readStateFromLoro]);

  const removeEdge = useCallback((edgeId: string, options?: LoroHostWriteOptions) => {
    const canvas = new Canvas(doc, () => {}, canvasIdRef.current);
      const currentEdges = canvas.listEdges();
    const existing = currentEdges.find((edge) => edge.id === edgeId);
    let hostMutation: ReturnType<typeof validateHostMutationEnvelope> | null = null;
    if (isRecord(existing)) {
      const beforeReadToken = readEdgeToken(edgeId, existing);
      const nodesMap = doc.getMap('nodes');
      const edges = currentEdges;
      const nodes: Array<{ id: string; type?: string; data?: Record<string, unknown>;
        }> = [];
      for (const [id, rawNode] of nodesMap.entries()) {
        if (typeof id !== 'string' || !isRecord(rawNode)) continue;
        nodes.push({
          id,
          type: typeof rawNode.type === 'string' ? rawNode.type : undefined,
          data: isRecord(rawNode.data) ? rawNode.data : undefined,
        });
      }
      const proofEdge = readProofEdge(edgeId, existing);
      const readProof = proofEdge
        ? validateCanvasEdgeReadProof({
            operation: 'delete',
            actorClientType: options?.actorClientType,
            edge: proofEdge,
            expectedReadToken: options?.ifMatch,
            })
        : { ok: true as const };
      const deleteGuard = validateCanvasEdgeDelete({
        edge: {
          source: typeof existing.source === 'string' ? existing.source : '',
          target: typeof existing.target === 'string' ? existing.target : '',
        },
        nodes,
        edges,
        });
      const guard = readProof.ok ? deleteGuard : readProof;
      hostMutation = validateHostMutationEnvelope({
        operation: 'canvas_delete_edge',
        entity: { kind: 'canvas-edge', id: edgeId },
        expectedReadToken: options?.ifMatch,
        currentReadToken: beforeReadToken,
          guard,
      });
      if (!guard.ok) {
        console.warn(`[useLoroSync] Blocked edge delete for ${edgeId}: ${guard.error}`);
        if (!hostMutation.ok) callbacksRef.current.onMutation?.(hostMutation.mutation);
        const { nodes: currentNodes, edges: currentEdges, tasks } = readStateFromLoro();
        const cb = callbacksRef.current;
        if (cb.onNodesChange) cb.onNodesChange(currentNodes);
        if (cb.onEdgesChange) cb.onEdgesChange(currentEdges);
        if (cb.onTaskUpdate) tasks.forEach((t) => cb.onTaskUpdate!(t.id, t.data));
        return false;
      }
    }
      if (!canvas.deleteEdge(edgeId)) return false;
    doc.commit(); // Commit to trigger subscribeLocalUpdate
    callbacksRef.current.onMutation?.(hostMutationSucceeded(
      hostMutation?.ok ? hostMutation.envelope : {
        operation: 'canvas_delete_edge',
        entity: { kind: 'canvas-edge', id: edgeId },
              },
      {
      resultEntityId: edgeId,
      },
    ));
    return true;
  }, [doc, readStateFromLoro]);

  // Replay the doc's current state into React. Used by undo/redo, because the
  // subscribe handler skips `event.by === 'local'` to avoid echo-loops with
  // the caller-state path used by addNode/updateNode/... — but undo/redo DO
  // need React to re-read, since their "caller" never held the new state.
  const pushStateToReact = useCallback(() => {
    const { nodes, edges, tasks } = readStateFromLoro();
    const cb = callbacksRef.current;
    if (cb.onNodesChange) cb.onNodesChange(nodes);
    if (cb.onEdgesChange) cb.onEdgesChange(edges);
    if (cb.onTaskUpdate) tasks.forEach((t) => cb.onTaskUpdate!(t.id, t.data));
  }, [readStateFromLoro]);

  const undo = useCallback(() => {
    if (undoManager.canUndo()) {
      undoManager.undo();
      doc.commit(); // Commit to trigger subscribeLocalUpdate
      pushStateToReact();
      updateUndoRedoState();
    }
  }, [doc, undoManager, updateUndoRedoState, pushStateToReact]);

  const redo = useCallback(() => {
    if (undoManager.canRedo()) {
      undoManager.redo();
      doc.commit(); // Commit to trigger subscribeLocalUpdate
      pushStateToReact();
      updateUndoRedoState();
    }
  }, [doc, undoManager, updateUndoRedoState, pushStateToReact]);

  return {
    projectId,
    doc,
    connected,
    isInitialized,
    canvases,
    createCanvas,
    renameCanvas,
    deleteCanvas,
    timelines,
    standaloneTimelines: timelines.filter(
      (timeline) => timeline.owner.kind === "project",
    ),
    createTimeline,
    attachTimeline,
    detachTimeline,
    addNode,
    updateNode,
    applyTimelineDsl,
    removeNode,
    removeNodes,
    addEdge,
    updateEdge,
    removeEdge,
    undo,
    redo,
    canUndo,
    canRedo,
    sendSideband,
  };
}
