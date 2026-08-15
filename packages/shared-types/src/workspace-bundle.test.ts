import { describe, expect, it } from "vitest";

import * as sharedTypes from "./index";

function validManifest() {
  const resourceDigest = "a".repeat(64);
  const snapshotDigest = "b".repeat(64);
  return {
    schemaVersion: 1,
    kind: "clash.workspace.bundle",
    source: {
      projectId: "project-one",
      display: {
        name: "Portable Project",
        description: "A receiver-local display projection",
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T01:00:00.000Z",
      },
    },
    content: {
      workspaceRoot: "workspace",
      project: {
        path: "project.bin",
        codec: "loro-shallow-snapshot",
        codecVersion: 1,
      },
      resources: [
        {
          resource: {
            id: `sha256:${resourceDigest}`,
            kind: "image",
            digest: { algorithm: "sha256", value: resourceDigest },
            byteLength: 3,
            contentType: "image/png",
          },
          path: `objects/sha256/${resourceDigest}`,
        },
      ],
      documentBodies: [],
      textRevisions: [],
    },
    semanticRequirements: {
      generatorDefinitions: [],
      modelReferences: [],
    },
    files: [
      {
        path: `objects/sha256/${resourceDigest}`,
        role: "object",
        bytes: 3,
        sha256: resourceDigest,
        mode: "0644",
      },
      {
        path: "project.bin",
        role: "project",
        bytes: 4,
        sha256: snapshotDigest,
        mode: "0644",
      },
      {
        path: "workspace/story.md",
        role: "workspace",
        bytes: 5,
        sha256: "c".repeat(64),
        mode: "0644",
      },
    ],
    excluded: [
      {
        path: ".clash/project.toml",
        reason: "target-marker-regenerated",
      },
      {
        path: ".git",
        reason: "vcs-private",
      },
    ],
    integrity: {
      algorithm: "sha256",
      canonicalization: "clash.workspace-manifest-json.v1",
      bundleDigest: "d".repeat(64),
    },
  } as const;
}

type RuntimeSchema = {
  safeParse(value: unknown): { success: boolean };
};

function exportedSchema(name: string): RuntimeSchema {
  return (
    (sharedTypes as unknown as Record<string, RuntimeSchema | undefined>)[
      name
    ] ?? { safeParse: () => ({ success: false }) }
  );
}

function validExportPlan() {
  const manifest = validManifest();
  return {
    schemaVersion: 1,
    kind: "clash.workspace.export-plan",
    exportId: "export_capability_0001",
    expiresAt: "2026-08-14T02:00:00.000Z",
    source: {
      ...manifest.source,
      sourceWorkspaceId: "external:project-one:source",
    },
    content: manifest.content,
    semanticRequirements: manifest.semanticRequirements,
    files: manifest.files
      .filter((file) => file.role !== "workspace")
      .map((file, index) => ({
        ...file,
        fileId: `file_capability_${String(index).padStart(4, "0")}`,
      })),
  } as const;
}

function validImportStart() {
  const manifest = validManifest();
  return {
    schemaVersion: 1,
    kind: "clash.workspace.import-start",
    idempotencyKey: `workspace-import:${manifest.integrity.bundleDigest}`,
    bundleDigest: manifest.integrity.bundleDigest,
    manifest,
  } as const;
}

function validImportSession(status: "staging" | "committed" = "staging") {
  const start = validImportStart();
  return {
    schemaVersion: 1,
    kind: "clash.workspace.import-session",
    importId: "import_capability_0001",
    expiresAt: "2026-08-14T03:00:00.000Z",
    status,
    idempotencyKey: start.idempotencyKey,
    bundleDigest: start.bundleDigest,
    source: start.manifest.source,
    target: { projectId: "project-imported" },
    files: start.manifest.files
      .filter((file) => file.role !== "workspace")
      .map((file, index) => ({
        ...file,
        fileId: `upload_capability_${String(index).padStart(4, "0")}`,
        state:
          status === "committed" ? ("present" as const) : ("missing" as const),
      })),
    ...(status === "committed"
      ? { committedAt: "2026-08-14T02:30:00.000Z" }
      : {}),
  } as const;
}

function validImportFileUploadReceipt() {
  const session = validImportSession();
  const file = session.files[0];
  return {
    schemaVersion: 1,
    kind: "clash.workspace.import-file-upload-receipt",
    importId: session.importId,
    fileId: file.fileId,
    state: "present",
    bytes: file.bytes,
    sha256: file.sha256,
  } as const;
}

