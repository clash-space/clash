import { createHash } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createWorkspaceBundleManifest,
  materializeVerifiedWorkspaceBundleFile,
  verifyWorkspaceBundleDirectory,
  writeWorkspaceBundleManifest,
} from "./index";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function unsignedManifest() {
  const snapshot = new Uint8Array([1, 2, 3]);
  const story = "portable story\n";
  return {
    schemaVersion: 1 as const,
    kind: "clash.workspace.bundle" as const,
    source: {
      projectId: "project-portable",
      display: { name: "Portable Project" },
    },
    content: {
      workspaceRoot: "workspace" as const,
      project: {
        path: "project.bin" as const,
        codec: "loro-shallow-snapshot" as const,
        codecVersion: 1 as const,
      },
      resources: [],
      documentBodies: [],
      textRevisions: [],
    },
    semanticRequirements: {
      generatorDefinitions: [],
      modelReferences: [],
    },
    files: [
      {
        path: "project.bin",
        role: "project" as const,
        bytes: snapshot.byteLength,
        sha256: sha256(snapshot),
        mode: "0644" as const,
      },
      {
        path: "workspace/story.md",
        role: "workspace" as const,
        bytes: Buffer.byteLength(story),
        sha256: sha256(story),
        mode: "0644" as const,
      },
    ],
    excluded: [],
  };
}

async function writeBundlePayload(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "clash-workspace-bundle-"));
  roots.push(root);
  await mkdir(join(root, "workspace"), { recursive: true });
  await writeFile(join(root, "project.bin"), new Uint8Array([1, 2, 3]));
  await writeFile(join(root, "workspace", "story.md"), "portable story\n");
  await Promise.all([
    chmod(join(root, "project.bin"), 0o644),
    chmod(join(root, "workspace", "story.md"), 0o644),
  ]);
  return root;
}

async function writeValidBundle(): Promise<string> {
  const root = await writeBundlePayload();
  await writeWorkspaceBundleManifest(root, unsignedManifest());
  return root;
}

