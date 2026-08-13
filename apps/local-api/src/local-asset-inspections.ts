import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";

import {
  ProjectAssetMetadataSchema,
  type AssetKind,
  type ProjectAssetMetadata,
  type Resource,
} from "@clash/shared-types";

import {
  createLocalResourceStore,
  type LocalResourceProjection,
} from "./local-resource-store.js";
export { localFfprobePath } from "./local-media-binaries.js";

interface SqliteRunResult {
  changes: number | bigint;
}

interface SqliteStatement {
  run(...params: unknown[]): SqliteRunResult;
  get(...params: unknown[]): Record<string, unknown> | undefined;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const LOCAL_ASSET_INSPECTION_RECIPE =
  "asset-inspection/v3:canonical-media-facts";

const LocalAssetInspectionFactsSchema = ProjectAssetMetadataSchema.pick({
  width: true,
  height: true,
  durationMs: true,
  contentType: true,
  frameRate: true,
  videoCodec: true,
  hasAudio: true,
  audioCodec: true,
});

export type LocalAssetInspectionFacts = Pick<
  ProjectAssetMetadata,
  | "width"
  | "height"
  | "durationMs"
  | "contentType"
  | "frameRate"
  | "videoCodec"
  | "hasAudio"
  | "audioCodec"
>;

export interface LocalAssetInspectorInput {
  sourcePath: string;
  resource: Resource;
}

export type LocalAssetInspector = (
  input: LocalAssetInspectorInput,
) => Promise<LocalAssetInspectionFacts>;

type LocalFfprobeRunner = (
  file: string,
  args: string[],
) => Promise<{ stdout: string }>;

const execFileAsync = promisify(execFile);

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function frameRate(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(value.trim());
  if (!match) return undefined;
  const numerator = Number(match[1]);
  const denominator = match[2] ? Number(match[2]) : 1;
  const rate = numerator / denominator;
  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
}

function durationMs(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.round(seconds * 1_000);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function mediaTypeParameters(value: string | undefined): {
  essence: string;
  parameters: Map<string, string>;
} {
  const [rawEssence = "", ...rawParameters] = (value ?? "").split(";");
  const parameters = new Map<string, string>();
  for (const rawParameter of rawParameters) {
    const separator = rawParameter.indexOf("=");
    if (separator <= 0) continue;
    parameters.set(
      rawParameter.slice(0, separator).trim().toLowerCase(),
      rawParameter
        .slice(separator + 1)
        .trim()
        .toLowerCase(),
    );
  }
  return { essence: rawEssence.trim().toLowerCase(), parameters };
}

function requireRegisteredMediaType(resource: Resource): string {
  const { essence } = mediaTypeParameters(resource.contentType);
  const matches =
    (resource.kind === "image" && essence.startsWith("image/")) ||
    (resource.kind === "video" && essence.startsWith("video/")) ||
    (resource.kind === "audio" && essence.startsWith("audio/")) ||
    (resource.kind === "model" &&
      (essence === "model/gltf-binary" || essence === "model/gltf+json"));
  if (!matches) {
    throw new Error(
      `Registered ${resource.kind} Asset content type ${resource.contentType ?? "(missing)"} does not match its kind.`,
    );
  }
  return essence;
}

function decodedMediaType(input: {
  kind: Exclude<AssetKind, "model">;
  formatName?: string;
  videoCodec?: string;
  majorBrand?: string;
}): string {
  const formatNames = new Set(
    (input.formatName ?? "")
      .toLowerCase()
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (input.kind === "image") {
    const codec = input.videoCodec?.toLowerCase();
    const mediaType =
      codec === "png"
        ? "image/png"
        : codec === "mjpeg" || codec === "jpeg2000"
          ? codec === "mjpeg"
            ? "image/jpeg"
            : "image/jp2"
          : codec === "gif"
            ? "image/gif"
            : codec === "webp"
              ? "image/webp"
              : codec === "svg"
                ? "image/svg+xml"
                : codec === "av1" && formatNames.has("mov")
                  ? "image/avif"
                  : undefined;
    if (mediaType) return mediaType;
  } else if (formatNames.has("webm")) {
    return input.kind === "video" ? "video/webm" : "audio/webm";
  } else if (formatNames.has("matroska")) {
    return input.kind === "video" ? "video/x-matroska" : "audio/x-matroska";
  } else if (
    formatNames.has("mov") ||
    formatNames.has("mp4") ||
    formatNames.has("m4a") ||
    formatNames.has("3gp") ||
    formatNames.has("3g2") ||
    formatNames.has("mj2")
  ) {
    return input.kind === "video"
      ? input.majorBrand?.trim().toLowerCase() === "qt"
        ? "video/quicktime"
        : "video/mp4"
      : "audio/mp4";
  } else if (input.kind === "video" && formatNames.has("mpegts")) {
    return "video/mp2t";
  } else if (input.kind === "video" && formatNames.has("avi")) {
    return "video/x-msvideo";
  } else if (input.kind === "audio" && formatNames.has("mp3")) {
    return "audio/mpeg";
  } else if (input.kind === "audio" && formatNames.has("wav")) {
    return "audio/wav";
  } else if (input.kind === "audio" && formatNames.has("flac")) {
    return "audio/flac";
  } else if (input.kind === "audio" && formatNames.has("ogg")) {
    return "audio/ogg";
  } else if (input.kind === "audio" && formatNames.has("aac")) {
    return "audio/aac";
  }
  throw new Error(
    `Decoded ${input.kind} Asset format ${input.formatName ?? "(missing)"}/${input.videoCodec ?? "(missing)"} has no canonical media type mapping.`,
  );
}

function assertDecodedMediaType(input: {
  resource: Resource;
  registeredEssence: string;
  formatName?: string;
  videoCodec?: string;
  majorBrand?: string;
}): void {
  if (input.resource.kind === "model") return;
  const decoded = decodedMediaType({
    kind: input.resource.kind,
    ...(input.formatName ? { formatName: input.formatName } : {}),
    ...(input.videoCodec ? { videoCodec: input.videoCodec } : {}),
    ...(input.majorBrand ? { majorBrand: input.majorBrand } : {}),
  });
  if (decoded !== input.registeredEssence) {
    throw new Error(
      `Decoded ${input.resource.kind} Asset has canonical media type ${decoded}, not registered ${input.registeredEssence}.`,
    );
  }
}

function requireFact<T>(
  value: T | undefined,
  name: string,
  kind: AssetKind,
): T {
  if (value === undefined) {
    throw new Error(`Decoded ${kind} Asset is missing canonical ${name}.`);
  }
  return value;
}

function parseGltfDocument(value: unknown): void {
  const root = record(value);
  const asset = record(root?.asset);
  const version = optionalNonEmptyString(asset?.version);
  if (!version || !/^2(?:\.|$)/.test(version)) {
    throw new Error(
      "glTF Asset bytes do not declare a supported 2.x asset version.",
    );
  }
}

async function inspectGltf(
  sourcePath: string,
  resource: Resource,
  essence: string,
): Promise<LocalAssetInspectionFacts> {
  const bytes = await readFile(sourcePath);
  if (bytes.byteLength !== resource.byteLength) {
    throw new Error("glTF Asset bytes do not match immutable Resource length.");
  }
  if (essence === "model/gltf+json") {
    try {
      parseGltfDocument(JSON.parse(bytes.toString("utf8")));
    } catch (error) {
      throw new Error("glTF JSON Asset bytes are invalid.", { cause: error });
    }
  } else {
    if (bytes.byteLength < 20 || bytes.subarray(0, 4).toString() !== "glTF") {
      throw new Error("GLB Asset bytes do not contain a valid glTF header.");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint32(4, true);
    const declaredLength = view.getUint32(8, true);
    const jsonLength = view.getUint32(12, true);
    const jsonType = view.getUint32(16, true);
    if (
      version !== 2 ||
      declaredLength !== bytes.byteLength ||
      jsonType !== 0x4e4f534a ||
      jsonLength > bytes.byteLength - 20
    ) {
      throw new Error(
        "GLB Asset bytes do not contain a valid glTF 2 JSON chunk.",
      );
    }
    try {
      parseGltfDocument(
        JSON.parse(
          bytes
            .subarray(20, 20 + jsonLength)
            .toString("utf8")
            .trim(),
        ),
      );
    } catch (error) {
      throw new Error("GLB Asset JSON chunk is invalid.", { cause: error });
    }
  }
  return LocalAssetInspectionFactsSchema.parse({
    contentType: resource.contentType,
  });
}

function inspectRawL16(
  resource: Resource,
): LocalAssetInspectionFacts | undefined {
  const { essence, parameters } = mediaTypeParameters(resource.contentType);
  if (essence !== "audio/l16" && essence !== "audio/pcm") return undefined;
  const rate = Number(parameters.get("rate"));
  const channels = Number(parameters.get("channels") ?? "1");
  if (
    !Number.isSafeInteger(rate) ||
    rate <= 0 ||
    !Number.isSafeInteger(channels) ||
    channels <= 0 ||
    resource.byteLength % (2 * channels) !== 0
  ) {
    throw new Error(
      "Raw 16-bit PCM Asset metadata must provide a valid sample rate, channel count, and whole samples.",
    );
  }
  return LocalAssetInspectionFactsSchema.parse({
    durationMs: Math.round(
      (resource.byteLength / (2 * channels * rate)) * 1_000,
    ),
    ...(resource.contentType ? { contentType: resource.contentType } : {}),
    hasAudio: true,
    audioCodec: "pcm_s16le",
  });
}

/** Production adapter for the Resource inspection port. */
export function createLocalFfprobeAssetInspector(options: {
  ffprobePath: string;
  run?: LocalFfprobeRunner;
}): LocalAssetInspector {
  const run: LocalFfprobeRunner =
    options.run ??
    (async (file, args) => {
      const result = await execFileAsync(file, args, {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
      });
      return { stdout: result.stdout };
    });
  return async ({ sourcePath, resource }) => {
    const essence = requireRegisteredMediaType(resource);
    if (resource.kind === "model") {
      return inspectGltf(sourcePath, resource, essence);
    }
    const rawL16 = inspectRawL16(resource);
    if (rawL16) return rawL16;
    const { stdout } = await run(options.ffprobePath, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      sourcePath,
    ]);
    let output: unknown;
    try {
      output = JSON.parse(stdout);
    } catch (error) {
      throw new Error("ffprobe returned malformed Asset inspection JSON.", {
        cause: error,
      });
    }
    const root = record(output);
    if (!root) throw new Error("ffprobe returned no Asset inspection object.");
    const streams = Array.isArray(root.streams)
      ? root.streams
          .map(record)
          .filter((item): item is Record<string, unknown> => !!item)
      : [];
    const video = streams.find((stream) => stream.codec_type === "video");
    const audio = streams.find((stream) => stream.codec_type === "audio");
    const format = record(root.format);
    const formatName = optionalNonEmptyString(format?.format_name);
    const majorBrand = optionalNonEmptyString(
      record(format?.tags)?.major_brand,
    );
    const width = optionalPositiveInteger(video?.width);
    const height = optionalPositiveInteger(video?.height);
    const duration = durationMs(
      format?.duration ?? video?.duration ?? audio?.duration,
    );
    const rate = frameRate(video?.avg_frame_rate ?? video?.r_frame_rate);
    const videoCodec = optionalNonEmptyString(video?.codec_name);
    const audioCodec = optionalNonEmptyString(audio?.codec_name);

    if (resource.kind === "image") {
      if (!video) throw new Error("Decoded image Asset has no visual stream.");
      requireFact(width, "width", resource.kind);
      requireFact(height, "height", resource.kind);
      requireFact(videoCodec, "image codec", resource.kind);
    } else if (resource.kind === "video") {
      if (!video) throw new Error("Decoded video Asset has no video stream.");
      requireFact(width, "width", resource.kind);
      requireFact(height, "height", resource.kind);
      requireFact(duration, "duration", resource.kind);
      requireFact(rate, "frame rate", resource.kind);
      requireFact(videoCodec, "video codec", resource.kind);
      if (audio) requireFact(audioCodec, "audio codec", resource.kind);
    } else {
      if (!audio) throw new Error("Decoded audio Asset has no audio stream.");
      requireFact(duration, "duration", resource.kind);
      requireFact(audioCodec, "audio codec", resource.kind);
    }
    assertDecodedMediaType({
      resource,
      registeredEssence: essence,
      ...(formatName ? { formatName } : {}),
      ...(videoCodec ? { videoCodec } : {}),
      ...(majorBrand ? { majorBrand } : {}),
    });
    return LocalAssetInspectionFactsSchema.parse({
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      ...(duration === undefined ? {} : { durationMs: duration }),
      ...(resource.contentType ? { contentType: resource.contentType } : {}),
      ...(rate === undefined ? {} : { frameRate: rate }),
      ...(videoCodec ? { videoCodec } : {}),
      ...(resource.kind === "video" || resource.kind === "audio"
        ? { hasAudio: !!audio }
        : {}),
      ...(audioCodec ? { audioCodec } : {}),
    });
  };
}

export interface LocalAssetInspection {
  facts: LocalAssetInspectionFacts;
}

export interface LocalAssetInspectionService {
  /**
   * Inspects and enriches one Resource once. Facts are Host-private registry
   * state keyed by immutable Resource identity.
   */
  inspect(input: {
    source: LocalResourceProjection;
    knownFacts?: ProjectAssetMetadata;
  }): Promise<LocalAssetInspection>;
}

interface InspectionRow {
  sourceResourceId: string;
  recipe: string;
  facts: LocalAssetInspectionFacts;
}

const nodeRequire = createRequire(import.meta.url);

function openDatabase(path: string): SqliteDatabase {
  const { DatabaseSync } = nodeRequire("node:sqlite") as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  };
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    DROP TABLE IF EXISTS local_asset_representations;
    CREATE TABLE IF NOT EXISTS local_asset_inspections (
      source_resource_id TEXT NOT NULL,
      recipe TEXT NOT NULL,
      facts_json TEXT NOT NULL,
      inspected_at INTEGER NOT NULL,
      PRIMARY KEY (source_resource_id, recipe)
    );
  `);
  const inspectionTable = database
    .prepare(
      `
      SELECT sql
      FROM sqlite_master
      WHERE type = 'table' AND name = 'local_asset_inspections'
    `,
    )
    .get();
  if (
    typeof inspectionTable?.sql !== "string" ||
    !/\brecipe\b/i.test(inspectionTable.sql)
  ) {
    database.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE local_asset_inspections
        RENAME TO local_asset_inspections_unversioned;
      CREATE TABLE local_asset_inspections (
        source_resource_id TEXT NOT NULL,
        recipe TEXT NOT NULL,
        facts_json TEXT NOT NULL,
        inspected_at INTEGER NOT NULL,
        PRIMARY KEY (source_resource_id, recipe)
      );
      DROP TABLE local_asset_inspections_unversioned;
      COMMIT;
    `);
  }
  return database;
}

