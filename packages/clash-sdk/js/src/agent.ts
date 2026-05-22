/**
 * ClashAgent — connects to ProjectRoom via WebSocket, registers
 * actions, executes incoming tasks.
 *
 * Wire-protocol parity with the Python SDK (see
 * `packages/clash-sdk/python/clash_sdk/agent.py`). Behavioural rules
 * worth noting:
 *
 *   1. Dedup happens at receive (`_handleTextMessage`) BEFORE
 *      scheduling the async handler. Python had a double-dedup bug
 *      that silently bailed; we don't repeat it here.
 *   2. Each binary output gets its own POST to `/api/custom-action/upload`
 *      with `outputIndex` — the server suffixes R2 keys + asset ids
 *      so siblings from the same task don't overwrite each other.
 *   3. Failures send `status: 'failed' + result.assets: []` so the
 *      server marks the primary pending child failed without spawning
 *      any siblings (matches Python's failure path).
 */

import WebSocket from 'ws';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  ActionContext,
  ActionDefinition,
  ActionResult,
  AssetOutput,
  RunOptions,
} from './types.js';

/**
 * Convert ws://host → http://host (and wss://→https://). Falls through
 * for already-HTTP URLs — caller may pass either form.
 */
function toHttpUrl(serverUrl: string): string {
  if (serverUrl.startsWith('ws://')) return 'http://' + serverUrl.slice(5);
  if (serverUrl.startsWith('wss://')) return 'https://' + serverUrl.slice(6);
  return serverUrl;
}

function toWsUrl(serverUrl: string): string {
  if (serverUrl.startsWith('http://')) return 'ws://' + serverUrl.slice(7);
  if (serverUrl.startsWith('https://')) return 'wss://' + serverUrl.slice(8);
  return serverUrl;
}

function extOf(modality: AssetOutput['type']): string {
  switch (modality) {
    case 'video': return 'mp4';
    case 'audio': return 'mp3';
    case 'image': return 'png';
    case 'text':  return 'txt';
  }
}

function defaultMime(modality: AssetOutput['type']): string {
  switch (modality) {
    case 'video': return 'video/mp4';
    case 'audio': return 'audio/mpeg';
    case 'image': return 'image/png';
    case 'text':  return 'text/plain';
  }
}

export class ClashAgent {
  private ws: WebSocket | null = null;
  private readonly actions: Map<string, ActionDefinition>;
  private readonly seenTasks = new Set<string>();
  private running = false;
  private readonly httpUrl: string;
  private readonly wsUrl: string;

  constructor(private readonly opts: RunOptions) {
    if (!opts.runtimeId) {
      throw new Error(
        'CLASH_RUNTIME_ID missing — set it from ~/.clash/credentials.json#runtimeId. ' +
          'The server rejects registrations without an x-runtime-id header.',
      );
    }
    this.actions = new Map(opts.actions.map((a) => [a.id, a]));
    this.httpUrl = toHttpUrl(opts.serverUrl).replace(/\/$/, '');
    this.wsUrl = toWsUrl(opts.serverUrl).replace(/\/$/, '');
  }

