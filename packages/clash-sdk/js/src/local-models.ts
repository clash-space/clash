import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { delimiter } from 'node:path';

export type LocalModelKind = 'asr' | 'tts' | 'image' | 'video' | 'audio' | 'text';
export type LocalSpeechCapability = 'speech-to-text' | 'text-to-speech';
export type LocalModelRpcMethod = 'status' | 'deploy' | 'remove' | 'warmup' | 'transcribe' | 'synthesize';

export interface LocalModelStatus {
  available: boolean;
  message?: string;
}

export interface LocalModelDeployInput {
  model: string;
  kind?: LocalModelKind;
  cacheDir?: string;
}

export interface LocalModelStatusInput {
  model: string;
  cacheDir?: string;
}

export interface LocalModelRemoveInput {
  model: string;
  cacheDir?: string;
}

export interface LocalAsrTranscribeInput {
  model: string;
  audioPath: string;
  language?: string | null;
}

export interface LocalAsrWord {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  speakerId?: string;
}

export interface LocalAsrSegment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  wordIds: string[];
  speakerId?: string;
}

export interface LocalAsrTranscription {
  schemaVersion: 1;
  kind: 'clash.asr.timed-transcript';
  timebase: 'milliseconds';
  alignment: 'word';
  text: string;
  backendId: string;
  modelId: string;
  language?: string;
  durationMs: number;
  words: LocalAsrWord[];
  segments: LocalAsrSegment[];
}

export interface LocalAsrRuntime {
  status(input: LocalModelStatusInput): Promise<LocalModelStatus>;
  deploy(input: LocalModelDeployInput): Promise<void>;
  remove?(input: LocalModelRemoveInput): Promise<void>;
  warmup?(input: LocalModelStatusInput): Promise<LocalModelStatus>;
  transcribe(input: LocalAsrTranscribeInput): Promise<LocalAsrTranscription>;
}

export interface LocalTtsSynthesizeInput {
  model: string;
  text: string;
  outputPath: string;
  cacheDir?: string;
  voice?: string | null;
  speed?: number;
}

export interface LocalTtsSynthesis {
  schemaVersion: 1;
  kind: 'clash.tts.audio';
  backendId: string;
  modelId: string;
  voiceId?: string;
  format: 'wav';
  sampleRate: number;
  durationMs: number;
  outputPath: string;
}

export interface LocalTtsRuntime {
  status(input: LocalModelStatusInput): Promise<LocalModelStatus>;
  deploy(input: LocalModelDeployInput): Promise<void>;
  remove(input: LocalModelRemoveInput): Promise<void>;
  warmup?(input: LocalModelStatusInput): Promise<LocalModelStatus>;
  synthesize(input: LocalTtsSynthesizeInput): Promise<LocalTtsSynthesis>;
}

export interface LocalModelRpcRequest {
  method: LocalModelRpcMethod;
  params: Record<string, unknown>;
}

export type LocalModelRpcResponse =
  | { id?: string; ok: true; result?: unknown }
  | { id?: string; ok: false; error: string };

export type LocalModelRpcInvoker = (request: LocalModelRpcRequest) => Promise<unknown>;

export interface PythonLocalModelRuntimeOptions {
  pythonBinary?: string;
  adapter?: string;
  pythonPath?: string | string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
  timeoutMs?: number;
  invokeRpc?: LocalModelRpcInvoker;
  cacheDir?: string;
}

export interface PythonLocalAsrRuntimeOptions extends PythonLocalModelRuntimeOptions {
  adapter?: 'asr' | 'funasr' | 'whisper' | 'vibevoice' | string;
}

export interface PythonLocalTtsRuntimeOptions extends PythonLocalModelRuntimeOptions {
  adapter?: 'tts' | 'piper' | 'kokoro' | string;
}

interface PersistentPythonWorkerConfig {
  pythonBinary: string;
  pythonPath: string[];
  env: Record<string, string | undefined>;
  cwd: string;
}

const persistentPythonWorkers = new Map<string, PersistentPythonWorker>();
let pythonRpcRequestSequence = 0;

