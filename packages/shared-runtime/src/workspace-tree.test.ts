import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  materializeWorkspaceTree,
  planWorkspaceTree,
} from "./workspace-tree.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{ sourceRoot: string; bundleRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "clash-workspace-tree-"));
  temporaryRoots.push(root);
  const sourceRoot = join(root, "source");
  const bundleRoot = join(root, "bundle");
  await Promise.all([
    mkdir(sourceRoot, { recursive: true }),
    mkdir(bundleRoot, { recursive: true }),
  ]);
  return { sourceRoot, bundleRoot };
}

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeSource(
  sourceRoot: string,
  path: string,
  contents = "portable\n",
): Promise<void> {
  await mkdir(dirname(join(sourceRoot, path)), { recursive: true });
  await writeFile(join(sourceRoot, path), contents);
}

describe("Workspace tree packer", () => {
  it("materializes an executable regular file with opened-byte facts", async () => {
    const { sourceRoot, bundleRoot } = await fixture();
    const contents = "#!/bin/sh\necho portable\n";
    await writeFile(join(sourceRoot, "build.sh"), contents);
    await chmod(join(sourceRoot, "build.sh"), 0o755);

    const plan = await planWorkspaceTree({ sourceRoot, bundleRoot });
    const packed = await materializeWorkspaceTree(plan);

    expect(packed.files).toEqual([
      {
        path: "workspace/build.sh",
        role: "workspace",
        bytes: Buffer.byteLength(contents),
        sha256: sha256(contents),
        mode: "0755",
      },
    ]);
    expect(
      await readFile(join(bundleRoot, "workspace", "build.sh"), "utf8"),
    ).toBe(contents);
    expect(
      Number((await lstat(join(bundleRoot, "workspace", "build.sh"))).mode) &
        0o777,
    ).toBe(0o755);
  });

  it("reports product-private exclusions while retaining an explicit environment example", async () => {
    const { sourceRoot, bundleRoot } = await fixture();
    await Promise.all([
      writeSource(sourceRoot, ".clash/project.toml"),
      writeSource(sourceRoot, ".clash/observed.json"),
      writeSource(sourceRoot, ".clash/runtime/daemon.json"),
      writeSource(sourceRoot, ".clash/cache/index.bin"),
      writeSource(sourceRoot, ".git/config"),
      writeSource(sourceRoot, "assets/links/preview.png"),
      writeSource(sourceRoot, ".env.example", "PUBLIC_ORIGIN=example.test\n"),
    ]);

    const packed = await materializeWorkspaceTree(
      await planWorkspaceTree({ sourceRoot, bundleRoot }),
    );

    expect(packed.files.map((file) => file.path)).toEqual([
      "workspace/.env.example",
    ]);
    expect(packed.excluded).toEqual([
      { path: ".clash/cache", reason: "cache" },
      { path: ".clash/observed.json", reason: "runtime-private" },
      {
        path: ".clash/project.toml",
        reason: "target-marker-regenerated",
      },
      { path: ".clash/runtime", reason: "runtime-private" },
      { path: ".git", reason: "vcs-private" },
      { path: "assets/links", reason: "runtime-private" },
    ]);
  });

  it.each([
    ".env",
    ".env.local",
    ".envrc",
    ".npmrc",
    ".ssh/id_ed25519",
    ".aws/credentials",
    "credentials.json",
    "auth-token.txt",
    "key.json",
    "private-key.pem",
    "signing.p12",
  ])("fails closed on secret-like path %s", async (path) => {
    const { sourceRoot, bundleRoot } = await fixture();
    await writeSource(sourceRoot, path);

    await expect(
      planWorkspaceTree({ sourceRoot, bundleRoot }),
    ).rejects.toMatchObject({ code: "SECRET_FILE" });
  });

  it("never follows a workspace symlink", async () => {
    const { sourceRoot, bundleRoot } = await fixture();
    const outside = join(dirname(sourceRoot), "outside.txt");
    await writeFile(outside, "outside secret\n");
    await symlink(outside, join(sourceRoot, "linked.txt"));

    await expect(
      planWorkspaceTree({ sourceRoot, bundleRoot }),
    ).rejects.toMatchObject({ code: "UNSAFE_ENTRY" });
  });

  it("rejects a multiply-linked regular source file", async () => {
    const { sourceRoot, bundleRoot } = await fixture();
    await writeSource(sourceRoot, "story.md");
    await link(join(sourceRoot, "story.md"), join(sourceRoot, "alias.md"));

    await expect(
      planWorkspaceTree({ sourceRoot, bundleRoot }),
    ).rejects.toMatchObject({ code: "UNSAFE_ENTRY" });
  });

  it("rejects a special filesystem entry", async () => {
    const { sourceRoot, bundleRoot } = await fixture();
    const socketPath = join(sourceRoot, "worker.sock");
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    try {
      await expect(
        planWorkspaceTree({ sourceRoot, bundleRoot }),
      ).rejects.toMatchObject({ code: "UNSAFE_ENTRY" });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("rejects a staging bundle nested under its source tree", async () => {
    const { sourceRoot } = await fixture();
    const bundleRoot = join(sourceRoot, ".export");
    await mkdir(bundleRoot);
    await writeSource(sourceRoot, "story.md");

    await expect(
      planWorkspaceTree({ sourceRoot, bundleRoot }),
    ).rejects.toMatchObject({ code: "SOURCE_OUTPUT_OVERLAP" });
  });

  it("rejects source bytes changed after planning without publishing workspace output", async () => {
    const { sourceRoot, bundleRoot } = await fixture();
    await writeSource(sourceRoot, "story.md", "planned\n");
    const plan = await planWorkspaceTree({ sourceRoot, bundleRoot });
    await writeFile(join(sourceRoot, "story.md"), "changed\n");

    await expect(materializeWorkspaceTree(plan)).rejects.toMatchObject({
      code: "SOURCE_CHANGED",
    });
    await expect(lstat(join(bundleRoot, "workspace"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rescans for a secret created after planning", async () => {
    const { sourceRoot, bundleRoot } = await fixture();
    await writeSource(sourceRoot, "story.md");
    const plan = await planWorkspaceTree({ sourceRoot, bundleRoot });
    await writeSource(sourceRoot, ".env", "TOKEN=late\n");

    await expect(materializeWorkspaceTree(plan)).rejects.toMatchObject({
      code: "SECRET_FILE",
    });
    await expect(lstat(join(bundleRoot, "workspace"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects a portable case collision when the source filesystem represents both names", async () => {
    const { sourceRoot, bundleRoot } = await fixture();
    await writeSource(sourceRoot, "Readme.md", "first\n");
    await writeSource(sourceRoot, "README.md", "second\n");
    const represented = (await readdir(sourceRoot)).filter(
      (name) => name.toLowerCase() === "readme.md",
    );
    if (represented.length < 2) return;

    await expect(
      planWorkspaceTree({ sourceRoot, bundleRoot }),
    ).rejects.toMatchObject({ code: "PATH_COLLISION" });
  });

  it("rejects a portable NFC collision when the source filesystem represents both names", async () => {
    const { sourceRoot, bundleRoot } = await fixture();
    await writeSource(sourceRoot, "caf\u00e9.txt", "first\n");
    await writeSource(sourceRoot, "cafe\u0301.txt", "second\n");
    const represented = (await readdir(sourceRoot)).filter(
      (name) => name.normalize("NFC") === "caf\u00e9.txt",
    );
    if (represented.length < 2) return;

    await expect(
      planWorkspaceTree({ sourceRoot, bundleRoot }),
    ).rejects.toMatchObject({ code: "PATH_COLLISION" });
  });

  it("rejects a portable file-directory collision when the source filesystem represents both names", async () => {
    const { sourceRoot, bundleRoot } = await fixture();
    await writeSource(sourceRoot, "Output/result.txt", "nested\n");
    const secondNameCreated = await writeFile(
      join(sourceRoot, "output"),
      "file\n",
    ).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "EISDIR") return false;
        throw error;
      },
    );
    if (!secondNameCreated) return;
    const represented = (await readdir(sourceRoot)).filter(
      (name) => name.toLowerCase() === "output",
    );
    if (represented.length < 2) return;

    await expect(
      planWorkspaceTree({ sourceRoot, bundleRoot }),
    ).rejects.toMatchObject({ code: "PATH_COLLISION" });
  });

  it.each([
    {
      name: "file count",
      limits: { maxFileCount: 1 },
      expectedCode: "FILE_COUNT_LIMIT_EXCEEDED",
    },
    {
      name: "individual file bytes",
      limits: { maxFileBytes: 1 },
      expectedCode: "FILE_BYTES_LIMIT_EXCEEDED",
    },
    {
      name: "total bytes",
      limits: { maxTotalBytes: 3 },
      expectedCode: "TOTAL_BYTES_LIMIT_EXCEEDED",
    },
  ])("enforces the caller's $name limit", async ({ limits, expectedCode }) => {
    const { sourceRoot, bundleRoot } = await fixture();
    await Promise.all([
      writeSource(sourceRoot, "one.txt", "12"),
      writeSource(sourceRoot, "two.txt", "34"),
    ]);

    await expect(
      planWorkspaceTree({ sourceRoot, bundleRoot, limits }),
    ).rejects.toMatchObject({ code: expectedCode });
  });

  it("rejects an invalid caller limit", async () => {
    const { sourceRoot, bundleRoot } = await fixture();

    await expect(
      planWorkspaceTree({
        sourceRoot,
        bundleRoot,
        limits: { maxFileCount: -1 },
      }),
    ).rejects.toMatchObject({ code: "INVALID_LIMIT" });
  });

  it("does not replace an existing workspace payload root", async () => {
    const { sourceRoot, bundleRoot } = await fixture();
    await writeSource(sourceRoot, "story.md");
    await mkdir(join(bundleRoot, "workspace"));
    const plan = await planWorkspaceTree({ sourceRoot, bundleRoot });

    await expect(materializeWorkspaceTree(plan)).rejects.toMatchObject({
      code: "TARGET_EXISTS",
    });
  });
});
