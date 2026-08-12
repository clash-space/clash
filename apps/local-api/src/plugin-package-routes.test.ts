import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createLocalApiApp } from "./app.js";

describe("local plugin package routes", () => {
  it("keeps package lifecycle behind the daemon protocol", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-plugin-routes-"));
    const pluginPackages = {
      list: vi.fn(async () => [{ id: "test.plugin", drifted: false }]),
      validate: vi.fn(async (input: unknown) => ({ valid: true, input })),
      activate: vi.fn(async (input: unknown) => ({ activated: true, input })),
      read: vi.fn(async (id: string) => ({ id, version: "1.0.0", files: {} })),
      rollback: vi.fn(async (id: string) => ({ id, version: "0.9.0" })),
      remove: vi.fn(async (id: string) => ({ id, removed: true })),
    };
    const app = createLocalApiApp({ dataDir, pluginPackages });
    const pkg = { id: "test.plugin", manifest: {}, files: {} };

    expect(await (await app.request("/api/v1/local/plugins")).json()).toEqual([
      { id: "test.plugin", drifted: false },
    ]);
    expect(await (await app.request("/api/v1/local/plugins/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pkg),
    })).json()).toEqual({ valid: true, input: pkg });
    expect(await (await app.request("/api/v1/local/plugins/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pkg),
    })).json()).toEqual({ activated: true, input: pkg });
    expect(await (await app.request(
      "/api/v1/local/plugins/test.plugin/package",
    )).json()).toMatchObject({ id: "test.plugin", version: "1.0.0" });
    expect(await (await app.request(
      "/api/v1/local/plugins/test.plugin/rollback",
      { method: "POST" },
    )).json()).toEqual({ id: "test.plugin", version: "0.9.0" });
    expect(await (await app.request(
      "/api/v1/local/plugins/test.plugin",
      { method: "DELETE" },
    )).json()).toEqual({ id: "test.plugin", removed: true });

    expect(pluginPackages.validate).toHaveBeenCalledWith(pkg);
    expect(pluginPackages.activate).toHaveBeenCalledWith(pkg);
    expect(pluginPackages.read).toHaveBeenCalledWith("test.plugin");
    expect(pluginPackages.rollback).toHaveBeenCalledWith("test.plugin");
    expect(pluginPackages.remove).toHaveBeenCalledWith("test.plugin");
  });

  it("does not expose mutation routes without a host-owned manager", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-plugin-routes-missing-"));
    const app = createLocalApiApp({ dataDir });
    const response = await app.request("/api/v1/local/plugins/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(503);
  });
});
