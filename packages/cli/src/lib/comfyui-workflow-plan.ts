import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  AssetMetadataFillActionSchema,
  ImageComfyuiApiFormatSchema,
  ImageComfyuiInputKindSchema,
  ImageComfyuiModelTypeSchema,
  ImageComfyuiOutputMediaTypeSchema,
  ImageComfyuiRunnerMetadataSchema,
  type AssetMetadataFillAction,
  type ImageComfyuiCustomNode,
  type ImageComfyuiInputKind,
  type ImageComfyuiInputSlot,
  type ImageComfyuiModelReference,
  type ImageComfyuiModelType,
  type ImageComfyuiOutput,
  type ImageComfyuiRunnerMetadata,
} from "@clash/shared-types";

export type ImageComfyuiRunnerReport = {
  schemaVersion: 1;
  kind: "clash.image.comfyui-runner";
  targetAssetId: string;
  workflowId: string;
  workflowPath: string;
  workflowHash: string;
  apiFormat: "comfyui-api-json" | "comfyui-ui-json";
  backendId?: string;
  models: ImageComfyuiModelReference[];
  customNodes: ImageComfyuiCustomNode[];
  inputs: ImageComfyuiInputSlot[];
  outputs: ImageComfyuiOutput[];
  execution: ImageComfyuiRunnerMetadata["execution"];
  decisionLog: string[];
};

export type PlanComfyuiWorkflowOptions = {
  cwd: string;
  targetAssetId: string;
  requestPath: string;
  outPath?: string;
  reportPath?: string;
  producer?: string;
};

export type PlanComfyuiWorkflowResult = {
  planned: true;
  targetAssetId: string;
  workflowId: string;
  actionPath: string;
  reportPath: string;
  outputs: number;
  materializedOutputs: number;
};

type ComfyuiWorkflowRequestOutput = {
  outputAssetId: string;
  nodeId: string;
  outputName?: string;
  mediaType: "image" | "image-sequence" | "mask" | "metadata";
  path: string;
  status?: "planned" | "materialized";
};

type ComfyuiWorkflowRequest = {
  workflowId: string;
  workflowPath: string;
  apiFormat: "comfyui-api-json" | "comfyui-ui-json";
  backendId?: string;
  models: ImageComfyuiModelReference[];
  customNodes: ImageComfyuiCustomNode[];
  inputs: ImageComfyuiInputSlot[];
  outputs: ComfyuiWorkflowRequestOutput[];
  execution: ImageComfyuiRunnerMetadata["execution"];
};

export async function planComfyuiWorkflowAction(
  options: PlanComfyuiWorkflowOptions,
): Promise<PlanComfyuiWorkflowResult> {
  const cwd = resolve(options.cwd);
  const targetAssetId = requireNonEmpty(options.targetAssetId, "target asset id");
  const requestPath = resolveProjectPath(cwd, options.requestPath, "ComfyUI workflow request");
  const request = parseRequest(JSON.parse(await readFile(requestPath, "utf8")));
  const workflowPath = resolveProjectPath(cwd, request.workflowPath, "ComfyUI workflow");
  const workflowRaw = await readFile(workflowPath);
  const outputs = await Promise.all(
    request.outputs.map((output) => materializeOutput(cwd, output)),
  );
  const decisionLog = [
    `registered ComfyUI workflow ${request.workflowId}`,
    "did not execute ComfyUI backend",
  ];
  const metadata = ImageComfyuiRunnerMetadataSchema.parse({
    kind: "image.comfyui-runner",
    workflowId: request.workflowId,
    workflowPath: request.workflowPath,
    workflowHash: `sha256:${createHash("sha256").update(workflowRaw).digest("hex")}`,
    apiFormat: request.apiFormat,
    backendId: request.backendId,
    models: request.models,
    customNodes: request.customNodes,
    inputs: request.inputs,
    outputs,
    execution: request.execution,
    decisionLog,
  });
  const action: AssetMetadataFillAction = AssetMetadataFillActionSchema.parse({
    actionId: `comfyui-runner-${safeSlug(metadata.workflowId)}`,
    targetAssetId,
    metadataKind: "image.comfyui-runner",
    producer: options.producer ?? "clash-production-plan-comfyui-workflow",
    createdAt: new Date().toISOString(),
    metadata,
  });
  const report: ImageComfyuiRunnerReport = {
    schemaVersion: 1,
    kind: "clash.image.comfyui-runner",
    targetAssetId,
    workflowId: metadata.workflowId,
    workflowPath: metadata.workflowPath,
    workflowHash: metadata.workflowHash,
    apiFormat: metadata.apiFormat,
    backendId: metadata.backendId,
    models: metadata.models,
    customNodes: metadata.customNodes,
    inputs: metadata.inputs,
    outputs: metadata.outputs,
    execution: metadata.execution,
    decisionLog,
  };
  const actionPath = resolveProjectPath(
    cwd,
    options.outPath ?? join("actions", `${safeSlug(metadata.workflowId)}.comfyui-runner.json`),
    "ComfyUI workflow action",
  );
  const reportPath = resolveProjectPath(
    cwd,
    options.reportPath ?? join("qa", "image", `${safeSlug(metadata.workflowId)}.comfyui-runner.json`),
    "ComfyUI workflow report",
  );
  await writeJson(actionPath, action);
  await writeJson(reportPath, report);
  return {
    planned: true,
    targetAssetId,
    workflowId: metadata.workflowId,
    actionPath,
    reportPath,
    outputs: metadata.outputs.length,
    materializedOutputs: metadata.outputs.filter((output) => output.status === "materialized").length,
  };
}