function parseInspectionRow(row: Record<string, unknown>): InspectionRow {
  const sourceResourceId = row.source_resource_id;
  const recipe = row.recipe;
  const factsJson = row.facts_json;
  if (
    typeof sourceResourceId !== "string" ||
    !sourceResourceId ||
    typeof recipe !== "string" ||
    !recipe ||
    typeof factsJson !== "string"
  ) {
    throw new Error("Local Asset inspection row is corrupt.");
  }
  let facts: unknown;
  try {
    facts = JSON.parse(factsJson);
  } catch (error) {
    throw new Error("Local Asset inspection facts are corrupt.", {
      cause: error,
    });
  }
  return {
    sourceResourceId,
    recipe,
    facts: LocalAssetInspectionFactsSchema.parse(facts),
  };
}

function sameResourceFacts(
  left: LocalResourceProjection,
  right: LocalResourceProjection,
): boolean {
  return JSON.stringify(left.resource) === JSON.stringify(right.resource);
}

function assertCompleteInspectionFacts(
  resource: Resource,
  facts: LocalAssetInspectionFacts,
): LocalAssetInspectionFacts {
  if (facts.contentType !== resource.contentType) {
    throw new Error(
      `Decoded ${resource.kind} Asset content type does not match immutable Resource facts.`,
    );
  }
  if (resource.kind === "image") {
    requireFact(facts.width, "width", resource.kind);
    requireFact(facts.height, "height", resource.kind);
  } else if (resource.kind === "video") {
    requireFact(facts.width, "width", resource.kind);
    requireFact(facts.height, "height", resource.kind);
    requireFact(facts.durationMs, "duration", resource.kind);
    requireFact(facts.frameRate, "frame rate", resource.kind);
    requireFact(facts.videoCodec, "video codec", resource.kind);
    requireFact(facts.hasAudio, "audio presence", resource.kind);
    if (facts.hasAudio)
      requireFact(facts.audioCodec, "audio codec", resource.kind);
  } else if (resource.kind === "audio") {
    requireFact(facts.durationMs, "duration", resource.kind);
    if (facts.hasAudio !== true) {
      throw new Error(
        "Decoded audio Asset is missing canonical audio presence.",
      );
    }
    requireFact(facts.audioCodec, "audio codec", resource.kind);
  }
  return facts;
}

