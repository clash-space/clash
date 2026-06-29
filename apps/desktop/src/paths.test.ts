import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAcpBinDirs, resolveClashCliEntryPath, resolveClashCliNodePath, resolveWebDistDir } from "./paths";

describe("desktop paths", () => {
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
    expect(
      resolveAcpBinDirs({
        isPackaged: true,
        moduleDir: "/app/dist",
        resourcesPath: "/app/resources",
        dataDir: "/Users/me/Library/Application Support/Clash/local-api",
      }),
    ).toEqual([
      join("/Users/me/Library/Application Support/Clash/local-api", "acp-bin"),
    ]);
  });

  it("uses the managed ACP install directory in development", () => {
    expect(
      resolveAcpBinDirs({
        isPackaged: false,
        moduleDir: "/repo/apps/desktop/dist",
        resourcesPath: "/app/resources",
        dataDir: "/tmp/clash-local-api",
      }),
    ).toEqual([
      join("/tmp/clash-local-api", "acp-bin"),
    ]);
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
});
