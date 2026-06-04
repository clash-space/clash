import { describe, expect, it } from "vitest";
import { resolveDesktopRuntime } from "./runtime";

describe("desktop runtime", () => {
  it("derives local API and WebSocket endpoints from the API port", () => {
    expect(resolveDesktopRuntime({ apiPort: 49321 })).toEqual({
      mode: "desktop",
      apiBaseUrl: "http://127.0.0.1:49321",
      wsBaseUrl: "ws://127.0.0.1:49321",
      webUrl: "clash://app/",
      capabilities: {
        assets: { storage: "local", signing: "unsigned", upload: "local" },
        workflows: { runner: "local-node", mediaPostprocess: "disabled" },
        loro: { persistence: "local", sync: "local-websocket" },
        auth: { mode: "local-user" },
      },
    });
  });

  it("allows environment overrides for desktop development", () => {
    expect(resolveDesktopRuntime({
      apiPort: 49321,
      apiBaseUrl: "http://localhost:8788",
      wsBaseUrl: "ws://localhost:8788",
      webUrl: "http://localhost:3001",
    })).toEqual({
      mode: "desktop",
      apiBaseUrl: "http://localhost:8788",
      wsBaseUrl: "ws://localhost:8788",
      webUrl: "http://localhost:3001",
      capabilities: {
        assets: { storage: "local", signing: "unsigned", upload: "local" },
        workflows: { runner: "local-node", mediaPostprocess: "disabled" },
        loro: { persistence: "local", sync: "local-websocket" },
        auth: { mode: "local-user" },
      },
    });
  });
});