export function createLocalAssetInspectionService(options: {
  dataDir: string;
  clashRoot?: string;
  inspectResource?: LocalAssetInspector;
}): LocalAssetInspectionService {
  const databasePath = `${options.dataDir}/local.sqlite`;
  const resources = createLocalResourceStore({
    dataDir: options.dataDir,
    ...(options.clashRoot ? { clashRoot: options.clashRoot } : {}),
  });
  const inspectionInFlight = new Map<string, Promise<InspectionRow>>();

  async function withDatabase<T>(
    task: (database: SqliteDatabase) => T,
  ): Promise<T> {
    await mkdir(options.dataDir, { recursive: true });
    const database = openDatabase(databasePath);
    try {
      return task(database);
    } finally {
      database.close();
      await chmod(databasePath, 0o600).catch(() => undefined);
    }
  }

  async function readInspection(
    sourceResourceId: string,
  ): Promise<InspectionRow | undefined> {
    return withDatabase((database) => {
      const row = database
        .prepare(
          `
          SELECT source_resource_id, recipe, facts_json
          FROM local_asset_inspections
          WHERE source_resource_id = ? AND recipe = ?
        `,
        )
        .get(sourceResourceId, LOCAL_ASSET_INSPECTION_RECIPE);
      return row ? parseInspectionRow(row) : undefined;
    });
  }

  async function persistInspection(input: {
    source: LocalResourceProjection;
    facts: LocalAssetInspectionFacts;
  }): Promise<InspectionRow> {
    const facts = assertCompleteInspectionFacts(
      input.source.resource,
      LocalAssetInspectionFactsSchema.parse(input.facts),
    );
    await withDatabase((database) => {
      database
        .prepare(
          `
          INSERT OR IGNORE INTO local_asset_inspections (
            source_resource_id, recipe, facts_json, inspected_at
          ) VALUES (?, ?, ?, ?)
        `,
        )
        .run(
          input.source.resource.id,
          LOCAL_ASSET_INSPECTION_RECIPE,
          JSON.stringify(facts),
          Date.now(),
        );
    });
    const stored = await readInspection(input.source.resource.id);
    if (!stored) {
      throw new Error(
        `Local Asset inspection for ${input.source.resource.id} was not indexed.`,
      );
    }
    assertCompleteInspectionFacts(input.source.resource, stored.facts);
    if (JSON.stringify(stored.facts) !== JSON.stringify(facts)) {
      throw new Error(
        `Local Asset inspection candidate for ${input.source.resource.id} conflicts with the inspection CAS winner.`,
      );
    }
    return stored;
  }

  async function ensureInspection(
    source: LocalResourceProjection,
  ): Promise<InspectionRow | undefined> {
    const stored = await readInspection(source.resource.id);
    if (stored) {
      assertCompleteInspectionFacts(source.resource, stored.facts);
      return stored;
    }

    const inspectResource = options.inspectResource;
    if (!inspectResource) return undefined;

    const key = `${source.resource.id}\u0000${LOCAL_ASSET_INSPECTION_RECIPE}`;
    const existing = inspectionInFlight.get(key);
    if (existing) return existing;

    const task = (async () => {
      const raced = await readInspection(source.resource.id);
      if (raced) {
        assertCompleteInspectionFacts(source.resource, raced.facts);
        return raced;
      }
      const probed = LocalAssetInspectionFactsSchema.parse(
        await inspectResource({
          sourcePath: source.path,
          resource: source.resource,
        }),
      );
      return persistInspection({
        source,
        facts: mergeInspectionFacts(
          source.resource.id,
          inspectionFactsFromKnown(source, undefined),
          probed,
        ),
      });
    })();
    inspectionInFlight.set(key, task);
    try {
      return await task;
    } finally {
      if (inspectionInFlight.get(key) === task) {
        inspectionInFlight.delete(key);
      }
    }
  }

  async function installedSource(
    input: LocalResourceProjection,
  ): Promise<LocalResourceProjection> {
    const source = await resources.resolve(input.resource.id);
    if (!source || !sameResourceFacts(source, input)) {
      throw new Error(
        `Source Resource ${input.resource.id} is not installed with the claimed immutable facts.`,
      );
    }
    return source;
  }

  function inspectionFactsFromKnown(
    source: LocalResourceProjection,
    knownFacts: ProjectAssetMetadata | undefined,
  ): LocalAssetInspectionFacts {
    if (
      knownFacts?.contentType !== undefined &&
      knownFacts.contentType !== source.resource.contentType
    ) {
      throw new Error(
        `Inspection content type for ${source.resource.id} conflicts with its immutable Resource facts.`,
      );
    }
    const selected = knownFacts
      ? {
          ...(knownFacts.width === undefined
            ? {}
            : { width: knownFacts.width }),
          ...(knownFacts.height === undefined
            ? {}
            : { height: knownFacts.height }),
          ...(knownFacts.durationMs === undefined
            ? {}
            : { durationMs: knownFacts.durationMs }),
          ...(knownFacts.frameRate === undefined
            ? {}
            : { frameRate: knownFacts.frameRate }),
          ...(knownFacts.videoCodec === undefined
            ? {}
            : { videoCodec: knownFacts.videoCodec }),
          ...(knownFacts.hasAudio === undefined
            ? {}
            : { hasAudio: knownFacts.hasAudio }),
          ...(knownFacts.audioCodec === undefined
            ? {}
            : { audioCodec: knownFacts.audioCodec }),
        }
      : {};
    return LocalAssetInspectionFactsSchema.parse({
      ...selected,
      ...(source.resource.contentType
        ? { contentType: source.resource.contentType }
        : {}),
    });
  }

  function mergeInspectionFacts(
    sourceResourceId: string,
    left: LocalAssetInspectionFacts,
    right: LocalAssetInspectionFacts,
  ): LocalAssetInspectionFacts {
    const merged: Record<string, unknown> = { ...left };
    for (const [key, value] of Object.entries(right)) {
      const existing = merged[key];
      if (
        existing !== undefined &&
        JSON.stringify(existing) !== JSON.stringify(value)
      ) {
        throw new Error(
          `Inspection fact ${key} for ${sourceResourceId} conflicts with the persisted Resource facts.`,
        );
      }
      merged[key] = value;
    }
    return LocalAssetInspectionFactsSchema.parse(merged);
  }

  return {
    async inspect(input) {
      const source = await installedSource(input.source);
      const knownFacts = inspectionFactsFromKnown(source, input.knownFacts);
      const inspection = await ensureInspection(source);
      // Caller metadata can enrich this one projection, but only byte-derived
      // Host inspection is durable Resource registry state.
      const facts = inspection
        ? mergeInspectionFacts(source.resource.id, inspection.facts, knownFacts)
        : knownFacts;

      return { facts };
    },
  };
}
