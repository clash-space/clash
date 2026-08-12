import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assemblePlugin, defineAction } from "./assemble.js";

/**
 * An action a plugin brings itself.
 *
 * The four AIGC actions -- image, video, audio, text -- are performed by models, so a plugin adds
 * to them by shipping a provider: the action already exists and the executor only routes it to a
 * vendor. An action is the wider thing. Rendering a timeline is one: no model produces it, it has
 * no model cards, and nothing about it is chosen by picking a provider.
 *
 * `kind: "action"` has been in the manifest schema the whole time, and until now nothing could
 * implement it -- `defineExecutor` and `defineProjector` were the only two tags, so declaring an
 * action and writing code for it failed assembly with "declared action in the manifest but defined
 * as provider-executor in code". A kind that can be declared and cannot be implemented is a hole in
 * the plugin contract, and timeline being first-party is not a reason to leave it: whatever shape
 * it uses is the shape a third party copies.
 */
function manifestDir(functions: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "action-"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    apiVersion: "clash.plugin/v1",
    id: "test.render",
    version: "0.1.0",
    name: "test",
    runtime: { kind: "local", transport: "stdio", entrypoint: "dist/stdio.mjs", args: [] },
    contributes: { functions },
  }));
  return dir;
}

const invocation = (exportId: string) => ({
  protocol: "clash.plugin.invoke/v1" as const,
  invocationId: "i-1", taskId: "t-1", projectId: "p-1",
  target: {
    pluginId: "test.render", version: "0.1.0",
    schemaHash: `sha256:${"0".repeat(64)}`, exportId, kind: "action" as const,
  },
  input: { values: { fps: 30 }, references: [] },
  actor: { kind: "system" as const, id: "test" },
});

describe("defineAction", () => {
  it("assembles an action the manifest declares", async () => {
    const plugin = assemblePlugin({
      manifestDir: manifestDir([{ id: "render-timeline", kind: "action" }]),
      contributes: {
        "render-timeline": defineAction({
          run: async () => ({ status: "completed", media: {} }),
        }),
      },
    });
    expect(plugin).toBeDefined();
  });

  it("refuses an action tagged as an executor", async () => {
    // The mismatch the old hole produced, now reported from the other direction too.
    expect(() => assemblePlugin({
      manifestDir: manifestDir([{ id: "render-timeline", kind: "action" }]),
      contributes: {
        "render-timeline": defineAction({ run: async () => ({ status: "completed", media: {} }) }),
      },
    })).not.toThrow();

    expect(() => assemblePlugin({
      manifestDir: manifestDir([{ id: "render-timeline", kind: "provider-executor" }]),
      contributes: {
        "render-timeline": defineAction({ run: async () => ({ status: "completed", media: {} }) }),
      },
    })).toThrow(/declared provider-executor in the manifest but defined as action/);
  });

  it("returns media declaratively, the way an executor does", async () => {
    // One idiom, not two. An action that had to build outputs and call asset.write itself would be
    // the imperative shape the executors were moved off, reintroduced for the newer of the two.
    const plugin = assemblePlugin({
      manifestDir: manifestDir([{ id: "render-timeline", kind: "action" }]),
      contributes: {
        "render-timeline": defineAction({
          run: async () => ({
            status: "completed" as const,
            media: { render: { base64: Buffer.from("MP4").toString("base64"), mediaType: "video/mp4" } },
          }),
        }),
      },
      context: { upload: async () => ({ assetId: "a-1", uri: "clash-asset://a-1" }) } as never,
    });
    const result = await plugin.invoke(invocation("render-timeline") as never);
    expect(result.status).toBe("completed");
  });

  it("hands the action its declared parameter values", async () => {
    // A custom action is configured the way everything else is: the plugin declares parameters and
    // the GUI renders them, rather than the code reading fields nobody declared.
    let seen: unknown;
    const plugin = assemblePlugin({
      manifestDir: manifestDir([{ id: "render-timeline", kind: "action" }]),
      contributes: {
        "render-timeline": defineAction({
          run: async (inv) => {
            seen = inv.input.values;
            return { status: "completed", media: {} };
          },
        }),
      },
    });
    await plugin.invoke(invocation("render-timeline") as never);
    expect(seen).toEqual({ fps: 30 });
  });
});
