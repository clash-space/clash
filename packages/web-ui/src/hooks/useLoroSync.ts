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
import { isSidebandMessage } from '@clash/shared-types';

// ReactFlow v12: parent nodes must appear before children in the nodes array.
function sortNodesParentFirst(nodes: Node[]): Node[] {
  const idSet = new Set(nodes.map((n) => n.id));
  const result: Node[] = [];
  const visited = new Set<string>();

  const visit = (node: Node) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    if (node.parentId && idSet.has(node.parentId)) {
      const parent = nodes.find((n) => n.id === node.parentId);
      if (parent) visit(parent);
    }
    result.push(node);
  };

  for (const node of nodes) visit(node);
  return result;
}

interface LoroSyncOptions {
  projectId: string;
  syncServerUrl?: string;
  onNodesChange?: (nodes: Node[]) => void;
  onEdgesChange?: (edges: Edge[]) => void;
  onTaskUpdate?: (taskId: string, taskData: any) => void;
  onPresenceChange?: (clients: PresenceClient[]) => void;
  onActivity?: (activity: ActivityMessage) => void;
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

export interface UseLoroSyncReturn {
  /** The project ID this sync is connected to */
  projectId: string;
  doc: LoroDoc | null;
  connected: boolean;
  /** Whether initial load from IndexedDB is complete */
  isInitialized: boolean;
  addNode: (nodeId: string, nodeData: any) => void;
  updateNode: (nodeId: string, nodeData: any) => void;
  removeNode: (nodeId: string) => void;
  addEdge: (edgeId: string, edgeData: any) => void;
  updateEdge: (edgeId: string, edgeData: any) => void;
  removeEdge: (edgeId: string) => void;
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
    syncServerUrl,
    onNodesChange,
    onEdgesChange,
    onTaskUpdate,
    onPresenceChange,
    onActivity,
    onRoomMessage,
    onAwareness,
  } = options;

  const [doc] = useState(() => new LoroDoc());
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
  const callbacksRef = useRef({ onNodesChange, onEdgesChange, onTaskUpdate, onPresenceChange, onActivity, onRoomMessage, onAwareness });
  useEffect(() => {
    callbacksRef.current = { onNodesChange, onEdgesChange, onTaskUpdate, onPresenceChange, onActivity, onRoomMessage, onAwareness };
  }, [onNodesChange, onEdgesChange, onTaskUpdate, onPresenceChange, onActivity, onRoomMessage, onAwareness]);

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
    const edgesMap = doc.getMap('edges');
    const tasksMap = doc.getMap('tasks');

    const nodeIds = new Set<string>();
    for (const [key] of nodesMap.entries()) {
      nodeIds.add(key);
    }

    const nodes: Node[] = [];
    const nodesToFix: Array<{ key: string; cleanedData: any }> = [];

    for (const [key, value] of nodesMap.entries()) {
      const nodeData = value as any;
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

    // v12 requires parent nodes to appear before their children in the nodes array.
    // Sort topologically: nodes without parentId first, then children in order.
    const sortedNodes = sortNodesParentFirst(nodes);

    const edges: Edge[] = [];
    for (const [key, value] of edgesMap.entries()) {
      edges.push({
        id: key,
        ...(value as any),
        interactionWidth: 30,
        focusable: true,
        selectable: true,
        deletable: true,
      });
    }

    const tasks: Array<{ id: string; data: any }> = [];
    for (const [key, value] of tasksMap.entries()) {
      tasks.push({ id: key, data: value });
    }

    return { nodes: sortedNodes, edges, tasks };
  }, [doc]);

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
        tasks.forEach(t => cb.onTaskUpdate!(t.id, t.data));
      }

      updateUndoRedoState();
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
        saveToDB(projectId, snapshot).catch(err => console.error('Failed to save local snapshot:', err));
      }, 1000);

      // Update undo/redo state
      updateUndoRedoState();

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
        tasks.forEach(t => cb.onTaskUpdate!(t.id, t.data));
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
    nodesMap.set(nodeId, nodeData);
    doc.commit(); // Commit to trigger subscribeLocalUpdate
    updateUndoRedoState();
  }, [doc, updateUndoRedoState]);

  const updateNode = useCallback((nodeId: string, nodeData: any) => {
    const nodesMap = doc.getMap('nodes');
    const existing = nodesMap.get(nodeId) as any;
    if (!existing) {
      nodesMap.set(nodeId, nodeData);
    } else {
      nodesMap.set(nodeId, {
        ...existing,
        ...nodeData,
        data: { ...(existing?.data || {}), ...(nodeData.data || {}) },
      });
    }
    doc.commit(); // Commit to trigger subscribeLocalUpdate
    updateUndoRedoState();
  }, [doc, updateUndoRedoState]);

  const removeNode = useCallback((nodeId: string) => {
    const nodesMap = doc.getMap('nodes');

    // Clean up children's parentId references before deleting the node
    // This prevents "Parent node X not found" errors in ReactFlow
    for (const [key, value] of nodesMap.entries()) {
      const nodeData = value as any;
      if (nodeData.parentId === nodeId) {
        // Remove the parentId reference from child nodes
        const { parentId: _parentId, extent: _extent, ...rest } = nodeData;
        nodesMap.set(key, rest);
      }
    }

    nodesMap.delete(nodeId);
    doc.commit(); // Commit to trigger subscribeLocalUpdate
    updateUndoRedoState();
  }, [doc, updateUndoRedoState]);

  const addEdge = useCallback((edgeId: string, edgeData: any) => {
    const edgesMap = doc.getMap('edges');
    edgesMap.set(edgeId, edgeData);
    doc.commit(); // Commit to trigger subscribeLocalUpdate
  }, [doc]);

  const updateEdge = useCallback((edgeId: string, edgeData: any) => {
    const edgesMap = doc.getMap('edges');
    const existing = edgesMap.get(edgeId) as any;
    edgesMap.set(edgeId, { ...existing, ...edgeData });
    doc.commit(); // Commit to trigger subscribeLocalUpdate
  }, [doc]);

  const removeEdge = useCallback((edgeId: string) => {
    const edgesMap = doc.getMap('edges');
    edgesMap.delete(edgeId);
    doc.commit(); // Commit to trigger subscribeLocalUpdate
  }, [doc]);

  // Replay the doc's current state into React. Used by undo/redo, because the
  // subscribe handler skips `event.by === 'local'` to avoid echo-loops with
  // the caller-state path used by addNode/updateNode/... — but undo/redo DO
  // need React to re-read, since their "caller" never held the new state.
  const pushStateToReact = useCallback(() => {
    const { nodes, edges, tasks } = readStateFromLoro();
    const cb = callbacksRef.current;
    if (cb.onNodesChange) cb.onNodesChange(nodes);
    if (cb.onEdgesChange) cb.onEdgesChange(edges);
    if (cb.onTaskUpdate) tasks.forEach(t => cb.onTaskUpdate!(t.id, t.data));
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
    addNode,
    updateNode,
    removeNode,
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
