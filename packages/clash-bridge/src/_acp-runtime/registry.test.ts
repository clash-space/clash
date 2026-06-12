import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { detect, resolveAgentCommand } from "./registry";

describe("ACP runtime registry", () => {
  it("prefers a daemon-managed ACP bin directory over PATH", async () => {
    const binDir = join(tmpdir(), `clash-acp-bin-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    const command = join(binDir, "codex");
    await writeFile(command, "#!/usr/bin/env node\n", { mode: 0o755 });

    await expect(resolveAgentCommand("codex", {
      env: {
        PATH: "/usr/bin:/bin",
        CLASH_ACP_BIN_DIR: binDir,
      },
      cwd: "/tmp",
      fromUrl: import.meta.url,
    })).resolves.toBe(command);
  });

  it("returns detected agents with their resolved local command", async () => {
    const binDir = join(tmpdir(), `clash-acp-detect-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    const command = join(binDir, "gemini");
    await writeFile(command, "#!/usr/bin/env node\n", { mode: 0o755 });
    const previous = process.env.CLASH_ACP_BIN_DIR;
    process.env.CLASH_ACP_BIN_DIR = binDir;

    try {
      await expect(detect("gemini-cli")).resolves.toMatchObject({
        id: "gemini-cli",
        spec: { command },
      });
    } finally {
      if (previous === undefined) delete process.env.CLASH_ACP_BIN_DIR;
      else process.env.CLASH_ACP_BIN_DIR = previous;
    }
  });

  it("does not detect Codex CLI as a native ACP agent when the binary lacks --acp support", async () => {
    const binDir = join(tmpdir(), `clash-acp-codex-no-acp-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    await writeFile(
      join(binDir, "codex"),
      "#!/usr/bin/env node\nconsole.log('Usage: codex [OPTIONS] [PROMPT]');\n",
      { mode: 0o755 },
    );
    const previous = process.env.CLASH_ACP_BIN_DIR;
    process.env.CLASH_ACP_BIN_DIR = binDir;

    try {
      await expect(detect("codex-cli")).resolves.toBeNull();
    } finally {
      if (previous === undefined) delete process.env.CLASH_ACP_BIN_DIR;
      else process.env.CLASH_ACP_BIN_DIR = previous;
    }
  });

  it("detects Codex through the self-hosted app-server ACP bridge", async () => {
    const binDir = join(tmpdir(), `clash-acp-codex-app-server-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    const command = join(binDir, "codex");
    await writeFile(
      command,
      `#!/usr/bin/env node
if (process.argv.slice(2).join(" ") === "app-server --help") {
  console.log("Usage: codex app-server [OPTIONS] [COMMAND]");
  process.exit(0);
}
console.log("Usage: codex [OPTIONS] [PROMPT]");
`,
      { mode: 0o755 },
    );
    const previous = process.env.CLASH_ACP_BIN_DIR;
    process.env.CLASH_ACP_BIN_DIR = binDir;

    try {
      const detected = await detect("codex-app-server");
      expect(detected).toMatchObject({
        id: "codex-app-server",
        spec: {
          command: process.execPath,
        },
      });
      expect(detected?.spec.args).toContain("--codex");
      expect(detected?.spec.args).toContain(command);
      expect(detected?.spec.args?.some((arg) => arg.includes("codex-app-server-acp"))).toBe(true);
      expect(detected?.spec.env).toMatchObject({ ELECTRON_RUN_AS_NODE: "1" });
    } finally {
      if (previous === undefined) delete process.env.CLASH_ACP_BIN_DIR;
      else process.env.CLASH_ACP_BIN_DIR = previous;
    }
  });
});
