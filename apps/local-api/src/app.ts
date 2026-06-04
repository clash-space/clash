import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, relative } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { defaultRuntimeCapabilities } from "@clash/shared-runtime";
import type { Asset, AssetKind, AssetRefRow } from "@clash/shared-types/assets";
import {
  createMockFalQueueService,
  handleFalMockHttpRequest,
  type FalMockQueueService,
} from "./fal-mock.js";

export interface LocalApiOptions {
  dataDir: string;
  userId?: string;
  localAcp?: LocalAcpAdapter;
  falMock?: FalMockQueueService;
}

export type LocalAcpRuntimeStatus = "online" | "offline";

export interface LocalAcpRuntimeAgent {
  id: string;
  binary?: string;
  version?: string;
}

export interface LocalAcpRuntime {
  id: string;
  machine_id: string;
  hostname: string;
  os: string;
  agents: LocalAcpRuntimeAgent[];
  version: string;
  status: LocalAcpRuntimeStatus;
  last_heartbeat: number | null;
  created_at: number;
}

export interface LocalAcpResumeSession {
  id: string;
  title: string;
  cwd: string;
  modifiedAt: number;
}

export interface LocalAcpCreateSessionParams {
  runtimeId: string;
  crewId: string;
  crewMemberId?: string;
  projectId?: string;
  resumeAcpSessionId?: string;
}

export interface LocalAcpAdapter {
  listRuntimes(): Promise<{ runtimes: LocalAcpRuntime[] }>;
  createSession(params: LocalAcpCreateSessionParams): Promise<{ session_id: string }>;
  listResumeSessions(runtimeId: string): Promise<{ sessions: LocalAcpResumeSession[] }>;
}

interface LocalProjectAsset {
  id: string;
  url: string;
  type: "image" | "video";
  storageKey: string;
  createdAt: string | null;
}

interface LocalProject {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  assets: LocalProjectAsset[];
}

interface LocalSession {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface LocalDb {
  projects: LocalProject[];
  assets: Array<Asset & { projectId?: string }>;
  assetRefs: AssetRefRow[];
  sessions: LocalSession[];
}

const DEFAULT_DB: LocalDb = {
  projects: [],
  assets: [],
  assetRefs: [],
  sessions: [],
};

function truncateProjectName(prompt: string): string {
  return prompt.length > 20 ? `${prompt.slice(0, 20)}...` : prompt;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function contentTypeForPath(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".txt") return "text/plain";
  return "application/octet-stream";
}

function nowIso(): string {
  return new Date().toISOString();
}

function epochSecondsToIso(value: number | null | undefined): string | null {
  if (!value) return null;
  return new Date(value * 1000).toISOString();
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return structuredClone(fallback);
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}

function createDb(dataDir: string) {
  const dbPath = join(dataDir, "db.json");

  async function load(): Promise<LocalDb> {
    const db = await readJson<LocalDb>(dbPath, DEFAULT_DB);
    return {
      projects: db.projects ?? [],
      assets: db.assets ?? [],
      assetRefs: db.assetRefs ?? [],
      sessions: db.sessions ?? [],
    };
  }

  async function save(db: LocalDb): Promise<void> {
    await writeJson(dbPath, db);
  }

  return { load, save };
}

function assetRoot(dataDir: string): string {
  return join(dataDir, "assets");
}

function assetPath(dataDir: string, storageKey: string): string {
  const root = assetRoot(dataDir);
  const resolved = normalize(join(root, storageKey));
  const rel = relative(root, resolved);
  if (rel.startsWith("..") || rel === "..") {
    throw new Error("Invalid asset path");
  }
  return resolved;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function toProjectAsset(
  asset: Asset,
  importedAt?: number,
): LocalProjectAsset | null {
  if (asset.kind !== "image" && asset.kind !== "video") return null;
  if (asset.kind === "video" && !asset.coverR2Key) return null;

  const previewKey = asset.kind === "video" ? asset.coverR2Key! : asset.srcR2Key;
  return {
    id: asset.id,
    url: `/assets/${previewKey}`,
    type: asset.kind,
    storageKey: asset.srcR2Key,
    createdAt: epochSecondsToIso(asset.createdAt || importedAt),
  };
}

function requestOrigin(c: { req: { url: string } }): string {
  return new URL(c.req.url).origin;
}

function localAssetUrl(c: { req: { url: string } }, storageKey: string): string {
  return `${requestOrigin(c)}/assets/${storageKey}`;
}

function signedUrlExp(): number {
  return Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
}

function withSignedAssetUrls<T extends Asset>(
  c: { req: { url: string } },
  asset: T,
): T {
  const exp = signedUrlExp();
  return {
    ...asset,
    signedUrl: localAssetUrl(c, asset.srcR2Key),
    signedUrlExp: exp,
    ...(asset.coverR2Key
      ? {
          signedCoverUrl: localAssetUrl(c, asset.coverR2Key),
          signedCoverUrlExp: exp,
        }
      : {}),
  };
}

function withProjectAssets(project: LocalProject, state: LocalDb): LocalProject {
  const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]));
  const refs = [
    ...state.assetRefs.filter((ref) => ref.projectId === project.id),
    ...state.assets
      .filter((asset) => asset.projectId === project.id)
      .map((asset) => ({
        assetId: asset.id,
        projectId: project.id,
        importedAt: asset.createdAt,
      })),
  ]
    .sort((a, b) => b.importedAt - a.importedAt)
    .slice(0, 12);

  const seenAssetIds = new Set<string>();
  const seenPreviewKeys = new Set<string>();
  const previewAssets: LocalProjectAsset[] = [];

  for (const ref of refs) {
    if (previewAssets.length >= 4 || seenAssetIds.has(ref.assetId)) continue;
    const asset = assetsById.get(ref.assetId);
    if (!asset) continue;
    const preview = toProjectAsset(asset, ref.importedAt);
    if (!preview || seenPreviewKeys.has(preview.url)) continue;
    seenAssetIds.add(ref.assetId);
    seenPreviewKeys.add(preview.url);
    previewAssets.push(preview);
  }

  return { ...project, assets: previewAssets };
}

