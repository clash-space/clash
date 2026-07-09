import { beforeEach, describe, expect, it } from "vitest";
import {
  getRuntimeConfig,
  getRuntimeCapabilities,
  runtimeApiUrl,
  runtimeAssetFallbackUrl,
  runtimeSyncWebSocketUrl,
  runtimeWebSocketUrl,
} from "./runtimeConfig";

describe("web-ui runtimeConfig", () => {
  beforeEach(() => {
    globalThis.__CLASH_RUNTIME_CONFIG__ = undefined;
  });

  it("defaults to hosted same-origin HTTP paths", () => {
    expect(getRuntimeConfig()).toMatchObject({ mode: "hosted", apiBaseUrl: "", wsBaseUrl: "" });
    expect(getRuntimeCapabilities().assets.storage).toBe("cloud");
    expect(runtimeApiUrl("/api/v1/projects")).toBe("/api/v1/projects");
    expect(runtimeAssetFallbackUrl("uploads/a.png")).toBe("/assets/uploads/a.png");
  });

  it("uses the injected local backend origin for HTTP paths", () => {
    globalThis.__CLASH_RUNTIME_CONFIG__ = {
      mode: "desktop",
      apiBaseUrl: "http://127.0.0.1:49152",
    };

    expect(runtimeApiUrl("/api/v1/projects")).toBe("http://127.0.0.1:49152/api/v1/projects");
    expect(runtimeApiUrl("/upload")).toBe("http://127.0.0.1:49152/upload");
    expect(getRuntimeCapabilities().assets.storage).toBe("local");
    expect(getRuntimeCapabilities().loro.persistence).toBe("local");
  });

  it("builds sync WebSocket URLs from either injected config or browser location", () => {
    expect(runtimeSyncWebSocketUrl("p1", { protocol: "https:", host: "app.example.test" })).toBe(
      "wss://app.example.test/sync/p1",
    );

    globalThis.__CLASH_RUNTIME_CONFIG__ = {
      apiBaseUrl: "http://127.0.0.1:49152",
      wsBaseUrl: "ws://127.0.0.1:49153",
    };

    expect(runtimeSyncWebSocketUrl("project/one", { protocol: "https:", host: "ignored.test" })).toBe(
      "ws://127.0.0.1:49153/sync/project%2Fone",
    );
    expect(runtimeWebSocketUrl("/api/v1/local-sessions/s1/_stream", { protocol: "https:", host: "ignored.test" })).toBe(
      "ws://127.0.0.1:49153/api/v1/local-sessions/s1/_stream",
    );
  });
});
