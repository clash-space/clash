import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { AssetKind } from "@clash/shared-types";
import {
  createPersonalGlobalAssetHostClient,
  createProjectAssetHostClient,
  resolveAssetImportFileType,
  type PersonalGlobalAssetHostClient,
  type ProjectAssetHostClient,
  type ProjectAssetHostScope,
} from "@clash/shared-runtime/project-asset-client";

import type { AssetMcpToolName, AssetToolInput } from "./asset-contract.js";

export type AssetProjectHostGateway = {
  invoke(name: AssetMcpToolName, input: AssetToolInput): Promise<unknown>;
};

function requiredString(
  input: AssetToolInput,
  key: "assetId" | "projectAssetId" | "globalAssetId" | "filePath",
): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

async function readAssetImportFile(
  input: AssetToolInput,
  workspaceRoot: string,
): Promise<{
  bytes: Uint8Array;
  fileName: string;
  contentType: string;
  kind: AssetKind;
}> {
  const requestedPath = requiredString(input, "filePath");
  const filePath = resolve(workspaceRoot, requestedPath);
  const info = await stat(filePath);
  if (!info.isFile()) {
    throw new Error(`Asset import source is not a file: ${filePath}`);
  }
  const fileType = resolveAssetImportFileType(filePath, input.kind);
  return {
    bytes: new Uint8Array(await readFile(filePath)),
    fileName: basename(filePath),
    contentType: fileType.contentType,
    kind: fileType.kind,
  };
}

/** Direct Project Asset transport with MCP-session read receipts and no CLI process. */
export function createAssetProjectHostGateway(
  client: ProjectAssetHostClient = createProjectAssetHostClient(),
  globalClient: PersonalGlobalAssetHostClient = createPersonalGlobalAssetHostClient(),
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
      switch (name) {
        case "clash_assets_list": {
          const resolved = await scope(input);
          return (await client.list(resolved.requestScope)).value;
        }
        case "clash_assets_get": {
          const resolved = await scope(input);
          const assetId = requiredString(input, "assetId");
          const observed = await client.get({
            ...resolved.requestScope,
            assetId,
          });
          observations.set(resolved.observationKey(assetId), observed.receipt);
          return observed.value;
        }
        case "clash_assets_references": {
          const resolved = await scope(input);
          const assetId = requiredString(input, "assetId");
          const observed = await client.references({
            ...resolved.requestScope,
            assetId,
          });
          observations.set(resolved.observationKey(assetId), observed.receipt);
          return { projectAssetId: assetId, references: observed.value };
        }
        case "clash_assets_import_file": {
          const resolved = await scope(input);
          const workspaceRoot =
            input.cwd?.trim() ||
            resolved.context.workspaceRoot ||
            process.cwd();
          const file = await readAssetImportFile(input, workspaceRoot);
          return (
            await client.importFile({
              ...resolved.requestScope,
              ...file,
            })
          ).value;
        }
        case "clash_assets_admit": {
          const resolved = await scope(input);
          return (
            await client.admit({
              ...resolved.requestScope,
              globalAssetId: requiredString(input, "globalAssetId"),
            })
          ).value;
        }
        case "clash_assets_publish": {
          const resolved = await scope(input);
          return globalClient.publish({
            projectId: resolved.context.projectId,
            projectAssetId: requiredString(input, "projectAssetId"),
          });
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
        case "clash_assets_global_list":
          return globalClient.list();
        case "clash_assets_global_get":
          return globalClient.get({
            globalAssetId: requiredString(input, "globalAssetId"),
          });
        case "clash_assets_global_import_file": {
          const workspaceRoot = input.cwd?.trim() || process.cwd();
          return globalClient.importFile(
            await readAssetImportFile(input, workspaceRoot),
          );
        }
      }
    },
  };
}
