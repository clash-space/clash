import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { detect, KNOWN_ACP_AGENTS, resolveAgentCommand } from "./registry";

describe("ACP runtime registry", () => {
  it("registers Zed's Codex harness as the only Codex ACP harness", () => {
    const codexIds = KNOWN_ACP_AGENTS
      .filter((agent) => agent.id.includes("codex"))
      .map((agent) => agent.id);

    expect(codexIds).toEqual(["codex-acp"]);
    expect(KNOWN_ACP_AGENTS.find((agent) => agent.id === "codex-acp")).toMatchObject({
      label: "Codex",
      spec: { command: "codex-acp" },
      homepage: "https://github.com/zed-industries/codex-acp",
    });
  });

  it("exposes Codex and Claude as registry-installed harnesses", () => {
    expect(KNOWN_ACP_AGENTS.filter((agent) => agent.id === "codex-acp" || agent.id === "claude-acp").map((agent) => [
      agent.id,
      agent.label,
      agent.installSource,
      agent.registryId,
    ])).toEqual([
      ["codex-acp", "Codex", "registry", "codex-acp"],
      ["claude-acp", "Claude", "registry", "claude-acp"],
    ]);
    expect(KNOWN_ACP_AGENTS.some((agent) => agent.id === "claude-code-acp")).toBe(false);
  });

  it("keeps only non-registry ACP CLIs detectable from system paths", () => {
    expect(KNOWN_ACP_AGENTS.filter((agent) => agent.systemPath).map((agent) => [agent.id, agent.label, agent.spec])).toEqual([
      ["hermes", "Hermes", { command: "hermes", args: ["acp"] }],
      ["openclaw", "OpenClaw", { command: "openclaw", args: ["acp"] }],
    ]);
    expect(KNOWN_ACP_AGENTS.find((agent) => agent.id === "gemini")).toMatchObject({
      spec: { command: "clash-acp-gemini", args: ["--acp"] },
      registryId: "gemini",
      installSource: "registry",
    });
    expect(KNOWN_ACP_AGENTS.find((agent) => agent.id === "opencode")).toMatchObject({
      spec: { command: "clash-acp-opencode", args: ["acp"] },
      registryId: "opencode",
      installSource: "registry",
    });
  });

  it("uses the public ACP registry for installable popular agents and keeps Hermes/OpenClaw as custom commands", () => {
    const registryInstallable = KNOWN_ACP_AGENTS
      .filter((agent) => agent.installSource === "registry")
      .map((agent) => agent.id);

    expect(registryInstallable).toEqual(expect.arrayContaining([
      "codex-acp",
      "claude-acp",
      "gemini",
      "opencode",
      "cursor",
      "qwen-code",
      "github-copilot-cli",
      "kilo",
      "grok-build",
    ]));
    expect(KNOWN_ACP_AGENTS.find((agent) => agent.id === "hermes")).toMatchObject({
      label: "Hermes",
      spec: { command: "hermes", args: ["acp"] },
      systemPath: true,
    });
    expect(KNOWN_ACP_AGENTS.find((agent) => agent.id === "hermes")?.installSource).toBeUndefined();
    expect(KNOWN_ACP_AGENTS.find((agent) => agent.id === "openclaw")).toMatchObject({
      label: "OpenClaw",
      spec: { command: "openclaw", args: ["acp"] },
      systemPath: true,
    });
    expect(KNOWN_ACP_AGENTS.find((agent) => agent.id === "openclaw")?.installSource).toBeUndefined();
  });

  it("prefers a daemon-managed ACP bin directory over PATH", async () => {
    const binDir = join(tmpdir(), `clash-acp-bin-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    const command = join(binDir, "codex-acp");
    await writeFile(command, "#!/usr/bin/env node\n", { mode: 0o755 });

    await expect(resolveAgentCommand("codex-acp", {
      env: {
        PATH: "/usr/bin:/bin",
        CLASH_ACP_BIN_DIR: binDir,
      },
      cwd: "/tmp",
      fromUrl: import.meta.url,
    })).resolves.toBe(command);
  });

  it("does not resolve unmanaged commands from the user PATH", async () => {
    const binDir = join(tmpdir(), `clash-acp-user-path-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    const command = join(binDir, "random-agent");
    await writeFile(command, "#!/usr/bin/env node\n", { mode: 0o755 });

    await expect(resolveAgentCommand("random-agent", {
      env: {
        PATH: binDir,
        CLASH_ACP_BIN_DIR: "",
      },
      cwd: binDir,
      fromUrl: import.meta.url,
    })).resolves.toBeNull();
  });

  it("resolves ACP bins only from the managed bin path list", async () => {
    const root = join(tmpdir(), `clash-acp-managed-${process.pid}-${Date.now()}`);
    const managedBinDir = join(root, "managed");
    await mkdir(managedBinDir, { recursive: true });
    const managedClaude = join(managedBinDir, "claude-agent-acp");
    const managedCodex = join(managedBinDir, "codex-acp");
    await writeFile(managedClaude, "#!/usr/bin/env node\n", { mode: 0o755 });
    await writeFile(managedCodex, "#!/usr/bin/env node\n", { mode: 0o755 });

    const env = {
      PATH: "",
      CLASH_ACP_BIN_DIR: managedBinDir,
    };

    await expect(resolveAgentCommand("codex-acp", { env, cwd: root, fromUrl: import.meta.url })).resolves.toBe(managedCodex);
    await expect(detect("claude-acp", { env, cwd: root, fromUrl: import.meta.url })).resolves.toMatchObject({
      id: "claude-acp",
      spec: { command: managedClaude },
    });
  });

  it("resolves and launches managed Windows command wrappers through cmd.exe", async () => {
    const root = join(tmpdir(), `clash-acp-windows-${process.pid}-${Date.now()}`);
    const managedBinDir = join(root, "managed");
    await mkdir(managedBinDir, { recursive: true });
    const managedCodex = join(managedBinDir, "codex-acp.cmd");
    await writeFile(managedCodex, "@echo off\r\n");
    const commandInterpreter = String.raw`C:\Windows\System32\cmd.exe`;
    const env = {
      PATH: "",
      CLASH_ACP_BIN_DIR: managedBinDir,
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
      ComSpec: commandInterpreter,
    };
    const options = {
      env,
      cwd: root,
      fromUrl: import.meta.url,
      platform: "win32" as const,
    };

    await expect(resolveAgentCommand("codex-acp", options)).resolves.toBe(managedCodex);
    await expect(detect("codex-acp", options)).resolves.toMatchObject({
      id: "codex-acp",
      spec: {
        command: commandInterpreter,
        args: ["/d", "/s", "/c", managedCodex],
      },
    });
  });

  it("does not detect Gemini from the system PATH", async () => {
    const binDir = join(tmpdir(), `clash-acp-gemini-system-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    const gemini = join(binDir, "gemini");
    await writeFile(
      gemini,
      [
        "#!/bin/sh",
        "if [ \"${1:-}\" = \"--help\" ]; then",
        "  echo 'Usage: gemini [options]'",
        "  echo '      --experimental-acp          Starts the agent in ACP mode'",
        "  exit 0",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    await expect(detect("gemini", {
      env: {
        PATH: binDir,
        CLASH_ACP_BIN_DIR: "",
      },
      cwd: "/tmp",
      fromUrl: import.meta.url,
      systemPathFallbackDirs: [],
    })).resolves.toBeNull();
  });

  it("detects Gemini only from the managed ACP bin directory", async () => {
    const binDir = join(tmpdir(), `clash-acp-gemini-managed-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    const gemini = join(binDir, "clash-acp-gemini");
    await writeFile(gemini, "#!/usr/bin/env node\n", { mode: 0o755 });

    await expect(detect("gemini", {
      env: {
        PATH: "",
        CLASH_ACP_BIN_DIR: binDir,
      },
      cwd: "/tmp",
      fromUrl: import.meta.url,
      systemPathFallbackDirs: [],
    })).resolves.toMatchObject({
      id: "gemini",
      spec: { command: gemini, args: ["--acp"] },
    });
  });

  it("detects non-registry native ACP CLIs from the system PATH", async () => {
    const binDir = join(tmpdir(), `clash-acp-detect-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    const hermes = join(binDir, "hermes");
    const openclaw = join(binDir, "openclaw");
    const opencode = join(binDir, "opencode");
    await writeFile(hermes, "#!/usr/bin/env node\n", { mode: 0o755 });
    await writeFile(openclaw, "#!/usr/bin/env node\n", { mode: 0o755 });
    await writeFile(opencode, "#!/usr/bin/env node\n", { mode: 0o755 });

    const env = {
      PATH: binDir,
      CLASH_ACP_BIN_DIR: "",
    };

    await expect(detect("hermes", { env, cwd: "/tmp", fromUrl: import.meta.url, systemPathFallbackDirs: [] })).resolves.toMatchObject({
      id: "hermes",
      spec: { command: hermes, args: ["acp"] },
    });
    await expect(detect("opencode", { env, cwd: "/tmp", fromUrl: import.meta.url, systemPathFallbackDirs: [] })).resolves.toBeNull();
    await expect(detect("openclaw", { env, cwd: "/tmp", fromUrl: import.meta.url, systemPathFallbackDirs: [] })).resolves.toMatchObject({
      id: "openclaw",
      spec: { command: openclaw, args: ["acp"] },
    });
  });

  it("detects native ACP CLIs from common user toolchain bins when GUI PATH is sparse", async () => {
    const home = join(tmpdir(), `clash-acp-home-${process.pid}-${Date.now()}`);
    const nvmBin = join(home, ".nvm", "versions", "node", "v22.0.0", "bin");
    await mkdir(nvmBin, { recursive: true });
    const hermes = join(nvmBin, "hermes");
    await writeFile(hermes, "#!/usr/bin/env node\n", { mode: 0o755 });

    await expect(detect("hermes", {
      env: {
        PATH: "/usr/bin:/bin",
        CLASH_ACP_BIN_DIR: "",
        HOME: home,
      },
      cwd: "/tmp",
      fromUrl: import.meta.url,
      systemPathFallbackDirs: [],
    })).resolves.toMatchObject({
      id: "hermes",
      spec: { command: hermes, args: ["acp"] },
    });
  });

  it("detects native ACP CLIs from allowlisted macOS app bundles", async () => {
    const appRoot = join(tmpdir(), `clash-acp-apps-${process.pid}-${Date.now()}`);
    const appBin = join(appRoot, "Hermes.app", "Contents", "MacOS");
    await mkdir(appBin, { recursive: true });
    const hermes = join(appBin, "hermes");
    await writeFile(hermes, "#!/usr/bin/env node\n", { mode: 0o755 });

    await expect(detect("hermes", {
      env: {
        PATH: "",
        CLASH_ACP_BIN_DIR: "",
      },
      cwd: "/tmp",
      fromUrl: import.meta.url,
      systemPathFallbackDirs: [],
      applicationDirs: [appRoot],
    })).resolves.toMatchObject({
      id: "hermes",
      spec: { command: hermes, args: ["acp"] },
    });
  });

  it("does not detect non-executable files as native ACP CLIs", async () => {
    const binDir = join(tmpdir(), `clash-acp-noexec-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    const hermes = join(binDir, "hermes");
    await writeFile(hermes, "#!/usr/bin/env node\n", { mode: 0o644 });

    await expect(detect("hermes", {
      env: {
        PATH: binDir,
        CLASH_ACP_BIN_DIR: "",
      },
      cwd: "/tmp",
      fromUrl: import.meta.url,
      systemPathFallbackDirs: [],
    })).resolves.toBeNull();
  });

  it("does not fall back to a system Gemini CLI even when it advertises --acp", async () => {
    const binDir = join(tmpdir(), `clash-gemini-legacy-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    const gemini = join(binDir, "gemini");
    await writeFile(
      gemini,
      [
        "#!/bin/sh",
        "if [ \"${1:-}\" = \"--help\" ]; then",
        "  echo 'Usage: gemini [options]'",
        "  echo '      --acp          Starts the agent in ACP mode'",
        "  exit 0",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    await expect(detect("gemini", {
      env: { PATH: binDir, CLASH_ACP_BIN_DIR: "" },
      cwd: "/tmp",
      fromUrl: import.meta.url,
      systemPathFallbackDirs: [],
    })).resolves.toBeNull();
  });

  it("does not detect Gemini as an ACP harness when its help exposes no ACP mode", async () => {
    const binDir = join(tmpdir(), `clash-gemini-no-acp-${process.pid}-${Date.now()}`);
    await mkdir(binDir, { recursive: true });
    const gemini = join(binDir, "gemini");
    await writeFile(
      gemini,
      [
        "#!/bin/sh",
        "if [ \"${1:-}\" = \"--help\" ]; then",
        "  echo 'Usage: gemini [options]'",
        "  exit 0",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    await expect(detect("gemini", {
      env: { PATH: binDir, CLASH_ACP_BIN_DIR: "" },
      cwd: "/tmp",
      fromUrl: import.meta.url,
      systemPathFallbackDirs: [],
    })).resolves.toBeNull();
  });

  it("does not resolve Codex ACP from repo node_modules before install", async () => {
    const previousPath = process.env.PATH;
    const previousBinDir = process.env.CLASH_ACP_BIN_DIR;
    process.env.PATH = "";
    delete process.env.CLASH_ACP_BIN_DIR;

    try {
      const detected = await detect("codex-acp");
      expect(detected).toBeNull();
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousBinDir === undefined) delete process.env.CLASH_ACP_BIN_DIR;
      else process.env.CLASH_ACP_BIN_DIR = previousBinDir;
    }
  });
});