  async run(): Promise<void> {
    await this.connect();
    this.running = true;
    await this.runLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          type: 'unregister_custom_actions',
          actionIds: Array.from(this.actions.keys()),
        }));
      } catch { /* socket may be racing close */ }
      this.ws.close(1000, 'shutdown');
    }
  }

  private async connect(): Promise<void> {
    const url = `${this.wsUrl}/sync/${this.opts.projectId}?token=${encodeURIComponent(this.opts.apiKey)}`;
    this.log(`Connecting to ${url} (runtime_id=${this.opts.runtimeId.slice(0, 8)}…)`);
    const ws = new WebSocket(url, {
      headers: {
        'x-client-type': 'cli',
        'x-runtime-id': this.opts.runtimeId,
      },
    });

    // Wait for open + the server's initial binary snapshot. ProjectRoom
    // always sends a Loro snapshot as the first frame; we can ignore
    // its contents (we don't parse Loro CRDT in JS — same as Python).
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => { cleanup(); reject(err); };
      const onClose = (code: number, reason: Buffer) => {
        cleanup();
        reject(new Error(`WS closed before open: ${code} ${reason.toString()}`));
      };
      const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
        if (!isBinary) return; // text frames will arrive after snapshot
        cleanup();
        this.log(`Received initial snapshot (${(data as Buffer).length} bytes)`);
        resolve();
      };
      const cleanup = () => {
        ws.off('error', onError);
        ws.off('close', onClose);
        ws.off('message', onMessage);
      };
      ws.once('error', onError);
      ws.once('close', onClose);
      ws.on('message', onMessage);
    });

    this.ws = ws;
    ws.send(JSON.stringify({
      type: 'register_custom_actions',
      actions: Array.from(this.actions.values()).map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description ?? '',
        parameters: a.parameters ?? [],
        outputType: a.outputType,
        icon: a.icon ?? '',
        color: a.color ?? '',
        promptModalities: a.promptModalities ?? ['text'],
        runtime: 'local',
      })),
    }));
    this.log(`Registered ${this.actions.size} action(s): [${[...this.actions.keys()].join(', ')}]`);
  }

  private async runLoop(): Promise<void> {
    if (!this.ws) throw new Error('not connected');
    const ws = this.ws;

    return new Promise<void>((resolve) => {
      ws.on('message', (data, isBinary) => {
        if (isBinary) return; // ignore Loro CRDT frames
        const text = (data as Buffer).toString('utf-8');
        this.handleTextMessage(text);
      });
      ws.once('close', (code, reason) => {
        this.log(`WS closed code=${code} reason=${reason.toString() || '—'}`);
        resolve();
      });
      ws.once('error', (err) => {
        this.log(`WS error: ${err.message}`);
        // Don't reject — let close handler resolve. Same shape as Python SDK.
      });
    });
  }

  private handleTextMessage(text: string): void {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      return;
    }

    if (data.type !== 'custom_task_assigned') return;

    const task = (data.task ?? {}) as Record<string, unknown>;
    const taskId = task.taskId as string | undefined;
    if (!taskId) {
      this.log('custom_task_assigned with no taskId, ignoring');
      return;
    }
    // Dedup BEFORE scheduling — two sideband messages arriving in the
    // same event-loop tick would otherwise both queue handlers before
    // either added to seenTasks. Python had this exact bug.
    if (this.seenTasks.has(taskId)) return;
    this.seenTasks.add(taskId);

    void this.executeTask(task);
  }

  private async executeTask(task: Record<string, unknown>): Promise<void> {
    const taskId = task.taskId as string;
    const actionId = (task.customActionId as string) ?? '';
    const nodeId = task.nodeId as string;
    const projectId = (task.projectId as string) ?? this.opts.projectId;

    const def = this.actions.get(actionId);
    if (!def) {
      this.log(`No handler for action '${actionId}', skipping task ${taskId}`);
      return;
    }

    const startedAt = Date.now();
    this.log(`Executing task ${taskId} (action: ${actionId})`);

    const refs = (task.refs ?? {}) as Record<string, string[]>;
    const ctx: ActionContext = {
      taskId,
      nodeId,
      projectId,
      actionId,
      prompt: (task.prompt as string) ?? '',
      params: (task.params as Record<string, string | number | boolean>) ?? {},
      outputType: (task.outputType as AssetOutput['type']) ?? def.outputType,
      referenceImageR2Keys: refs.image ?? [],
      referenceVideoR2Keys: refs.video ?? [],
      referenceAudioR2Keys: refs.audio ?? [],
      fetchAsset: (key) => this.fetchAsset(key),
    };

    // Phase 0 attribution: server stamps actorUserId / actorAgentId
    // onto the task record before assigning it. Echo them back on
    // /api/custom-action/upload so the resulting asset row attributes
    // to the actor that placed the node (not the project owner).
    const actorUserId = (task.actorUserId as string) ?? '';
    const actorAgentId = (task.actorAgentId as string) ?? '';

    try {
      const result = await def.handler(ctx);
      const assets = await this.uploadOutputs(projectId, taskId, nodeId, result.outputs, actorUserId, actorAgentId);
      this.sendComplete(taskId, nodeId, 'completed', assets, result.description);
      this.log(`Task ${taskId} completed in ${Date.now() - startedAt}ms`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log(`Task ${taskId} failed: ${msg}`);
      this.sendComplete(taskId, nodeId, 'failed', [], undefined, msg);
    }
  }

  /**
   * Upload binary outputs to /api/custom-action/upload, one POST per
   * output with outputIndex set. Text outputs ride along in the
   * complete_custom_task message body (no R2 hop).
   */
  private async uploadOutputs(
    projectId: string,
    taskId: string,
    nodeId: string,
    outputs: AssetOutput[],
    actorUserId = '',
    actorAgentId = '',
  ): Promise<Array<Record<string, unknown>>> {
    const results: Array<Record<string, unknown>> = [];
    for (let idx = 0; idx < outputs.length; idx++) {
      const out = outputs[idx];
      if (out.type === 'text') {
        results.push({ type: 'text', content: out.content ?? '', label: out.label });
        continue;
      }
      if (!out.data) {
        throw new Error(`AssetOutput[${idx}] type=${out.type} has no data`);
      }
      const storageKey = await this.uploadOne(projectId, taskId, nodeId, out, idx, actorUserId, actorAgentId);
      results.push({
        type: out.type,
        storageKey,
        mimeType: out.mimeType,
        label: out.label,
      });
    }
    return results;
  }

  private async uploadOne(
    projectId: string,
    taskId: string,
    nodeId: string,
    out: AssetOutput,
    idx: number,
    actorUserId = '',
    actorAgentId = '',
  ): Promise<string> {
    const form = new FormData();
    form.set('projectId', projectId);
    form.set('taskId', taskId);
    form.set('nodeId', nodeId);
    form.set('outputType', out.type);
    form.set('outputIndex', String(idx));
    if (actorUserId) form.set('actorUserId', actorUserId);
    if (actorAgentId) form.set('actorAgentId', actorAgentId);
    // Node's BlobPart typing collides with Buffer<ArrayBufferLike> in
    // recent @types/node. Copying into a fresh Uint8Array gives the
    // FormData encoder a clean buffer.
    const src = out.data!;
    const bytes = src instanceof Uint8Array ? new Uint8Array(src) : new Uint8Array(src);
    const blob = new Blob([bytes], {
      type: out.mimeType ?? defaultMime(out.type),
    });
    form.set('file', blob, `result-${idx}.${extOf(out.type)}`);

    const res = await fetch(`${this.httpUrl}/api/custom-action/upload`, {
      method: 'POST',
      body: form,
      headers: { Authorization: `Bearer ${this.opts.apiKey}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Upload failed (${res.status}): ${body}`);
    }
    const json = (await res.json()) as { storageKey?: string };
    return json.storageKey ?? '';
  }

  private sendComplete(
    taskId: string,
    nodeId: string,
    status: 'completed' | 'failed',
    assets: Array<Record<string, unknown>>,
    description?: string,
    error?: string,
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const result: Record<string, unknown> = { assets };
    if (description) result.description = description;
    if (error) result.error = error;
    this.ws.send(JSON.stringify({
      type: 'complete_custom_task',
      taskId,
      nodeId,
      status,
      result,
    }));
  }

  /**
   * Fetch an asset's bytes by R2 storage key. Mirrors the Python
   * SDK's `fetch_asset` — hits /assets/sign with bearer auth, then
   * GETs the signed URL. The signing layer scopes access to the
   * project, so we don't need extra auth on the GET.
   */
  private async fetchAsset(r2Key: string): Promise<Buffer> {
    const signRes = await fetch(
      `${this.httpUrl}/assets/sign?key=${encodeURIComponent(r2Key)}`,
      { headers: { Authorization: `Bearer ${this.opts.apiKey}` } },
    );
    if (!signRes.ok) {
      throw new Error(`Sign failed (${signRes.status}): ${await signRes.text().catch(() => '')}`);
    }
    const { url } = (await signRes.json()) as { url?: string };
    if (!url) throw new Error(`No signed URL returned for ${r2Key}`);
    const absoluteUrl = url.startsWith('/') ? `${this.httpUrl}${url}` : url;
    const getRes = await fetch(absoluteUrl);
    if (!getRes.ok) {
      throw new Error(`Fetch failed (${getRes.status}): ${await getRes.text().catch(() => '')}`);
    }
    return Buffer.from(await getRes.arrayBuffer());
  }

  private log(msg: string): void {
    // Matches Python SDK's stderr-style chunks so users see a unified
    // log stream when running multiple SDKs side-by-side.
    process.stderr.write(`[clash-sdk] ${new Date().toISOString()} ${msg}\n`);
  }
}

/**
 * Top-level entry point — instantiate, connect, run until WS closes.
 * SIGTERM cleanly unregisters + closes the socket.
 */
export async function run(opts: RunOptions): Promise<void> {
  const agent = new ClashAgent(opts);
  const shutdown = async () => {
    try { await agent.stop(); } catch { /* best effort */ }
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  await agent.run();
}

// Suppress unused-import warning when tsup tree-shakes single-file
// builds — the `delay` + `randomUUID` imports are kept for future
// reconnect/backoff logic that mirrors Python's behaviour.
void delay; void randomUUID;
