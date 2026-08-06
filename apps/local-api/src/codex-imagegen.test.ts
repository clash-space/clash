import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

import { describe, expect, it, vi } from "vitest";

describe("Codex ImageGen kernel adapter", () => {
  it("resolves a configured relative executable path so it survives a cwd change", async () => {
    const { resolveCodexCli } = await import("./codex-imagegen");
    const binDir = await mkdtemp(join(tmpdir(), "clash-codex-path-"));
    await writeFile(join(binDir, "codex"), "#!/bin/sh\n");
    await chmod(join(binDir, "codex"), 0o755);

    const resolved = resolveCodexCli({
      CODEX_BIN: relative(process.cwd(), join(binDir, "codex")),
      PATH: "",
    });

    expect(resolved).not.toBeNull();
    expect(isAbsolute(resolved!)).toBe(true);
    await rm(binDir, { recursive: true, force: true });
  });

  it("invokes the signed-in Codex CLI with references and returns a validated PNG", async () => {
    const module = await import("./codex-imagegen").catch(() => ({}));
    const createGenerator = (module as Record<string, unknown>).createCodexImageGenerator as
      | ((options: Record<string, unknown>) => (input: unknown) => Promise<any>)
      | undefined;
    expect(createGenerator).toBeTypeOf("function");
    if (!createGenerator) return;

    const exec = vi.fn(async (file: string, args: string[], options: { cwd: string }) => {
      expect(file).toBe("/usr/local/bin/codex");
      expect(args).toEqual(expect.arrayContaining([
        "-a",
        "never",
        "exec",
        "--json",
        "--ephemeral",
        "--ignore-rules",
        "-s",
        "workspace-write",
        "-i",
      ]));
      expect(args).not.toContain("--ignore-user-config");
      expect(args.filter((value) => value === "-i")).toHaveLength(1);
      expect(args.at(-1)).toContain("Aspect ratio: 16:9");
      await writeFile(
        `${options.cwd}/result.png`,
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
      );
      return { stdout: "{\"type\":\"turn.completed\"}\n", stderr: "" };
    });
    const generate = createGenerator({
      codexPath: "/usr/local/bin/codex",
      exec,
    });

    await expect(generate({
      prompt: "A paper-cut moon",
      aspectRatio: "16:9",
      references: [{
        asset: {
          assetId: "reference-1",
          uri: "clash-asset://reference-1",
          kind: "image",
          mediaType: "image/png",
        },
        mediaType: "image/png",
        bytes: new Uint8Array([1, 2, 3]),
      }],
    })).resolves.toEqual({
      mediaType: "image/png",
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
    });
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("closes the Codex child stdin instead of waiting for additional prompt input", async () => {
    const { createCodexImageGenerator } = await import("./codex-imagegen");
    const binDir = await mkdtemp(join(tmpdir(), "clash-codex-stdin-"));
    const fakeCodex = join(binDir, "codex");
    await writeFile(fakeCodex, [
      "#!/bin/sh",
      "while IFS= read -r line; do :; done",
      "printf '\\211PNG\\r\\n\\032\\n\\001\\002\\003' > result.png",
      "",
    ].join("\n"));
    await chmod(fakeCodex, 0o755);

    const generate = createCodexImageGenerator({ codexPath: fakeCodex, timeoutMs: 1_000 });
    await expect(generate({
      prompt: "A paper-cut moon",
      aspectRatio: "1:1",
      references: [],
    })).resolves.toMatchObject({ mediaType: "image/png" });

    await rm(binDir, { recursive: true, force: true });
  });
});