export function createLocalApiApp(options: LocalApiOptions): Hono {
  const userId = options.userId ?? "local-user";
  const db = createDb(options.dataDir);
  const falMock = options.falMock ?? createMockFalQueueService();
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: (origin) => origin || "http://127.0.0.1",
      credentials: true,
      allowHeaders: ["content-type", "authorization"],
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    }),
  );

  app.get("/health", (c) =>
    c.json({
      ok: true,
      mode: "local",
      runtime: {
        mode: "local",
        capabilities: defaultRuntimeCapabilities("local"),
      },
    }),
  );

  app.get("/api/better-auth/get-session", (c) =>
    c.json({
      user: { id: userId, name: "Local User", email: "local@clash.local" },
    }),
  );
  app.get("/api/v1/me", (c) => c.json({ id: userId }));

  app.get("/api/settings/actions", (c) => c.json([]));
  app.get("/api/settings/skills", (c) => c.json([]));
  app.get("/api/settings/tokens", (c) => c.json([]));
  app.get("/api/settings/variables", (c) => c.json([]));
  app.get("/api/marketplace/registry", (c) => c.json({ version: 1, actions: [], skills: [] }));
  app.get("/api/v1/crew", (c) => c.json({ crew: [] }));
  app.all("/fal/*", (c) => handleFalMockHttpRequest(falMock, c.req.raw));
  app.get("/api/v1/runtimes", async (c) => {
    if (!options.localAcp) return c.json({ runtimes: [] });
    return c.json(await options.localAcp.listRuntimes());
  });

  app.post("/api/v1/runtimes/:runtimeId/sessions", async (c) => {
    if (!options.localAcp) return c.json({ error: "Local ACP runtime unavailable" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      crew_id?: string;
      crew_member_id?: string;
      project_id?: string;
      resume_session_id?: string;
    };
    const crewId = body.crew_id?.trim() || body.crew_member_id?.trim();
    if (!crewId) return c.json({ error: "Missing crew_id" }, 400);

    return c.json(await options.localAcp.createSession({
      runtimeId: c.req.param("runtimeId"),
      crewId,
      crewMemberId: body.crew_member_id?.trim() || undefined,
      projectId: body.project_id,
      resumeAcpSessionId: body.resume_session_id,
    }));
  });

  app.get("/api/v1/runtimes/:runtimeId/local-sessions/scan", async (c) => {
    if (!options.localAcp) return c.json({ sessions: [] });
    return c.json(await options.localAcp.listResumeSessions(c.req.param("runtimeId")));
  });

  app.get("/api/projects", async (c) => {
    const state = await db.load();
    return c.json(state.projects.map((project) => withProjectAssets(project, state)));
  });

  app.post("/api/projects", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      prompt?: string;
      name?: string;
      description?: string;
    };
    const prompt = (body.prompt ?? body.name ?? "Untitled project").trim();
    if (!prompt) return c.json({ error: "Missing prompt" }, 400);

    const state = await db.load();
    const createdAt = nowIso();
    const project: LocalProject = {
      id: crypto.randomUUID(),
      ownerId: userId,
      name: truncateProjectName(prompt),
      description: body.description ?? prompt,
      createdAt,
      updatedAt: createdAt,
      assets: [],
    };
    state.projects.unshift(project);
    await db.save(state);
    return c.json({ id: project.id });
  });

  app.get("/api/projects/:id", async (c) => {
    const state = await db.load();
    const project = state.projects.find((p) => p.id === c.req.param("id"));
    return project ? c.json(withProjectAssets(project, state)) : c.json({ error: "Not found" }, 404);
  });

  app.patch("/api/projects/:id", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    if (!body.name?.trim()) return c.json({ error: "Missing name" }, 400);
    const state = await db.load();
    const project = state.projects.find((p) => p.id === c.req.param("id"));
    if (!project) return c.json({ error: "Not found" }, 404);
    project.name = body.name.trim();
    project.updatedAt = nowIso();
    await db.save(state);
    return c.json({ ok: true });
  });

  app.delete("/api/projects/:id", async (c) => {
    const state = await db.load();
    const before = state.projects.length;
    state.projects = state.projects.filter((p) => p.id !== c.req.param("id"));
    if (state.projects.length === before) return c.json({ error: "Not found" }, 404);
    state.assetRefs = state.assetRefs.filter((ref) => ref.projectId !== c.req.param("id"));
    await db.save(state);
    return new Response(null, { status: 204 });
  });

  app.get("/api/v1/sessions", async (c) => {
    const state = await db.load();
    const projectId = c.req.query("projectId");
    return c.json({
      sessions: projectId
        ? state.sessions.filter((s) => s.projectId === projectId)
        : state.sessions,
    });
  });

  app.post("/api/v1/sessions", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { projectId?: string; title?: string };
    if (!body.projectId) return c.json({ error: "Missing projectId" }, 400);
    const state = await db.load();
    const at = nowIso();
    const session: LocalSession = {
      id: crypto.randomUUID(),
      projectId: body.projectId,
      title: body.title?.trim() || "Session",
      createdAt: at,
      updatedAt: at,
    };
    state.sessions.unshift(session);
    await db.save(state);
    return c.json({ threadId: session.id, title: session.title });
  });

  app.get("/assets/sign", (c) => {
    const key = c.req.query("key");
    if (!key) return c.json({ error: "Missing key" }, 400);
    return c.json({
      url: localAssetUrl(c, key),
      exp: signedUrlExp(),
    });
  });

  app.post("/assets/sign-batch", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { keys?: unknown };
    const keys = Array.isArray(body.keys)
      ? body.keys.filter((key): key is string => typeof key === "string" && key.length > 0)
      : [];
    const exp = signedUrlExp();
    return c.json({ urls: keys.map((key) => ({ key, url: localAssetUrl(c, key), exp })) });
  });

  app.post("/api/custom-action/upload", async (c) => {
    const form = await c.req.formData();
    const projectId = String(form.get("projectId") ?? "");
    const taskId = String(form.get("taskId") ?? "");
    const nodeId = String(form.get("nodeId") ?? "");
    const outputType = String(form.get("outputType") ?? "image");
    const outputIndexRaw = form.get("outputIndex");
    const outputIndex = outputIndexRaw == null ? 0 : Number.parseInt(String(outputIndexRaw), 10) || 0;
    if (!projectId || !taskId || !nodeId) {
      return c.json({ error: "Missing required fields: projectId, taskId, nodeId" }, 400);
    }

    if (outputType === "text") {
      return c.json({ success: true, storageKey: null, content: String(form.get("content") ?? "") });
    }

    const file = form.get("file");
    if (!file || typeof file === "string") {
      return c.json({ error: "Missing file for image/video/audio output" }, 400);
    }

    const kind = outputType === "video" ? "video" : outputType === "audio" ? "audio" : "image";
    const ext = kind === "video" ? ".mp4" : kind === "audio" ? ".mp3" : ".png";
    const indexSuffix = outputIndex > 0 ? `-${outputIndex}` : "";
    const storageKey = `projects/${sanitizeFileName(projectId)}/custom/${sanitizeFileName(taskId)}${indexSuffix}${ext}`;
    const path = assetPath(options.dataDir, storageKey);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, bytes);

    const state = await db.load();
    const at = Math.floor(Date.now() / 1000);
    const exp = signedUrlExp();
    const assetId = outputIndex > 0 ? `${taskId}${indexSuffix}` : taskId;
    const asset: Asset = {
      id: assetId,
      userId: String(form.get("actorUserId") ?? "") || userId,
      kind,
      srcR2Key: storageKey,
      coverR2Key: null,
      metadata: { bytes: bytes.byteLength, contentType: file.type || contentTypeForPath(storageKey) },
      sourceModel: "custom-action",
      sourcePrompt: null,
      sourceTaskId: taskId,
      sources: null,
      signedUrl: localAssetUrl(c, storageKey),
      signedUrlExp: exp,
      createdAt: at,
      updatedAt: at,
    };
    state.assets = [
      { ...asset, projectId },
      ...state.assets.filter((item) => item.id !== asset.id),
    ];
    state.assetRefs = [
      { assetId: asset.id, projectId, importedAt: at },
      ...state.assetRefs.filter((ref) => !(ref.assetId === asset.id && ref.projectId === projectId)),
    ];
    await db.save(state);
    return c.json({ success: true, storageKey, assetId });
  });

  app.post("/upload", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return c.json({ error: "Missing file" }, 400);

    const storageKey = `uploads/${crypto.randomUUID().slice(0, 8)}-${sanitizeFileName(file.name)}`;
    const path = assetPath(options.dataDir, storageKey);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, new Uint8Array(await file.arrayBuffer()));
    return c.json({ storageKey });
  });

  app.get("/assets/*", async (c) => {
    const storageKey = c.req.path.slice("/assets/".length);
    if (!storageKey || storageKey === "sign" || storageKey === "sign-batch") {
      return c.text("Not found", 404);
    }
    try {
      const bytes = await readFile(assetPath(options.dataDir, storageKey));
      return new Response(bytes, {
        headers: {
          "content-type": contentTypeForPath(storageKey),
          "content-length": String(bytes.byteLength),
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      return c.text("Asset not found", 404);
    }
  });

  app.post("/api/v1/assets", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      projectId?: string;
      kind?: AssetKind;
      srcR2Key?: string;
      coverR2Key?: string | null;
    };
    if (!body.projectId || !body.kind || !body.srcR2Key) {
      return c.json({ error: "Missing projectId, kind, or srcR2Key" }, 400);
    }
    const state = await db.load();
    const at = Math.floor(Date.now() / 1000);
    const exp = signedUrlExp();
    const asset: Asset = {
      id: crypto.randomUUID(),
      userId,
      kind: body.kind,
      srcR2Key: body.srcR2Key,
      coverR2Key: body.coverR2Key ?? null,
      metadata: null,
      sourceModel: null,
      sourcePrompt: null,
      sourceTaskId: null,
      sources: null,
      signedUrl: localAssetUrl(c, body.srcR2Key),
      signedUrlExp: exp,
      createdAt: at,
      updatedAt: at,
    };
    state.assets.unshift(asset);
    state.assetRefs.unshift({
      assetId: asset.id,
      projectId: body.projectId,
      importedAt: at,
    });
    await db.save(state);
    return c.json({
      id: asset.id,
      srcR2Key: asset.srcR2Key,
      coverR2Key: asset.coverR2Key,
      signedUrl: asset.signedUrl,
      signedUrlExp: asset.signedUrlExp,
    });
  });

  app.get("/api/v1/assets/:id", async (c) => {
    const state = await db.load();
    const asset = state.assets.find((a) => a.id === c.req.param("id"));
    return asset ? c.json(withSignedAssetUrls(c, asset)) : c.json({ error: "not found" }, 404);
  });

  app.post("/api/v1/assets/batch", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? new Set(body.ids.filter((id): id is string => typeof id === "string"))
      : new Set<string>();
    const state = await db.load();
    return c.json({
      assets: state.assets
        .filter((asset) => ids.has(asset.id))
        .map((asset) => withSignedAssetUrls(c, asset)),
    });
  });

  app.delete("/api/v1/assets/:id/ref", async (c) => {
    const state = await db.load();
    const assetId = c.req.param("id");
    const projectId = c.req.query("projectId");
    state.assetRefs = state.assetRefs.filter((ref) => {
      if (ref.assetId !== assetId) return true;
      return projectId ? ref.projectId !== projectId : false;
    });
    await db.save(state);
    return c.json({ deleted: true });
  });

  app.patch("/api/v1/assets/:id/cover", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { coverR2Key?: string };
    if (!body.coverR2Key) return c.json({ error: "Missing coverR2Key" }, 400);
    const state = await db.load();
    const asset = state.assets.find((a) => a.id === c.req.param("id"));
    if (!asset) return c.json({ error: "not found" }, 404);
    asset.coverR2Key = body.coverR2Key;
    asset.updatedAt = Math.floor(Date.now() / 1000);
    await db.save(state);
    return c.json({ ok: true });
  });

  app.get("/api/v1/projects/:pid/room/messages", (c) => c.json({ messages: [] }));
  app.post("/api/v1/projects/:pid/room/messages", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { text?: string; mentions?: unknown[] };
    return c.json({
      id: crypto.randomUUID(),
      type: "room.message",
      project_id: c.req.param("pid"),
      sender_kind: "user",
      sender_id: userId,
      sender_user_id: userId,
      mentions: body.mentions ?? [],
      text: body.text ?? "",
      at: Math.floor(Date.now() / 1000),
    });
  });

  return app;
}
