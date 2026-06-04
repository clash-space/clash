import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWebDistDir } from "./paths";

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
});