function parseRequest(input: unknown): ComfyuiWorkflowRequest {
  if (!input || typeof input !== "object") {
    throw new Error("ComfyUI workflow request must be an object");
  }
  const record = input as Record<string, unknown>;
  const outputs = record.outputs;
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new Error("ComfyUI workflow request must include outputs");
  }
  return {
    workflowId: requireNonEmpty(record.workflowId, "workflowId"),
    workflowPath: normalizeProjectRelativePath(
      requireNonEmpty(record.workflowPath, "workflowPath"),
      "workflowPath",
    ),
    apiFormat: ImageComfyuiApiFormatSchema.parse(record.apiFormat ?? "comfyui-api-json"),
    ...(typeof record.backendId === "string" && record.backendId.trim() ? { backendId: record.backendId.trim() } : {}),
    models: parseModels(record.models),
    customNodes: parseCustomNodes(record.customNodes),
    inputs: parseInputs(record.inputs),
    outputs: outputs.map(parseOutput),
    execution: parseExecution(record.execution),
  };
}

function parseModels(input: unknown): ImageComfyuiModelReference[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error("models must be an array");
  return input.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`model ${index + 1} must be an object`);
    const record = item as Record<string, unknown>;
    return {
      name: requireNonEmpty(record.name, `model ${index + 1} name`),
      type: ImageComfyuiModelTypeSchema.parse(record.type) as ImageComfyuiModelType,
      ...(typeof record.path === "string" && record.path.trim()
        ? { path: normalizeProjectRelativePath(record.path, `model ${index + 1} path`) }
        : {}),
      ...(typeof record.hash === "string" && record.hash.trim() ? { hash: record.hash.trim() } : {}),
      ...(typeof record.license === "string" && record.license.trim() ? { license: record.license.trim() } : {}),
    };
  });
}

function parseCustomNodes(input: unknown): ImageComfyuiCustomNode[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error("customNodes must be an array");
  return input.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`custom node ${index + 1} must be an object`);
    const record = item as Record<string, unknown>;
    return {
      name: requireNonEmpty(record.name, `custom node ${index + 1} name`),
      ...(typeof record.source === "string" && record.source.trim() ? { source: record.source.trim() } : {}),
      ...(typeof record.version === "string" && record.version.trim() ? { version: record.version.trim() } : {}),
      ...(typeof record.commit === "string" && record.commit.trim() ? { commit: record.commit.trim() } : {}),
      ...(typeof record.hash === "string" && record.hash.trim() ? { hash: record.hash.trim() } : {}),
    };
  });
}

function parseInputs(input: unknown): ImageComfyuiInputSlot[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error("inputs must be an array");
  return input.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`input ${index + 1} must be an object`);
    const record = item as Record<string, unknown>;
    const value = record.value;
    if (value !== undefined && !["string", "number", "boolean"].includes(typeof value)) {
      throw new Error(`input ${index + 1} value must be a string, number, or boolean`);
    }
    return {
      id: requireNonEmpty(record.id, `input ${index + 1} id`),
      nodeId: requireNonEmpty(record.nodeId, `input ${index + 1} nodeId`),
      inputName: requireNonEmpty(record.inputName, `input ${index + 1} inputName`),
      kind: ImageComfyuiInputKindSchema.parse(record.kind) as ImageComfyuiInputKind,
      ...(value === undefined ? {} : { value: value as string | number | boolean }),
      ...(typeof record.assetId === "string" && record.assetId.trim() ? { assetId: record.assetId.trim() } : {}),
      ...(typeof record.path === "string" && record.path.trim()
        ? { path: normalizeProjectRelativePath(record.path, `input ${index + 1} path`) }
        : {}),
    };
  });
}