function validImportCommitRequest() {
  const start = validImportStart();
  return {
    schemaVersion: 1,
    kind: "clash.workspace.import-commit",
    idempotencyKey: start.idempotencyKey,
    bundleDigest: start.bundleDigest,
  } as const;
}

function validImportCommitResponse(
  status: "committed" | "already-committed" = "committed",
) {
  const session = validImportSession("committed");
  return {
    schemaVersion: 1,
    kind: "clash.workspace.import-commit-response",
    status,
    importId: session.importId,
    idempotencyKey: session.idempotencyKey,
    bundleDigest: session.bundleDigest,
    source: session.source,
    target: session.target,
    committedAt: session.committedAt,
  } as const;
}

describe("Workspace bundle contract", () => {
  it("uses one tagged project.bin and content-addressed bodies without storage topology", () => {
    const base = validManifest();
    const resourceDigest = base.content.resources[0].resource.digest.value;
    const documentDigest = "e".repeat(64);
    const textDigest = "f".repeat(64);
    const manifest = {
      ...base,
      content: {
        workspaceRoot: "workspace",
        project: {
          path: "project.bin",
          codec: "loro-shallow-snapshot",
          codecVersion: 1,
        },
        resources: base.content.resources,
        documentBodies: [
          {
            contentHash: `sha256:${documentDigest}`,
            byteLength: 7,
            contentType: "application/json",
            path: `objects/sha256/${documentDigest}`,
          },
        ],
        textRevisions: [
          {
            revision: {
              schemaVersion: 1,
              kind: "clash.text.revision",
              textId: "text-one",
              revisionId: "revision-one",
              projectId: base.source.projectId,
              nodeId: "node-one",
              createdAt: "2026-08-14T00:00:00.000Z",
              contentHash: textDigest.slice(0, 16),
              hashAlgorithm: "sha256-64",
              sourceFilePath: "drafts/script.md",
              sourceFileHash: textDigest.slice(0, 16),
            },
            path: `objects/sha256/${textDigest}`,
          },
        ],
      },
      files: [
        {
          path: `objects/sha256/${resourceDigest}`,
          role: "object",
          bytes: 3,
          sha256: resourceDigest,
          mode: "0644",
        },
        {
          path: `objects/sha256/${documentDigest}`,
          role: "object",
          bytes: 7,
          sha256: documentDigest,
          mode: "0644",
        },
        {
          path: `objects/sha256/${textDigest}`,
          role: "object",
          bytes: 8,
          sha256: textDigest,
          mode: "0644",
        },
        {
          path: "project.bin",
          role: "project",
          bytes: 4,
          sha256: "b".repeat(64),
          mode: "0644",
        },
        base.files[2],
      ].sort((left, right) => left.path.localeCompare(right.path)),
    };
    const legacyTopology = {
      ...base,
      content: {
        workspaceRoot: "workspace",
        projectSnapshotPath: "projects/private/snapshot.bin",
        resources: base.content.resources,
        documentBodies: [],
        textRevisions: [],
      },
    };
    const schema = exportedSchema("WorkspaceBundleManifestSchema");

    expect(schema.safeParse(manifest).success).toBe(true);
    expect(schema.safeParse(legacyTopology).success).toBe(false);
    expect(JSON.stringify(manifest)).not.toMatch(
      /sqlite|storageKey|snapshot\.bin|local\.sqlite/u,
    );
  });

  it("allows one CAS object to satisfy multiple semantic content references", () => {
    const base = validManifest();
    const digest = base.content.resources[0].resource.digest.value;
    const sharedPath = `objects/sha256/${digest}`;
    const manifest = {
      ...base,
      content: {
        ...base.content,
        documentBodies: [
          {
            contentHash: `sha256:${digest}`,
            byteLength: 3,
            contentType: "application/json",
            path: sharedPath,
          },
        ],
      },
      files: base.files.map((file) =>
        file.path === sharedPath ? { ...file, role: "object" } : file,
      ),
    };

    expect(
      exportedSchema("WorkspaceBundleManifestSchema").safeParse(manifest)
        .success,
    ).toBe(true);
  });

  it("publishes a strict v1 Workspace manifest schema", () => {
    const schema = (
      sharedTypes as unknown as Record<
        string,
        { safeParse(value: unknown): unknown }
      >
    ).WorkspaceBundleManifestSchema;

    expect(schema).toBeDefined();
  });

  it("accepts a Workspace content bundle without execution configuration", () => {
    const schema = (
      sharedTypes as unknown as Record<
        string,
        { parse(value: unknown): Record<string, unknown> }
      >
    ).WorkspaceBundleManifestSchema;
    const parsed = schema.parse(validManifest());

    expect(parsed.kind).toBe("clash.workspace.bundle");
    expect(parsed).not.toHaveProperty("executionLock");
  });

  it("rejects execution configuration from the product Workspace manifest", () => {
    const schema = (
      sharedTypes as unknown as Record<
        string,
        { safeParse(value: unknown): { success: boolean } }
      >
    ).WorkspaceBundleManifestSchema;

    expect(
      schema.safeParse({
        ...validManifest(),
        executionLock: { harness: "codex", apiKey: "secret" },
      }).success,
    ).toBe(false);
  });

  it("rejects owner identity from portable Project display metadata", () => {
    const manifest = validManifest();
    const schema = (
      sharedTypes as unknown as Record<
        string,
        { safeParse(value: unknown): { success: boolean } }
      >
    ).WorkspaceBundleManifestSchema;

    expect(
      schema.safeParse({
        ...manifest,
        source: {
          ...manifest.source,
          display: { ...manifest.source.display, ownerId: "source-user" },
        },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...manifest,
        source: {
          ...manifest.source,
          sourceWorkspaceId: "source-machine-workspace",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects provider selection and unresolved diagnostics from Workspace semantic hints", () => {
    const manifest = validManifest();
    const schema = (
      sharedTypes as unknown as Record<
        string,
        { safeParse(value: unknown): { success: boolean } }
      >
    ).WorkspaceBundleManifestSchema;

    expect(
      schema.safeParse({
        ...manifest,
        semanticRequirements: {
          generatorDefinitions: [],
          modelReferences: [{ modelId: "image-model", providerId: "private" }],
          unresolved: [
            { kind: "model", id: "missing", reason: "not resolved" },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    "../escape",
    "/absolute/file",
    "C:/machine/file",
    "workspace//double",
    "workspace/./dot",
    "workspace/back\\slash",
    `workspace/cafe\u0301.md`,
  ])("rejects non-portable path %s", (unsafePath) => {
    const manifest = validManifest();
    const schema = (
      sharedTypes as unknown as Record<
        string,
        { safeParse(value: unknown): { success: boolean } }
      >
    ).WorkspaceBundleManifestSchema;

    expect(
      schema.safeParse({
        ...manifest,
        files: manifest.files.map((file, index) =>
          index === 2 ? { ...file, path: unsafePath } : file,
        ),
      }).success,
    ).toBe(false);
  });

  it("rejects case-folded path collisions across target files", () => {
    const manifest = validManifest();
    const schema = (
      sharedTypes as unknown as Record<
        string,
        { safeParse(value: unknown): { success: boolean } }
      >
    ).WorkspaceBundleManifestSchema;

    expect(
      schema.safeParse({
        ...manifest,
        files: [
          ...manifest.files,
          {
            path: "workspace/Story.md",
            role: "workspace",
            bytes: 5,
            sha256: "e".repeat(64),
            mode: "0644",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      name: "missing Resource bytes",
      change: (manifest: ReturnType<typeof validManifest>) => ({
        ...manifest,
        files: manifest.files.filter((file) => file.role !== "object"),
      }),
    },
    {
      name: "Resource digest disagreement",
      change: (manifest: ReturnType<typeof validManifest>) => ({
        ...manifest,
        files: manifest.files.map((file) =>
          file.role === "object" ? { ...file, sha256: "f".repeat(64) } : file,
        ),
      }),
    },
    {
      name: "unreferenced Resource payload",
      change: (manifest: ReturnType<typeof validManifest>) => ({
        ...manifest,
        files: [
          ...manifest.files,
          {
            path: `resources/${"e".repeat(64)}/original.png`,
            role: "object" as const,
            bytes: 1,
            sha256: "e".repeat(64),
            mode: "0644" as const,
          },
        ],
      }),
    },
    {
      name: "workspace file outside its layer",
      change: (manifest: ReturnType<typeof validManifest>) => ({
        ...manifest,
        files: manifest.files.map((file) =>
          file.role === "workspace" ? { ...file, path: "story.md" } : file,
        ),
      }),
    },
    {
      name: "project state with the wrong role",
      change: (manifest: ReturnType<typeof validManifest>) => ({
        ...manifest,
        files: manifest.files.map((file) =>
          file.path === manifest.content.project.path
            ? { ...file, role: "workspace" as const }
            : file,
        ),
      }),
    },
  ])("rejects $name", ({ change }) => {
    const schema = (
      sharedTypes as unknown as Record<
        string,
        { safeParse(value: unknown): { success: boolean } }
      >
    ).WorkspaceBundleManifestSchema;

    expect(schema.safeParse(change(validManifest())).success).toBe(false);
  });

  it("requires one canonical content-addressed path per Resource", () => {
    const manifest = validManifest();
    const nonCanonical = `resources/${"a".repeat(64)}/original.png`;
    const schema = (
      sharedTypes as unknown as Record<
        string,
        { safeParse(value: unknown): { success: boolean } }
      >
    ).WorkspaceBundleManifestSchema;

    expect(
      schema.safeParse({
        ...manifest,
        content: {
          ...manifest.content,
          resources: manifest.content.resources.map((entry) => ({
            ...entry,
            path: nonCanonical,
          })),
        },
        files: manifest.files
          .map((file) =>
            file.role === "object" ? { ...file, path: nonCanonical } : file,
          )
          .sort((left, right) => left.path.localeCompare(right.path)),
      }).success,
    ).toBe(false);
  });

  it("requires canonical file ordering", () => {
    const manifest = validManifest();
    const schema = (
      sharedTypes as unknown as Record<
        string,
        { safeParse(value: unknown): { success: boolean } }
      >
    ).WorkspaceBundleManifestSchema;

    expect(
      schema.safeParse({ ...manifest, files: [...manifest.files].reverse() })
        .success,
    ).toBe(false);
  });

  it("rejects duplicate Resource identities even when payload paths differ", () => {
    const manifest = validManifest();
    const duplicate = {
      ...manifest.content.resources[0],
      path: `resources/${"a".repeat(64)}/duplicate.png`,
    };
    const schema = (
      sharedTypes as unknown as Record<
        string,
        { safeParse(value: unknown): { success: boolean } }
      >
    ).WorkspaceBundleManifestSchema;

    expect(
      schema.safeParse({
        ...manifest,
        content: {
          ...manifest.content,
          resources: [...manifest.content.resources, duplicate],
        },
        files: [
          manifest.files[0],
          manifest.files[1],
          {
            path: duplicate.path,
            role: "object",
            bytes: 3,
            sha256: "a".repeat(64),
            mode: "0644",
          },
          manifest.files[2],
        ],
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      name: "absolute source projection path",
      sourceFilePath: "/Users/source/projections/script.md",
      fileSha256: `${"e".repeat(16)}${"f".repeat(48)}`,
    },
    {
      name: "body digest that disagrees with revision contentHash",
      sourceFilePath: "projections/text/script.md",
      fileSha256: "f".repeat(64),
    },
  ])("rejects text revision with $name", ({ sourceFilePath, fileSha256 }) => {
    const manifest = validManifest();
    const revisionId = "revision-one";
    const path = `objects/sha256/${fileSha256}`;
    const revision = {
      schemaVersion: 1,
      kind: "clash.text.revision",
      textId: "text-one",
      revisionId,
      projectId: manifest.source.projectId,
      nodeId: "node-one",
      createdAt: "2026-08-14T00:00:00.000Z",
      contentHash: "e".repeat(16),
      hashAlgorithm: "sha256-64",
      sourceFilePath,
      sourceFileHash: "source-hash",
    };
    const schema = (
      sharedTypes as unknown as Record<
        string,
        { safeParse(value: unknown): { success: boolean } }
      >
    ).WorkspaceBundleManifestSchema;

    expect(
      schema.safeParse({
        ...manifest,
        content: {
          ...manifest.content,
          textRevisions: [{ revision, path }],
        },
        files: [
          manifest.files[0],
          {
            path,
            role: "object",
            bytes: 4,
            sha256: fileSha256,
            mode: "0644",
          },
          manifest.files[1],
          manifest.files[2],
        ],
      }).success,
    ).toBe(false);
  });

  it.each([
    ".env.local",
    "drafts/.npmrc",
    ".ssh/id_ed25519",
    "config/credentials.json",
    "drafts/private-key.pem",
  ])("rejects secret-like text source path %s", (sourceFilePath) => {
    const manifest = validManifest();
    const fileSha256 = "f".repeat(64);
    const path = `objects/sha256/${fileSha256}`;
    expect(
      exportedSchema("WorkspaceBundleManifestSchema").safeParse({
        ...manifest,
        content: {
          ...manifest.content,
          textRevisions: [
            {
              revision: {
                schemaVersion: 1,
                kind: "clash.text.revision",
                textId: "text-one",
                revisionId: "revision-one",
                projectId: manifest.source.projectId,
                nodeId: "node-one",
                createdAt: "2026-08-14T00:00:00.000Z",
                contentHash: fileSha256.slice(0, 16),
                hashAlgorithm: "sha256-64",
                sourceFilePath,
                sourceFileHash: "source-hash",
              },
              path,
            },
          ],
        },
        files: [
          manifest.files[0],
          {
            path,
            role: "object",
            bytes: 4,
            sha256: fileSha256,
            mode: "0644",
          },
          manifest.files[1],
          manifest.files[2],
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts portable nested product JSON and rejects nested machine-private values", () => {
    const schema = exportedSchema("WorkspacePortableJsonObjectSchema");
    expect(
      schema.safeParse({
        modelId: "portable-model",
        prompt: "/close-up portrait with authored slash command text",
        settings: { ratio: "16:9", steps: [1, 2, 3] },
      }).success,
    ).toBe(true);
    for (const value of [
      { settings: { providerAccountId: "provider-private" } },
      { invocation: [{ apiKey: "sk-private" }] },
      { credentials: { region: "local" } },
      { nested: { accessToken: "token-private" } },
      { nested: { localPath: "relative-but-machine-owned" } },
      { nested: { workerUrl: "http://127.0.0.1:4321" } },
      { nested: { runtimeId: "runtime-private" } },
      { nested: { outputPath: "/Users/source/private/output.mov" } },
      { nested: { sourceFile: "C:\\Users\\source\\private.mov" } },
      { nested: { sourceUrl: "file:///Users/source/private.mov" } },
    ]) {
      expect(schema.safeParse(value).success).toBe(false);
    }
  });
});

describe("Workspace transfer wire contract", () => {
  it.each([
    ["WorkspaceExportRequestSchema", { sourceWorkspaceId: "workspace-source" }],
    ["WorkspaceExportPlanSchema", validExportPlan()],
    ["WorkspaceImportStartSchema", validImportStart()],
    ["WorkspaceImportSessionSchema", validImportSession()],
    ["WorkspaceImportFileUploadReceiptSchema", validImportFileUploadReceipt()],
    ["WorkspaceImportCommitRequestSchema", validImportCommitRequest()],
    ["WorkspaceImportCommitResponseSchema", validImportCommitResponse()],
    [
      "WorkspaceImportCommitResponseSchema",
      validImportCommitResponse("already-committed"),
    ],
  ])("accepts the strict %s envelope", (schemaName, value) => {
    expect(exportedSchema(schemaName).safeParse(value).success).toBe(true);
  });

  it.each([
    [
      "WorkspaceExportRequestSchema",
      { sourceWorkspaceId: "workspace-source", credential: "secret" },
    ],
    [
      "WorkspaceExportPlanSchema",
      {
        ...validExportPlan(),
        files: validExportPlan().files.map((file, index) =>
          index === 0
            ? { ...file, storageKey: "local-blobs/private/resource" }
            : file,
        ),
      },
    ],
    [
      "WorkspaceImportStartSchema",
      { ...validImportStart(), provider: "machine-provider" },
    ],
    [
      "WorkspaceImportSessionSchema",
      {
        ...validImportSession(),
        target: { projectId: "project-imported", realm: "private-realm" },
      },
    ],
    [
      "WorkspaceImportFileUploadReceiptSchema",
      { ...validImportFileUploadReceipt(), hostPath: "/private/blob" },
    ],
    [
      "WorkspaceImportCommitRequestSchema",
      { ...validImportCommitRequest(), ownerId: "source-owner" },
    ],
    [
      "WorkspaceImportCommitResponseSchema",
      { ...validImportCommitResponse(), providerAccountId: "account-private" },
    ],
  ])("rejects private or unknown fields in %s", (schemaName, value) => {
    expect(exportedSchema(schemaName).safeParse(value).success).toBe(false);
  });

  it.each([
    [
      "WorkspaceExportPlanSchema",
      { ...validExportPlan(), expiresAt: "2026-08-14T02:00:00" },
    ],
    [
      "WorkspaceImportSessionSchema",
      { ...validImportSession(), expiresAt: "not-a-timestamp" },
    ],
  ])("rejects an invalid expiry in %s", (schemaName, value) => {
    expect(exportedSchema(schemaName).safeParse(value).success).toBe(false);
  });

  it("requires an opaque export file capability instead of a logical or Host path", () => {
    const plan = validExportPlan();
    expect(
      exportedSchema("WorkspaceExportPlanSchema").safeParse({
        ...plan,
        files: plan.files.map((file, index) =>
          index === 0 ? { ...file, fileId: file.path } : file,
        ),
      }).success,
    ).toBe(false);
  });

  it("rejects an ExportPlan whose capability descriptors disagree with its content closure", () => {
    const plan = validExportPlan();
    expect(
      exportedSchema("WorkspaceExportPlanSchema").safeParse({
        ...plan,
        files: plan.files.map((file) =>
          file.role === "object" ? { ...file, sha256: "f".repeat(64) } : file,
        ),
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      name: "file capability",
      change: () => {
        const session = validImportSession();
        return {
          ...session,
          files: session.files.map((file, index) =>
            index === 1 ? { ...file, fileId: session.files[0].fileId } : file,
          ),
        };
      },
    },
    {
      name: "logical path",
      change: () => {
        const session = validImportSession();
        return {
          ...session,
          files: session.files.map((file, index) =>
            index === 1 ? { ...file, path: session.files[0].path } : file,
          ),
        };
      },
    },
  ])("rejects duplicate ImportSession slot $name identity", ({ change }) => {
    expect(
      exportedSchema("WorkspaceImportSessionSchema").safeParse(change())
        .success,
    ).toBe(false);
  });

  it.each([
    ["WorkspaceImportStartSchema", validImportStart()],
    ["WorkspaceImportSessionSchema", validImportSession()],
    ["WorkspaceImportCommitRequestSchema", validImportCommitRequest()],
    ["WorkspaceImportCommitResponseSchema", validImportCommitResponse()],
  ])(
    "binds the %s idempotency key canonically to its bundle digest",
    (schemaName, value) => {
      expect(
        exportedSchema(schemaName).safeParse({
          ...value,
          idempotencyKey: "workspace-import:wrong-bundle",
        }).success,
      ).toBe(false);
    },
  );

  it("requires the ImportStart digest claim to match its manifest", () => {
    expect(
      exportedSchema("WorkspaceImportStartSchema").safeParse({
        ...validImportStart(),
        bundleDigest: "e".repeat(64),
      }).success,
    ).toBe(false);
  });

  it("keeps worktree files out of Host ImportSession upload slots", () => {
    const session = validImportSession();
    expect(
      exportedSchema("WorkspaceImportSessionSchema").safeParse({
        ...session,
        files: [
          ...session.files,
          {
            path: "workspace/story.md",
            role: "workspace",
            bytes: 5,
            sha256: "c".repeat(64),
            mode: "0644",
            fileId: "upload_capability_workspace_0001",
            state: "missing",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires a committed session to have every file and a commit timestamp", () => {
    const session = validImportSession("committed");
    const { committedAt: _committedAt, ...withoutCommittedAt } = session;
    expect(
      exportedSchema("WorkspaceImportSessionSchema").safeParse({
        ...session,
        files: session.files.map((file, index) =>
          index === 0 ? { ...file, state: "missing" } : file,
        ),
      }).success,
    ).toBe(false);
    expect(
      exportedSchema("WorkspaceImportSessionSchema").safeParse(
        withoutCommittedAt,
      ).success,
    ).toBe(false);
  });

  it("rejects committed-only facts while an import session is staging", () => {
    expect(
      exportedSchema("WorkspaceImportSessionSchema").safeParse({
        ...validImportSession(),
        committedAt: "2026-08-14T02:30:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("requires commit requests and receipts to repeat exact content identity", () => {
    expect(
      exportedSchema("WorkspaceImportCommitRequestSchema").safeParse({
        ...validImportCommitRequest(),
        bundleDigest: "not-a-digest",
      }).success,
    ).toBe(false);
    expect(
      exportedSchema("WorkspaceImportFileUploadReceiptSchema").safeParse({
        ...validImportFileUploadReceipt(),
        state: "missing",
      }).success,
    ).toBe(false);
  });
});