class PythonLocalModelRpcClient {
  private readonly adapter: string;
  private readonly workerConfig: PersistentPythonWorkerConfig;
  private readonly timeoutMs: number;
  private readonly invokeRpc?: LocalModelRpcInvoker;

  constructor(options: PythonLocalModelRuntimeOptions, defaultAdapter: string) {
    this.adapter = options.adapter ?? defaultAdapter;
    this.workerConfig = {
      pythonBinary: options.pythonBinary ?? 'python3',
      pythonPath: Array.isArray(options.pythonPath)
        ? options.pythonPath.filter(Boolean)
        : options.pythonPath
          ? [options.pythonPath]
          : [],
      env: options.env ?? {},
      cwd: options.cwd ?? process.cwd(),
    };
    this.timeoutMs = options.timeoutMs ?? 30 * 60_000;
    this.invokeRpc = options.invokeRpc;
  }

  async request(request: LocalModelRpcRequest): Promise<unknown> {
    const response = this.invokeRpc
      ? await this.invokeRpc(request)
      : await this.requestPersistentPythonRpc(request);
    return unwrapRpcResponse(response);
  }

  private requestPersistentPythonRpc(request: LocalModelRpcRequest): Promise<unknown> {
    const worker = ensurePersistentPythonWorker(this.workerConfig);
    const id = `${process.pid}-${Date.now()}-${pythonRpcRequestSequence += 1}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        failPersistentPythonWorker(worker, new Error(`Local model RPC timed out after ${this.timeoutMs}ms`));
        worker.child.kill('SIGKILL');
      }, this.timeoutMs);
      worker.pending.set(id, { resolve, reject, timer });
      worker.child.stdin.write(`${JSON.stringify({ ...request, adapter: this.adapter, id })}\n`, (error) => {
        if (error) failPersistentPythonWorker(worker, error);
      });
    });
  }
}

function ensurePersistentPythonWorker(config: PersistentPythonWorkerConfig): PersistentPythonWorker {
  const poolKey = persistentPythonWorkerKey(config);
  const existing = persistentPythonWorkers.get(poolKey);
  if (existing && !existing.closed) return existing;
  const env = {
    ...process.env,
    ...config.env,
  };
  if (config.pythonPath.length > 0) {
    env.PYTHONPATH = [config.pythonPath.join(delimiter), env.PYTHONPATH].filter(Boolean).join(delimiter);
  }
  const child = spawn(
    config.pythonBinary,
    ['-m', 'clash_sdk.local_models.rpc', 'router'],
    {
      cwd: config.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.unref();
  unrefNodeStream(child.stdin);
  unrefNodeStream(child.stdout);
  unrefNodeStream(child.stderr);
  const worker: PersistentPythonWorker = {
    child,
    poolKey,
    closed: false,
    stdoutBuffer: '',
    stderr: '',
    pending: new Map(),
  };
  persistentPythonWorkers.set(poolKey, worker);
  child.stdout.on('data', (chunk: string) => {
    worker.stdoutBuffer += chunk;
    const lines = worker.stdoutBuffer.split(/\r?\n/g);
    worker.stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) handlePersistentPythonWorkerLine(worker, line);
  });
  child.stderr.on('data', (chunk: string) => {
    worker.stderr = `${worker.stderr}${chunk}`.slice(-16_384);
  });
  child.once('error', (error) => failPersistentPythonWorker(worker, error));
  child.once('close', (code) => {
    if (worker.stdoutBuffer.trim()) handlePersistentPythonWorkerLine(worker, worker.stdoutBuffer);
    failPersistentPythonWorker(
      worker,
      new Error(worker.stderr.trim() || `Local model RPC exited with code ${code ?? 'unknown'}`),
    );
  });
  return worker;
}

function persistentPythonWorkerKey(config: PersistentPythonWorkerConfig): string {
  const env = Object.entries(config.env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([config.pythonBinary, config.cwd, config.pythonPath, env]);
}

function unrefNodeStream(stream: unknown): void {
  const candidate = stream as { unref?: () => void } | null;
  candidate?.unref?.();
}

function handlePersistentPythonWorkerLine(worker: PersistentPythonWorker, line: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== 'object' || typeof (parsed as { id?: unknown }).id !== 'string') return;
  const id = (parsed as { id: string }).id;
  const pending = worker.pending.get(id);
  if (!pending) return;
  clearTimeout(pending.timer);
  worker.pending.delete(id);
  pending.resolve(parsed);
}

function failPersistentPythonWorker(worker: PersistentPythonWorker, error: Error): void {
  if (persistentPythonWorkers.get(worker.poolKey) === worker) {
    persistentPythonWorkers.delete(worker.poolKey);
  }
  if (worker.closed) return;
  worker.closed = true;
  for (const pending of worker.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  worker.pending.clear();
}

interface PendingPythonRpcRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface PersistentPythonWorker {
  child: ChildProcessWithoutNullStreams;
  poolKey: string;
  closed: boolean;
  stdoutBuffer: string;
  stderr: string;
  pending: Map<string, PendingPythonRpcRequest>;
}

export class PythonLocalAsrRuntime implements LocalAsrRuntime {
  private readonly client: PythonLocalModelRpcClient;
  private readonly cacheDir?: string;

  constructor(options: PythonLocalAsrRuntimeOptions = {}) {
    this.client = new PythonLocalModelRpcClient(options, 'asr');
    this.cacheDir = options.cacheDir;
  }

  async status(input: LocalModelStatusInput): Promise<LocalModelStatus> {
    const cacheDir = input.cacheDir ?? this.cacheDir;
    const result = await this.client.request({
      method: 'status',
      params: {
        model: input.model,
        ...(cacheDir ? { cache_dir: cacheDir } : {}),
      },
    });
    return asStatus(result);
  }

  async deploy(input: LocalModelDeployInput): Promise<void> {
    const cacheDir = input.cacheDir ?? this.cacheDir;
    await this.client.request({
      method: 'deploy',
      params: {
        model: input.model,
        kind: input.kind ?? 'asr',
        ...(cacheDir ? { cache_dir: cacheDir } : {}),
      },
    });
  }

  async remove(input: LocalModelRemoveInput): Promise<void> {
    const cacheDir = input.cacheDir ?? this.cacheDir;
    await this.client.request({
      method: 'remove',
      params: {
        model: input.model,
        ...(cacheDir ? { cache_dir: cacheDir } : {}),
      },
    });
  }

  async warmup(input: LocalModelStatusInput): Promise<LocalModelStatus> {
    const cacheDir = input.cacheDir ?? this.cacheDir;
    const result = await this.client.request({
      method: 'warmup',
      params: {
        model: input.model,
        ...(cacheDir ? { cache_dir: cacheDir } : {}),
      },
    });
    return asStatus(result);
  }

  async transcribe(input: LocalAsrTranscribeInput): Promise<LocalAsrTranscription> {
    const cacheDir = this.cacheDir;
    const result = await this.client.request({
      method: 'transcribe',
      params: {
        model: input.model,
        audio_path: input.audioPath,
        language: input.language ?? null,
        ...(cacheDir ? { cache_dir: cacheDir } : {}),
      },
    });
    return asTranscription(result);
  }
}

export class PythonLocalTtsRuntime implements LocalTtsRuntime {
  private readonly client: PythonLocalModelRpcClient;
  private readonly cacheDir?: string;

  constructor(options: PythonLocalTtsRuntimeOptions = {}) {
    this.client = new PythonLocalModelRpcClient(options, 'tts');
    this.cacheDir = options.cacheDir;
  }

  async status(input: LocalModelStatusInput): Promise<LocalModelStatus> {
    const cacheDir = input.cacheDir ?? this.cacheDir;
    const result = await this.client.request({
      method: 'status',
      params: {
        model: input.model,
        ...(cacheDir ? { cache_dir: cacheDir } : {}),
      },
    });
    return asStatus(result);
  }

  async deploy(input: LocalModelDeployInput): Promise<void> {
    const cacheDir = input.cacheDir ?? this.cacheDir;
    await this.client.request({
      method: 'deploy',
      params: {
        model: input.model,
        kind: input.kind ?? 'tts',
        ...(cacheDir ? { cache_dir: cacheDir } : {}),
      },
    });
  }

  async remove(input: LocalModelRemoveInput): Promise<void> {
    const cacheDir = input.cacheDir ?? this.cacheDir;
    await this.client.request({
      method: 'remove',
      params: {
        model: input.model,
        ...(cacheDir ? { cache_dir: cacheDir } : {}),
      },
    });
  }

  async warmup(input: LocalModelStatusInput): Promise<LocalModelStatus> {
    const cacheDir = input.cacheDir ?? this.cacheDir;
    const result = await this.client.request({
      method: 'warmup',
      params: {
        model: input.model,
        ...(cacheDir ? { cache_dir: cacheDir } : {}),
      },
    });
    return asStatus(result);
  }

  async synthesize(input: LocalTtsSynthesizeInput): Promise<LocalTtsSynthesis> {
    const cacheDir = input.cacheDir ?? this.cacheDir;
    const result = await this.client.request({
      method: 'synthesize',
      params: {
        model: input.model,
        text: input.text,
        output_path: input.outputPath,
        ...(cacheDir ? { cache_dir: cacheDir } : {}),
        ...(input.voice ? { voice: input.voice } : {}),
        ...(input.speed === undefined ? {} : { speed: input.speed }),
      },
    });
    return asSynthesis(result);
  }
}

export function createPythonLocalAsrRuntime(options: PythonLocalAsrRuntimeOptions = {}): LocalAsrRuntime {
  return new PythonLocalAsrRuntime(options);
}

export function createPythonLocalTtsRuntime(options: PythonLocalTtsRuntimeOptions = {}): LocalTtsRuntime {
  return new PythonLocalTtsRuntime(options);
}

function unwrapRpcResponse(response: unknown): unknown {
  if (response && typeof response === 'object' && 'ok' in response) {
    const envelope = response as LocalModelRpcResponse;
    if (!envelope.ok) throw new Error(envelope.error || 'Local model RPC failed');
    return envelope.result ?? {};
  }
  return response;
}

function asStatus(value: unknown): LocalModelStatus {
  if (!value || typeof value !== 'object') return { available: false, message: 'Local model runtime returned no status' };
  const raw = value as Record<string, unknown>;
  return {
    available: raw.available === true,
    ...(typeof raw.message === 'string' && raw.message ? { message: raw.message } : {}),
  };
}

function asTranscription(value: unknown): LocalAsrTranscription {
  if (!value || typeof value !== 'object') {
    throw new Error('Local ASR runtime returned no transcript');
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.schemaVersion !== 1
    || raw.kind !== 'clash.asr.timed-transcript'
    || raw.timebase !== 'milliseconds'
    || raw.alignment !== 'word'
  ) {
    throw new Error('Local ASR runtime returned a transcript without word alignment metadata');
  }
  const text = requiredString(raw.text, 'transcript text');
  const backendId = requiredString(raw.backendId, 'backendId');
  const modelId = requiredString(raw.modelId, 'modelId');
  const durationMs = nonNegativeInteger(raw.durationMs, 'durationMs');
  if (!Array.isArray(raw.words) || raw.words.length === 0) {
    throw new Error('Local ASR runtime returned no word timestamps');
  }
  const words = raw.words.map((word, index) => asWord(word, index));
  const ids = new Set<string>();
  let previousStartMs = -1;
  for (const word of words) {
    if (ids.has(word.id)) throw new Error(`Local ASR returned duplicate word id: ${word.id}`);
    ids.add(word.id);
    if (word.startMs < previousStartMs) throw new Error('Local ASR words must be ordered by startMs');
    previousStartMs = word.startMs;
    if (word.endMs > durationMs) throw new Error(`Local ASR word ${word.id} exceeds durationMs`);
  }
  if (!Array.isArray(raw.segments)) {
    throw new Error('Local ASR runtime returned no segments array');
  }
  const segments = raw.segments.map((segment, index) => asSegment(segment, index, ids));
  return {
    schemaVersion: 1,
    kind: 'clash.asr.timed-transcript',
    timebase: 'milliseconds',
    alignment: 'word',
    text,
    backendId,
    modelId,
    ...(typeof raw.language === 'string' && raw.language.trim() ? { language: raw.language.trim() } : {}),
    durationMs,
    words,
    segments,
  };
}

function asSynthesis(value: unknown): LocalTtsSynthesis {
  if (!value || typeof value !== 'object') {
    throw new Error('Local TTS runtime returned no audio metadata');
  }
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1 || raw.kind !== 'clash.tts.audio' || raw.format !== 'wav') {
    throw new Error('Local TTS runtime returned unsupported audio metadata');
  }
  const backendId = requiredString(raw.backendId, 'TTS backendId');
  const modelId = requiredString(raw.modelId, 'TTS modelId');
  const sampleRate = positiveInteger(raw.sampleRate, 'TTS sampleRate');
  const durationMs = positiveInteger(raw.durationMs, 'TTS durationMs');
  const outputPath = requiredString(raw.outputPath, 'TTS outputPath');
  return {
    schemaVersion: 1,
    kind: 'clash.tts.audio',
    backendId,
    modelId,
    ...(typeof raw.voiceId === 'string' && raw.voiceId.trim() ? { voiceId: raw.voiceId.trim() } : {}),
    format: 'wav',
    sampleRate,
    durationMs,
    outputPath,
  };
}

function asWord(value: unknown, index: number): LocalAsrWord {
  if (!value || typeof value !== 'object') throw new Error(`Local ASR word ${index} must be an object`);
  const raw = value as Record<string, unknown>;
  const id = requiredString(raw.id, `word ${index} id`);
  const text = requiredString(raw.text, `word ${id} text`);
  const startMs = nonNegativeInteger(raw.startMs, `word ${id} startMs`);
  const endMs = nonNegativeInteger(raw.endMs, `word ${id} endMs`);
  if (endMs <= startMs) throw new Error(`Local ASR word ${id} endMs must be greater than startMs`);
  const confidence = optionalConfidence(raw.confidence, `word ${id} confidence`);
  return {
    id,
    text,
    startMs,
    endMs,
    ...(confidence === undefined ? {} : { confidence }),
    ...(typeof raw.speakerId === 'string' && raw.speakerId.trim() ? { speakerId: raw.speakerId.trim() } : {}),
  };
}

function asSegment(value: unknown, index: number, wordIds: Set<string>): LocalAsrSegment {
  if (!value || typeof value !== 'object') throw new Error(`Local ASR segment ${index} must be an object`);
  const raw = value as Record<string, unknown>;
  const id = requiredString(raw.id, `segment ${index} id`);
  const text = requiredString(raw.text, `segment ${id} text`);
  const startMs = nonNegativeInteger(raw.startMs, `segment ${id} startMs`);
  const endMs = nonNegativeInteger(raw.endMs, `segment ${id} endMs`);
  if (endMs <= startMs) throw new Error(`Local ASR segment ${id} endMs must be greater than startMs`);
  if (!Array.isArray(raw.wordIds)) throw new Error(`Local ASR segment ${id} wordIds must be an array`);
  const segmentWordIds = raw.wordIds.map((wordId, wordIndex) => requiredString(wordId, `segment ${id} wordIds[${wordIndex}]`));
  for (const wordId of segmentWordIds) {
    if (!wordIds.has(wordId)) throw new Error(`Local ASR segment ${id} references unknown word id: ${wordId}`);
  }
  return {
    id,
    text,
    startMs,
    endMs,
    wordIds: segmentWordIds,
    ...(typeof raw.speakerId === 'string' && raw.speakerId.trim() ? { speakerId: raw.speakerId.trim() } : {}),
  };
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Local ASR ${label} is required`);
  return value.trim();
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Local ASR ${label} must be a non-negative integer`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Local ${label} must be a positive integer`);
  }
  return value;
}

function optionalConfidence(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Local ASR ${label} must be between 0 and 1`);
  }
  return value;
}
