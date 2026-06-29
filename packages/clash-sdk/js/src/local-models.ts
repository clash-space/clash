import { spawn } from 'node:child_process';
import { delimiter } from 'node:path';

export type LocalModelKind = 'asr' | 'image' | 'video' | 'audio' | 'text';
export type LocalModelRpcMethod = 'status' | 'deploy' | 'transcribe';

export interface LocalModelStatus {
  available: boolean;
  message?: string;
}

export interface LocalModelDeployInput {
  model: string;
  kind?: LocalModelKind;
  cacheDir?: string;
}

export interface LocalAsrTranscribeInput {
  model: string;
  audioPath: string;
  language?: string | null;
}

export interface LocalAsrTranscription {
  text: string;
}

export interface LocalAsrRuntime {
  status(input: { model: string }): Promise<LocalModelStatus>;
  deploy(input: LocalModelDeployInput): Promise<void>;
  transcribe(input: LocalAsrTranscribeInput): Promise<LocalAsrTranscription>;
}

export interface LocalModelRpcRequest {
  method: LocalModelRpcMethod;
  params: Record<string, unknown>;
}

export type LocalModelRpcResponse =
  | { ok: true; result?: unknown }
  | { ok: false; error: string };

export type LocalModelRpcInvoker = (request: LocalModelRpcRequest) => Promise<unknown>;

export interface PythonLocalAsrRuntimeOptions {
  pythonBinary?: string;
  adapter?: 'funasr' | string;
  pythonPath?: string | string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
  timeoutMs?: number;
  invokeRpc?: LocalModelRpcInvoker;
}

export class PythonLocalAsrRuntime implements LocalAsrRuntime {
  private readonly pythonBinary: string;
  private readonly adapter: string;
  private readonly pythonPath: string[];
  private readonly env: Record<string, string | undefined>;
  private readonly cwd?: string;
  private readonly timeoutMs: number;
  private readonly invokeRpc?: LocalModelRpcInvoker;

  constructor(options: PythonLocalAsrRuntimeOptions = {}) {
    this.pythonBinary = options.pythonBinary ?? 'python3';
    this.adapter = options.adapter ?? 'funasr';
    this.pythonPath = Array.isArray(options.pythonPath)
      ? options.pythonPath.filter(Boolean)
      : options.pythonPath
        ? [options.pythonPath]
        : [];
    this.env = options.env ?? {};
    this.cwd = options.cwd;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.invokeRpc = options.invokeRpc;
  }

  async status(input: { model: string }): Promise<LocalModelStatus> {
    const result = await this.request({ method: 'status', params: { model: input.model } });
    return asStatus(result);
  }

  async deploy(input: LocalModelDeployInput): Promise<void> {
    await this.request({
      method: 'deploy',
      params: {
        model: input.model,
        kind: input.kind ?? 'asr',
        ...(input.cacheDir ? { cache_dir: input.cacheDir } : {}),
      },
    });
  }

  async transcribe(input: LocalAsrTranscribeInput): Promise<LocalAsrTranscription> {
    const result = await this.request({
      method: 'transcribe',
      params: {
        model: input.model,
        audio_path: input.audioPath,
        language: input.language ?? null,
      },
    });
    return asTranscription(result);
  }

  private async request(request: LocalModelRpcRequest): Promise<unknown> {
    const response = this.invokeRpc
      ? await this.invokeRpc(request)
      : await this.spawnPythonRpc(request);
    return unwrapRpcResponse(response);
  }

  private spawnPythonRpc(request: LocalModelRpcRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        ...this.env,
      };
      if (this.pythonPath.length > 0) {
        env.PYTHONPATH = [this.pythonPath.join(delimiter), env.PYTHONPATH].filter(Boolean).join(delimiter);
      }
      const child = spawn(
        this.pythonBinary,
        ['-m', 'clash_sdk.local_models.rpc', this.adapter],
        {
          cwd: this.cwd,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Local model RPC timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        const parsed = parseRpcJson(stdout);
        if (!parsed) {
          reject(new Error(stderr.trim() || `Local model RPC exited with code ${code ?? 'unknown'}`));
          return;
        }
        try {
          resolve(unwrapRpcResponse(parsed));
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.end(JSON.stringify(request));
    });
  }
}

export function createPythonLocalAsrRuntime(options: PythonLocalAsrRuntimeOptions = {}): LocalAsrRuntime {
  return new PythonLocalAsrRuntime(options);
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
  if (!value || typeof value !== 'object' || typeof (value as { text?: unknown }).text !== 'string') {
    throw new Error('Local ASR runtime returned no transcript');
  }
  return { text: (value as { text: string }).text };
}

function parseRpcJson(stdout: string): unknown | null {
  const lines = stdout.split(/\r?\n/g).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Python runtimes may print progress logs. The last JSON line is the RPC response.
    }
  }
  return null;
}
