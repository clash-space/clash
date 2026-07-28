import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  prependPythonPath,
  resolveAcpBinDir,
  resolveAgentBundleRoot,
  resolveClashCliEntryPath,
  resolveClashCliNodePath,
  resolveDesktopStatePaths,
  resolveClashSdkPythonPath,
  resolveWebDistDir,
} from "./paths";

describe("desktop paths", () => {
  it("keeps mutable NLE handoffs under the canonical Clash home", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(mainSource).not.toContain('app.getPath("userData")');
    expect(mainSource).toContain('join(dirname(dataDir), "nle-handoffs")');
  });

  it("keeps Electron-owned browser state below the canonical Clash home", () => {
    expect(resolveDesktopStatePaths("/Users/me/.clash/local-api")).toEqual({
      root: join("/Users/me/.clash", "desktop"),
      userData: join("/Users/me/.clash", "desktop", "user-data"),
      sessionData: join("/Users/me/.clash", "desktop", "session-data"),
      logs: join("/Users/me/.clash", "logs", "desktop"),
      crashDumps: join("/Users/me/.clash", "desktop", "crash-dumps"),
    });
  });

  it("lets an explicit web dist directory override packaged and dev defaults", () => {
    expect(
      resolveWebDistDir({
        envWebDistDir: "/tmp/clash-web",
        isPackaged: true,
        moduleDir: "/app/dist",
        resourcesPath: "/app/resources",
      }),
    ).toBe("/tmp/clash-web");
  });

  it("loads bundled web assets from resources in packaged apps", () => {
    expect(
      resolveWebDistDir({
        isPackaged: true,
        moduleDir: "/app/dist",
        resourcesPath: "/app/resources",
      }),
    ).toBe(join("/app/resources", "web-dist"));
  });

  it("loads the workspace web build in development", () => {
    expect(
      resolveWebDistDir({
        isPackaged: false,
        moduleDir: "/repo/apps/desktop/dist",
        resourcesPath: "/app/resources",
      }),
    ).toBe(resolve("/repo/apps/desktop/dist", "../../web/dist/client"));
  });

  it("uses the managed ACP install directory in packaged apps", () => {
    expect(resolveAcpBinDir("/Users/me/.clash/local-api")).toBe(
      join("/Users/me/.clash/local-api", "acp-bin"),
    );
  });

  it("uses the managed ACP install directory in development", () => {
    expect(resolveAcpBinDir("/tmp/clash-local-api")).toBe(
      join("/tmp/clash-local-api", "acp-bin"),
    );
  });

  it("exposes the Clash CLI from resources for packaged child processes", () => {
    expect(
      resolveClashCliEntryPath({
        isPackaged: true,
        moduleDir: "/app/dist",
        resourcesPath: "/app/resources",
      }),
    ).toBe(join("/app/resources", "clash-cli", "dist", "index.js"));
    expect(
      resolveClashCliNodePath({
        isPackaged: true,
        moduleDir: "/app/dist",
        resourcesPath: "/app/resources",
      }),
    ).toBe(join("/app/resources", "clash-cli", "vendor"));
  });

  it("exposes built-in agents from Resources instead of app.asar", () => {
    expect(
      resolveAgentBundleRoot({
        isPackaged: true,
        moduleDir: "/app/Resources/app.asar/dist",
        resourcesPath: "/app/Resources",
      }),
    ).toBe(join("/app/Resources", "agents"));
    expect(
      resolveAgentBundleRoot({
        isPackaged: false,
        moduleDir: "/repo/apps/desktop/dist",
        resourcesPath: "/app/Resources",
      }),
    ).toBe(resolve("/repo/apps/desktop/dist", "../../../packages/clash-bridge/dist/agents"));
  });

  it("exposes the workspace Clash CLI build in development", () => {
    expect(
      resolveClashCliEntryPath({
        isPackaged: false,
        moduleDir: "/repo/apps/desktop/dist",
        resourcesPath: "/app/resources",
      }),
    ).toBe(resolve("/repo/apps/desktop/dist", "../../../packages/cli/dist/index.js"));
    expect(
      resolveClashCliNodePath({
        isPackaged: false,
        moduleDir: "/repo/apps/desktop/dist",
        resourcesPath: "/app/resources",
      }),
    ).toBeUndefined();
  });

  it("resolves the bundled local-model Python SDK without losing an existing PYTHONPATH", () => {
    expect(resolveClashSdkPythonPath({
      isPackaged: true,
      moduleDir: "/app/Resources/app.asar/dist",
      resourcesPath: "/app/Resources",
    })).toBe(join("/app/Resources", "clash-sdk", "python"));
    expect(resolveClashSdkPythonPath({
      isPackaged: false,
      moduleDir: "/repo/apps/desktop/dist",
      resourcesPath: "/app/Resources",
    })).toBe(resolve("/repo/apps/desktop/dist", "../../../packages/clash-sdk/python"));
    expect(resolveClashSdkPythonPath({
      envPythonSdkPath: "/tmp/custom-clash-sdk-python",
      isPackaged: true,
      moduleDir: "/app/Resources/app.asar/dist",
      resourcesPath: "/app/Resources",
    })).toBe("/tmp/custom-clash-sdk-python");
    expect(prependPythonPath("/tmp/user-python", "/app/Resources/clash-sdk/python")).toBe(
      `/app/Resources/clash-sdk/python${process.platform === "win32" ? ";" : ":"}/tmp/user-python`,
    );
    expect(prependPythonPath("/app/Resources/clash-sdk/python", "/app/Resources/clash-sdk/python")).toBe(
      "/app/Resources/clash-sdk/python",
    );
  });
});
