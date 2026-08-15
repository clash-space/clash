import { describe, expect, it } from "vitest";

import {
  ExecutablePluginRuntimeSchema,
  resolvePluginLanguage,
} from "./executable-plugin.js";

/**
 * The host launches a plugin; the plugin declares which interpreter to use.
 *
 * That declaration used to be implicit: the loader read the entrypoint extension,
 * so the extension whitelist (`.js`, `.mjs`, `.py`) doubled as the language
 * dispatcher. It worked, but it made a TypeScript entrypoint impossible to express
 * and left "how do I run this" as a filename convention.
 *
 * `language` is a closed enum rather than a command line on purpose. The host owns
 * the launch protocol, stdio framing, and lifecycle adapter for each supported
 * runtime; an arbitrary command would not have that contract.
 */
describe("plugin runtime language", () => {
  const base = {
    kind: "local" as const,
    transport: "stdio" as const,
    entrypoint: "dist/stdio.mjs",
  };

  it("accepts a declared interpreter", () => {
    const runtime = ExecutablePluginRuntimeSchema.parse({
      ...base,
      language: "node",
    });
    expect(resolvePluginLanguage(runtime)).toBe("node");
  });

  it("accepts python", () => {
    const runtime = ExecutablePluginRuntimeSchema.parse({
      ...base,
      entrypoint: "handler.py",
      language: "python",
    });
    expect(resolvePluginLanguage(runtime)).toBe("python");
  });

  it("rejects an interpreter without a host runtime adapter", () => {
    expect(() =>
      ExecutablePluginRuntimeSchema.parse({ ...base, language: "bash" }),
    ).toThrow();
    expect(() =>
      ExecutablePluginRuntimeSchema.parse({ ...base, language: "deno" }),
    ).toThrow();
  });

  it("infers the interpreter for manifests written before the field existed", () => {
    // Both plugins installed on a real machine predate `language`; they must keep
    // loading rather than fail closed on a field they cannot have.
    expect(
      resolvePluginLanguage({ kind: "local", entrypoint: "dist/handler.mjs" }),
    ).toBe("node");
    expect(
      resolvePluginLanguage({ kind: "local", entrypoint: "handler.py" }),
    ).toBe("python");
  });

  it("lets a declaration override a misleading extension", () => {
    expect(
      resolvePluginLanguage({
        kind: "local",
        language: "python",
        entrypoint: "handler.mjs",
      }),
    ).toBe("python");
  });

  it("has no interpreter for a hosted runtime", () => {
    expect(resolvePluginLanguage({ kind: "hosted" })).toBeUndefined();
  });
});

/**
 * `build` is how a plugin says its entrypoint is derived rather than authored. Its
 * presence is what tells the host to compile, so the host never has to guess from
 * filenames whether a `dist/` file is generated or hand-written -- and never
 * overwrites something it did not produce.
 */
describe("plugin runtime build declaration", () => {
  const base = {
    kind: "local" as const,
    transport: "stdio" as const,
    entrypoint: "dist/stdio.mjs",
    language: "node" as const,
  };

  it("accepts a source declaration", () => {
    const runtime = ExecutablePluginRuntimeSchema.parse({
      ...base,
      build: { source: "src/stdio.ts" },
    });
    expect(runtime.kind === "local" && runtime.build?.source).toBe(
      "src/stdio.ts",
    );
  });

  it("is absent for an authored entrypoint", () => {
    const runtime = ExecutablePluginRuntimeSchema.parse(base);
    expect(runtime.kind === "local" && runtime.build).toBeUndefined();
  });

  it("refuses a source path that escapes the plugin directory", () => {
    expect(() =>
      ExecutablePluginRuntimeSchema.parse({
        ...base,
        build: { source: "../elsewhere/stdio.ts" },
      }),
    ).toThrow();
  });

  it("refuses unknown build keys", () => {
    expect(() =>
      ExecutablePluginRuntimeSchema.parse({
        ...base,
        build: { source: "src/stdio.ts", command: "make" },
      }),
    ).toThrow();
  });
});

describe("plugin runtime resources", () => {
  const base = {
    kind: "local" as const,
    transport: "stdio" as const,
    entrypoint: "dist/stdio.mjs",
  };

  it("carries safe package-relative resources for a local executor", () => {
    const runtime = ExecutablePluginRuntimeSchema.parse({
      ...base,
      resources: ["dist/browser-bundle", "assets/fonts"],
    });

    expect(runtime.kind === "local" && runtime.resources).toEqual([
      "dist/browser-bundle",
      "assets/fonts",
    ]);
    expect(
      ExecutablePluginRuntimeSchema.safeParse({
        ...base,
        resources: ["../host/remotion-bundle"],
      }).success,
    ).toBe(false);
    expect(
      ExecutablePluginRuntimeSchema.safeParse({
        kind: "hosted",
        transport: "http",
        endpoint: "https://plugin.example.com/run",
        resources: ["dist/browser-bundle"],
      }).success,
    ).toBe(false);
  });
});
