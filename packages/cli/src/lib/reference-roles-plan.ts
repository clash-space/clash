import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AssetMetadataFillAction, SemanticReferenceRole } from "@clash/shared-types";
import { resolveAgentFilePathInsideCwd } from "./projection-cas";

export type PlanReferenceRolesOptions = {
  cwd: string;
  targetAssetId: string;
  rolesPath: string;
  outPath?: string;
  producer?: string;
};

export type PlanReferenceRolesResult = {
  planned: true;
  targetAssetId: string;
  actionPath: string;
  roles: number;
};

export async function planReferenceRolesAction(
  options: PlanReferenceRolesOptions,
): Promise<PlanReferenceRolesResult> {
  const cwd = resolve(options.cwd);
  const targetAssetId = requireNonEmpty(options.targetAssetId, "target asset id");
  const rolesPath = resolveProjectPath(cwd, options.rolesPath, "reference roles");
  const roles = parseReferenceRoles(JSON.parse(await readFile(rolesPath, "utf8")));
  const action: AssetMetadataFillAction = {
    actionId: `semantic-reference-roles-${safeSlug(targetAssetId)}`,
    targetAssetId,
    metadataKind: "image.semantic-reference-roles",
    producer: options.producer ?? "clash-production-plan-reference-roles",
    createdAt: new Date().toISOString(),
    metadata: {
      kind: "image.semantic-reference-roles",
      roles,
    },
  };
  const actionPath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.outPath ?? join("actions", `${safeSlug(targetAssetId)}.semantic-reference-roles.json`),
      "reference roles action",
    ),
    writeVerb: "Reference roles action",
  });
  await writeJson(actionPath, action);
  return {
    planned: true,
    targetAssetId,
    actionPath,
    roles: roles.length,
  };
}

function parseReferenceRoles(input: unknown): SemanticReferenceRole[] {
  const rawRoles: unknown[] | undefined = Array.isArray(input)
    ? input
    : input && typeof input === "object" && Array.isArray((input as Record<string, unknown>).roles)
      ? (input as Record<string, unknown>).roles as unknown[]
      : undefined;
  if (!rawRoles || rawRoles.length === 0) {
    throw new Error("reference roles JSON must be a non-empty array or an object with roles");
  }
  const roleIds = new Set<string>();
  return rawRoles.map((item) => {
    if (!item || typeof item !== "object") throw new Error("reference role must be an object");
    const record = item as Record<string, unknown>;
    const roleId = requireNonEmpty(record.roleId, "roleId");
    if (roleIds.has(roleId)) throw new Error(`duplicate reference roleId ${roleId}`);
    roleIds.add(roleId);
    const role = parseRoleKind(record.role);
    const locked = record.locked === undefined ? true : record.locked === true;
    const copyOnWriteRequired = record.copyOnWriteRequired === undefined
      ? true
      : record.copyOnWriteRequired === true;
    return {
      roleId,
      assetId: requireNonEmpty(record.assetId, "assetId"),
      role,
      ...(typeof record.subjectId === "string" && record.subjectId.trim()
        ? { subjectId: record.subjectId.trim() }
        : {}),
      path: normalizeProjectRelativePath(requireNonEmpty(record.path, "path"), `reference role ${roleId} path`),
      locked,
      copyOnWriteRequired,
      downstreamUsage: parseDownstreamUsage(record.downstreamUsage, role),
      constraints: parseConstraints(record.constraints),
    };
  });
}

function parseRoleKind(input: unknown): SemanticReferenceRole["role"] {
  if (
    input === "identity-front" ||
    input === "identity-side" ||
    input === "identity-back" ||
    input === "identity-three-quarter" ||
    input === "identity-expression" ||
    input === "scene-plate" ||
    input === "style-frame" ||
    input === "logo-lock" ||
    input === "product-packshot"
  ) {
    return input;
  }
  throw new Error("reference role must be identity-front, identity-side, identity-back, identity-three-quarter, identity-expression, scene-plate, style-frame, logo-lock, or product-packshot");
}

function parseDownstreamUsage(
  input: unknown,
  role: SemanticReferenceRole["role"],
): SemanticReferenceRole["downstreamUsage"] {
  if (
    input === "identity-reference" ||
    input === "scene-reference" ||
    input === "style-reference" ||
    input === "brand-lock" ||
    input === "product-reference"
  ) {
    return input;
  }
  if (role.startsWith("identity-")) return "identity-reference";
  if (role === "scene-plate") return "scene-reference";
  if (role === "style-frame") return "style-reference";
  if (role === "logo-lock") return "brand-lock";
  return "product-reference";
}

function parseConstraints(input: unknown): string[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error("constraints must be an array");
  return input.map((item) => requireNonEmpty(item, "constraint"));
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
  return slug || "reference-roles";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
