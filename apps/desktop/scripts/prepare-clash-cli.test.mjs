import { describe, expect, it } from "vitest";
import {
  packagedRuntimeArtifacts,
  resolveNpmInvocation,
} from "./prepare-clash-cli.mjs";

describe("prepare packaged Clash CLI", () => {
  it("only stages the runtime built by the root dependency graph", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("./prepare-clash-cli.mjs", import.meta.url), "utf8"),
    );
    expect(source).not.toContain("build:package");
    expect(source).toContain("staging the prebuilt unified Clash runtime");
    expect(source).toContain("pnpm prepare:desktop-pack");
    expect(source).not.toMatch(/"deploy",\s*"--legacy",\s*"--prod"/);
    expect(source).toContain('"--omit=dev"');
  });

  it("uses npm without inheriting the active pnpm entrypoint", () => {
    expect(
      resolveNpmInvocation({
        env: { npm_execpath: String.raw`D:\pnpm\pnpm.cjs` },
        platform: "linux",
      }),
    ).toEqual({ command: "npm", argsPrefix: [] });
  });

  it("derives the flattened Desktop resource layout from clashRuntime", () => {
    expect(
      packagedRuntimeArtifacts({
        clashRuntime: {
          dispatcher: "./runtime/dispatcher.js",
          localApi: "./runtime/local-api.cjs",
          agents: "./runtime/agents",
        },
      }),
    ).toEqual({
      dispatcher: "./dispatcher.js",
      localApi: "./local-api.cjs",
      agents: "./agents",
    });
  });

  it("rejects runtime declarations that escape the shared artifact root", () => {
    expect(() =>
      packagedRuntimeArtifacts({
        clashRuntime: { localApi: "./runtime/../other.cjs" },
      }),
    ).toThrow(/unsafe clashRuntime\.localApi/);
  });
});