describe("Workspace bundle filesystem", () => {
  it.each(["workspace/.git/config", "workspace/.env.production"])(
    "rejects a malicious worktree payload path %s even when declared",
    async (path) => {
      const root = await writeBundlePayload();
      const manifest = unsignedManifest();

      await expect(
        writeWorkspaceBundleManifest(root, {
          ...manifest,
          files: manifest.files.map((file) =>
            file.role === "workspace" ? { ...file, path } : file,
          ),
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN_WORKSPACE_PATH" });
    },
  );

  it("rejects an included worktree path covered by an excluded declaration", async () => {
    const root = await writeBundlePayload();

    await expect(
      writeWorkspaceBundleManifest(root, {
        ...unsignedManifest(),
        excluded: [{ path: "story.md", reason: "runtime-private" }],
      }),
    ).rejects.toMatchObject({ code: "EXCLUDED_PATH_INCLUDED" });
  });

  it("computes the bundle digest from canonical manifest content", () => {
    const first = createWorkspaceBundleManifest(unsignedManifest());
    const changed = createWorkspaceBundleManifest({
      ...unsignedManifest(),
      source: {
        ...unsignedManifest().source,
        display: { name: "Changed" },
      },
    });
    expect(first.integrity.bundleDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(changed.integrity.bundleDigest).not.toBe(
      first.integrity.bundleDigest,
    );
  });

  it("writes and verifies every declared regular payload file", async () => {
    const root = await writeValidBundle();

    const verified = await verifyWorkspaceBundleDirectory(root);

    expect(verified.manifest.source.projectId).toBe("project-portable");
    expect(verified.filesVerified).toBe(2);
  });

  it("allows only the exact root manifest outside the declared payload", async () => {
    const root = await writeBundlePayload();
    await writeFile(join(root, ".workspace.json.unfinished"), "stale");

    await expect(
      writeWorkspaceBundleManifest(root, unsignedManifest()),
    ).rejects.toMatchObject({ code: "UNDECLARED_FILE" });
  });

  it("rejects a manifest whose bytes exceed the caller's verification limit", async () => {
    const root = await writeValidBundle();

    await expect(
      verifyWorkspaceBundleDirectory(root, {
        limits: { maxManifestBytes: 1 },
      }),
    ).rejects.toMatchObject({ code: "MANIFEST_BYTES_LIMIT_EXCEEDED" });
  });

  it("rejects a manifest declaring more files than the caller's limit", async () => {
    const root = await writeValidBundle();

    await expect(
      verifyWorkspaceBundleDirectory(root, {
        limits: { maxFileCount: 1 },
      }),
    ).rejects.toMatchObject({ code: "FILE_COUNT_LIMIT_EXCEEDED" });
  });

  it("stops traversal when actual payload files exceed the caller's limit", async () => {
    const root = await writeValidBundle();
    await writeFile(join(root, "workspace", "undeclared.md"), "undeclared");

    await expect(
      verifyWorkspaceBundleDirectory(root, {
        limits: { maxFileCount: 2 },
      }),
    ).rejects.toMatchObject({ code: "FILE_COUNT_LIMIT_EXCEEDED" });
  });

  it("rejects declared payload bytes above the caller's limit", async () => {
    const root = await writeValidBundle();

    await expect(
      verifyWorkspaceBundleDirectory(root, {
        limits: { maxDeclaredTotalBytes: 3 },
      }),
    ).rejects.toMatchObject({ code: "DECLARED_BYTES_LIMIT_EXCEEDED" });
  });

  it("rejects actual payload bytes above the caller's limit", async () => {
    const root = await writeValidBundle();

    await expect(
      verifyWorkspaceBundleDirectory(root, {
        limits: { maxActualTotalBytes: 3 },
      }),
    ).rejects.toMatchObject({ code: "ACTUAL_BYTES_LIMIT_EXCEEDED" });
  });

  it("applies caller limits while writing a new manifest", async () => {
    const root = await writeBundlePayload();

    await expect(
      writeWorkspaceBundleManifest(root, unsignedManifest(), {
        limits: { maxFileCount: 1 },
      }),
    ).rejects.toMatchObject({ code: "FILE_COUNT_LIMIT_EXCEEDED" });
  });

  it("materializes an opened source file only after its bytes verify", async () => {
    const root = await writeValidBundle();
    const destinationRoot = await mkdtemp(
      join(tmpdir(), "clash-workspace-materialized-"),
    );
    roots.push(destinationRoot);
    const file = unsignedManifest().files[1]!;

    const materialized = await materializeVerifiedWorkspaceBundleFile({
      bundleRoot: root,
      destinationRoot,
      file,
    });

    expect(
      await readFile(join(destinationRoot, "workspace", "story.md"), "utf8"),
    ).toBe("portable story\n");
    expect(materialized).toEqual({
      path: "workspace/story.md",
      bytes: 15,
      sha256: sha256("portable story\n"),
      mode: "0644",
    });
  });

  it("refuses to materialize a protected worktree descriptor independently", async () => {
    const root = await writeValidBundle();
    const destinationRoot = await mkdtemp(
      join(tmpdir(), "clash-workspace-materialized-"),
    );
    roots.push(destinationRoot);

    await expect(
      materializeVerifiedWorkspaceBundleFile({
        bundleRoot: root,
        destinationRoot,
        file: {
          ...unsignedManifest().files[1]!,
          path: "workspace/.env",
        },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN_WORKSPACE_PATH" });
  });

  it("re-hashes the opened source bytes instead of trusting an earlier verification", async () => {
    const root = await writeValidBundle();
    const destinationRoot = await mkdtemp(
      join(tmpdir(), "clash-workspace-materialized-"),
    );
    roots.push(destinationRoot);
    const file = unsignedManifest().files[1]!;
    await verifyWorkspaceBundleDirectory(root);
    await writeFile(join(root, file.path), "tampered bytes\n");

    await expect(
      materializeVerifiedWorkspaceBundleFile({
        bundleRoot: root,
        destinationRoot,
        file,
      }),
    ).rejects.toMatchObject({ code: "FILE_DIGEST_MISMATCH" });
    await expect(
      readFile(join(destinationRoot, file.path)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("atomically refuses to replace an existing destination file", async () => {
    const root = await writeValidBundle();
    const destinationRoot = await mkdtemp(
      join(tmpdir(), "clash-workspace-materialized-"),
    );
    roots.push(destinationRoot);
    await mkdir(join(destinationRoot, "workspace"));
    const destination = join(destinationRoot, "workspace", "story.md");
    await writeFile(destination, "keep me\n");

    await expect(
      materializeVerifiedWorkspaceBundleFile({
        bundleRoot: root,
        destinationRoot,
        file: unsignedManifest().files[1]!,
      }),
    ).rejects.toMatchObject({ code: "TARGET_EXISTS" });
    expect(await readFile(destination, "utf8")).toBe("keep me\n");
  });

  it("checks portable mode from the opened source before publishing", async () => {
    const root = await writeValidBundle();
    const destinationRoot = await mkdtemp(
      join(tmpdir(), "clash-workspace-materialized-"),
    );
    roots.push(destinationRoot);
    const file = unsignedManifest().files[1]!;
    await verifyWorkspaceBundleDirectory(root);
    await chmod(join(root, file.path), 0o755);

    await expect(
      materializeVerifiedWorkspaceBundleFile({
        bundleRoot: root,
        destinationRoot,
        file,
      }),
    ).rejects.toMatchObject({ code: "FILE_MODE_MISMATCH" });
    await expect(
      readFile(join(destinationRoot, file.path)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not follow a payload symlink while opening bytes for materialization", async () => {
    const root = await writeValidBundle();
    const destinationRoot = await mkdtemp(
      join(tmpdir(), "clash-workspace-materialized-"),
    );
    roots.push(destinationRoot);
    const file = unsignedManifest().files[1]!;
    const donor = join(root, "donor.md");
    await writeFile(donor, "portable story\n");
    await rm(join(root, file.path));
    await symlink(donor, join(root, file.path));

    await expect(
      materializeVerifiedWorkspaceBundleFile({
        bundleRoot: root,
        destinationRoot,
        file,
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_FILE" });
    await expect(
      readFile(join(destinationRoot, file.path)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a multiply-linked bundle payload", async () => {
    const root = await writeValidBundle();
    const outsideRoot = await mkdtemp(
      join(tmpdir(), "clash-workspace-hardlink-"),
    );
    roots.push(outsideRoot);
    await link(
      join(root, "workspace", "story.md"),
      join(outsideRoot, "story-alias.md"),
    );

    await expect(verifyWorkspaceBundleDirectory(root)).rejects.toMatchObject({
      code: "UNSAFE_FILE",
    });
  });

  it("reports a payload removed before materialization as missing", async () => {
    const root = await writeValidBundle();
    const destinationRoot = await mkdtemp(
      join(tmpdir(), "clash-workspace-materialized-"),
    );
    roots.push(destinationRoot);
    const file = unsignedManifest().files[1]!;
    await rm(join(root, file.path));

    await expect(
      materializeVerifiedWorkspaceBundleFile({
        bundleRoot: root,
        destinationRoot,
        file,
      }),
    ).rejects.toMatchObject({ code: "MISSING_FILE" });
  });

  it.each([
    {
      name: "mutated bytes",
      expectedCode: "FILE_SIZE_MISMATCH",
      mutate: async (root: string) =>
        writeFile(join(root, "workspace", "story.md"), "changed\n"),
    },
    {
      name: "missing bytes",
      expectedCode: "MISSING_FILE",
      mutate: async (root: string) => rm(join(root, "workspace", "story.md")),
    },
    {
      name: "undeclared bytes",
      expectedCode: "UNDECLARED_FILE",
      mutate: async (root: string) =>
        writeFile(join(root, "workspace", "extra.md"), "extra\n"),
    },
    {
      name: "executable-bit change",
      expectedCode: "FILE_MODE_MISMATCH",
      mutate: async (root: string) =>
        chmod(join(root, "workspace", "story.md"), 0o755),
    },
    {
      name: "symlink replacement",
      expectedCode: "UNSAFE_FILE",
      mutate: async (root: string) => {
        const outside = join(root, "outside.md");
        await writeFile(outside, "portable story\n");
        await rm(join(root, "workspace", "story.md"));
        await symlink(outside, join(root, "workspace", "story.md"));
      },
    },
  ])("rejects $name", async ({ expectedCode, mutate }) => {
    const root = await writeValidBundle();
    await mutate(root);

    await expect(verifyWorkspaceBundleDirectory(root)).rejects.toMatchObject({
      code: expectedCode,
    });
  });

  it("rejects a manifest changed without recomputing its self digest", async () => {
    const root = await writeValidBundle();
    const path = join(root, "workspace.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      any
    >;
    manifest.source.display.name = "Tampered";
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(verifyWorkspaceBundleDirectory(root)).rejects.toMatchObject({
      code: "BUNDLE_DIGEST_MISMATCH",
    });
  });
});
