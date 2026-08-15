import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveWorkspaceTextInput } from "./workspace-text-input.js";

describe("workspace text input", () => {
  it("reads exact UTF-8 content from a workspace-relative file", async () => {
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), "clash-content-workspace-"),
    );
    const source = "export default () => <div>你好</div>;\n";
    await writeFile(join(workspaceRoot, "character.tsx"), source, "utf8");

    await expect(
      resolveWorkspaceTextInput({
        workspaceRoot,
        filePath: "character.tsx",
      }),
    ).resolves.toBe(source);
  });

  it("keeps inline content and file input mutually exclusive", async () => {
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), "clash-content-exclusive-"),
    );
    await writeFile(join(workspaceRoot, "character.tsx"), "from-file", "utf8");

    await expect(
      resolveWorkspaceTextInput({
        workspaceRoot,
        inline: "inline",
        filePath: "character.tsx",
      }),
    ).rejects.toThrow(/mutually exclusive/i);
  });

  it("rejects lexical traversal and symlinks that escape the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-content-boundary-"));
    const workspaceRoot = join(root, "workspace");
    const outside = join(root, "outside.tsx");
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(outside, "outside", "utf8");
    await symlink(outside, join(workspaceRoot, "escaped.tsx"));

    await expect(
      resolveWorkspaceTextInput({
        workspaceRoot,
        filePath: "../outside.tsx",
      }),
    ).rejects.toThrow(/inside the workspace/i);
    await expect(
      resolveWorkspaceTextInput({
        workspaceRoot,
        filePath: "escaped.tsx",
      }),
    ).rejects.toThrow(/symlink|inside the workspace/i);
  });

  it("rejects directories and invalid UTF-8 instead of changing their bytes", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "clash-content-utf8-"));
    await writeFile(
      join(workspaceRoot, "invalid.tsx"),
      new Uint8Array([0xc3, 0x28]),
    );

    await expect(
      resolveWorkspaceTextInput({ workspaceRoot, filePath: "." }),
    ).rejects.toThrow(/regular file/i);
    await expect(
      resolveWorkspaceTextInput({
        workspaceRoot,
        filePath: "invalid.tsx",
      }),
    ).rejects.toThrow(/UTF-8/i);
  });
});
