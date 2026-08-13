import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import type { AssetKind } from "@clash/shared-types";
import {
  createProjectAssetHostClient,
  type ProjectAssetHostClient,
  type ProjectAssetHostScope,
} from "@clash/shared-runtime/project-asset-client";

import type { AssetMcpToolName, AssetToolInput } from "./asset-contract.js";

export type AssetProjectHostGateway = {
  invoke(name: AssetMcpToolName, input: AssetToolInput): Promise<unknown>;
};

type FileType = { kind: AssetKind; contentType: string };

const FILE_TYPES: Record<string, FileType> = {
  ".png": { kind: "image", contentType: "image/png" },
  ".jpg": { kind: "image", contentType: "image/jpeg" },
  ".jpeg": { kind: "image", contentType: "image/jpeg" },
  ".gif": { kind: "image", contentType: "image/gif" },
  ".webp": { kind: "image", contentType: "image/webp" },
  ".svg": { kind: "image", contentType: "image/svg+xml" },
  ".avif": { kind: "image", contentType: "image/avif" },
  ".mp4": { kind: "video", contentType: "video/mp4" },
  ".webm": { kind: "video", contentType: "video/webm" },
  ".mov": { kind: "video", contentType: "video/quicktime" },
  ".m4v": { kind: "video", contentType: "video/x-m4v" },
  ".mkv": { kind: "video", contentType: "video/x-matroska" },
  ".mp3": { kind: "audio", contentType: "audio/mpeg" },
  ".wav": { kind: "audio", contentType: "audio/wav" },
  ".m4a": { kind: "audio", contentType: "audio/mp4" },
  ".aac": { kind: "audio", contentType: "audio/aac" },
  ".flac": { kind: "audio", contentType: "audio/flac" },
  ".ogg": { kind: "audio", contentType: "audio/ogg" },
  ".glb": { kind: "model", contentType: "model/gltf-binary" },
  ".gltf": { kind: "model", contentType: "model/gltf+json" },
  ".fbx": { kind: "model", contentType: "application/octet-stream" },
  ".bvh": { kind: "model", contentType: "application/octet-stream" },
  ".obj": { kind: "model", contentType: "text/plain" },
  ".usdz": { kind: "model", contentType: "model/vnd.usdz+zip" },
};

function requiredString(
  input: AssetToolInput,
  key: "assetId" | "filePath",
): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

/** Direct Project Asset transport with MCP-session read receipts and no CLI process. */
export function createAssetProjectHostGateway(
  client: ProjectAssetHostClient = createProjectAssetHostClient(),
): AssetProjectHostGateway {
  const observations = new Map<string, string>();
  const scope = async (input: AssetToolInput) => {
    const context = await client.resolveContext({
      cwd: input.cwd,
      projectId: input.projectId,
    });
    const requestScope: ProjectAssetHostScope = {
      projectId: context.projectId,
      ...(input.cwd ? { cwd: input.cwd } : {}),
    };
    return {
      context,
      requestScope,
      observationKey: (assetId: string) => `${context.projectId}\0${assetId}`,
    };
  };
  const requireReceipt = async (input: AssetToolInput, assetId: string) => {
    const resolved = await scope(input);
    const receipt = observations.get(resolved.observationKey(assetId));
    if (!receipt) {
      throw new Error(
        `READ_REQUIRED: Read Project Asset ${assetId} with clash_assets_get or clash_assets_references before mutating it.`,
      );
    }
    return { ...resolved, receipt };
  };

  return {
    async invoke(name, input) {
      const resolved = await scope(input);
      switch (name) {
        case "clash_assets_list":
          return (await client.list(resolved.requestScope)).value;
        case "clash_assets_get": {
          const assetId = requiredString(input, "assetId");
          const observed = await client.get({
            ...resolved.requestScope,
            assetId,
          });
          observations.set(resolved.observationKey(assetId), observed.receipt);
          return observed.value;
        }
        case "clash_assets_references": {
          const assetId = requiredString(input, "assetId");
          const observed = await client.references({
            ...resolved.requestScope,
            assetId,
          });
          observations.set(resolved.observationKey(assetId), observed.receipt);
          return { projectAssetId: assetId, references: observed.value };
        }
        case "clash_assets_import_file": {
          const requestedPath = requiredString(input, "filePath");
          const workspaceRoot =
            input.cwd?.trim() ||
            resolved.context.workspaceRoot ||
            process.cwd();
          const filePath = resolve(workspaceRoot, requestedPath);
          const info = await stat(filePath);
          if (!info.isFile()) {
            throw new Error(
              `Project Asset import source is not a file: ${filePath}`,
            );
          }
          const inferred = FILE_TYPES[extname(filePath).toLowerCase()];
          if (!inferred) {
            throw new Error(
              `Project Asset file type is unsupported: ${filePath}`,
            );
          }
          if (input.kind && input.kind !== inferred.kind) {
            throw new Error(
              `Project Asset kind ${input.kind} does not match the selected ${inferred.kind} file`,
            );
          }
          return (
            await client.importFile({
              ...resolved.requestScope,
              bytes: new Uint8Array(await readFile(filePath)),
              fileName: basename(filePath),
              contentType: inferred.contentType,
              kind: input.kind ?? inferred.kind,
            })
          ).value;
        }
        case "clash_assets_trash": {
          const assetId = requiredString(input, "assetId");
          const guarded = await requireReceipt(input, assetId);
          const observed = await client.trash({
            ...guarded.requestScope,
            assetId,
            actorClientType: "mcp",
            receipt: guarded.receipt,
          });
          observations.set(guarded.observationKey(assetId), observed.receipt);
          return observed.value;
        }
        case "clash_assets_restore": {
          const assetId = requiredString(input, "assetId");
          const guarded = await requireReceipt(input, assetId);
          const observed = await client.restore({
            ...guarded.requestScope,
            assetId,
            actorClientType: "mcp",
            receipt: guarded.receipt,
          });
          observations.set(guarded.observationKey(assetId), observed.receipt);
          return observed.value;
        }
      }
    },
  };
}