function parseOutput(input: unknown, index: number): ComfyuiWorkflowRequestOutput {
  if (!input || typeof input !== "object") {
    throw new Error(`output ${index + 1} must be an object`);
  }
  const record = input as Record<string, unknown>;
  const rawStatus = record.status;
  if (rawStatus !== undefined && rawStatus !== "planned" && rawStatus !== "materialized") {
    throw new Error(`output ${index + 1} status must be planned or materialized`);
  }
  return {
    outputAssetId: requireNonEmpty(record.outputAssetId, `output ${index + 1} outputAssetId`),
    nodeId: requireNonEmpty(record.nodeId, `output ${index + 1} nodeId`),
    ...(typeof record.outputName === "string" && record.outputName.trim() ? { outputName: record.outputName.trim() } : {}),
    mediaType: ImageComfyuiOutputMediaTypeSchema.parse(record.mediaType),
    path: normalizeProjectRelativePath(
      requireNonEmpty(record.path, `output ${index + 1} path`),
      `output ${index + 1} path`,
    ),
    ...(rawStatus === undefined ? {} : { status: rawStatus }),
  };
}

function parseExecution(input: unknown): ImageComfyuiRunnerMetadata["execution"] {
  if (input === undefined) return { mode: "planned" };
  if (!input || typeof input !== "object") throw new Error("execution must be an object");
  const record = input as Record<string, unknown>;
  const mode = record.mode;
  if (mode !== "planned" && mode !== "completed" && mode !== "failed") {
    throw new Error("execution mode must be planned, completed, or failed");
  }
  return {
    mode,
    ...(typeof record.runnerId === "string" && record.runnerId.trim() ? { runnerId: record.runnerId.trim() } : {}),
    ...(typeof record.promptId === "string" && record.promptId.trim() ? { promptId: record.promptId.trim() } : {}),
    ...(typeof record.executedAt === "string" && record.executedAt.trim() ? { executedAt: record.executedAt.trim() } : {}),
  };
}

async function materializeOutput(cwd: string, output: ComfyuiWorkflowRequestOutput): Promise<ImageComfyuiOutput> {
  const outputPath = resolveProjectPath(cwd, output.path, `ComfyUI output ${output.outputAssetId}`);
  try {
    const raw = await readFile(outputPath);
    return {
      outputAssetId: output.outputAssetId,
      nodeId: output.nodeId,
      ...(output.outputName ? { outputName: output.outputName } : {}),
      mediaType: output.mediaType,
      path: output.path,
      fileHash: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
      status: output.status ?? "materialized",
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (output.status === "materialized") {
      throw new Error(`ComfyUI output ${output.path} is marked materialized but does not exist`);
    }
    return {
      outputAssetId: output.outputAssetId,
      nodeId: output.nodeId,
      ...(output.outputName ? { outputName: output.outputName } : {}),
      mediaType: output.mediaType,
      path: output.path,
      status: "planned",
    };
  }
}

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function resolveProjectPath(cwd: string, rawPath: string, label: string): string {
  if (!rawPath || typeof rawPath !== "string") {
    throw new Error(`${label} path is required`);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawPath)) {
    throw new Error(`${label} path must be a local project path, not a URL`);
  }
  const resolved = isAbsolute(rawPath) ? resolve(rawPath) : resolve(cwd, rawPath);
  if (!isInsideOrEqual(cwd, resolved)) {
    throw new Error(`${label} path must stay inside the current project cwd`);
  }
  return resolved;
}

function normalizeProjectRelativePath(path: string, label: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    throw new Error(`${label} must be a local project-relative path, not a URL`);
  }
  if (isAbsolute(path)) {
    throw new Error(`${label} must be project-relative, not absolute`);
  }
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.includes("..")) {
    throw new Error(`${label} must stay inside the project`);
  }
  return parts.join("/");
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function safeSlug(value: string): string {
  const slug = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "comfyui-runner";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
