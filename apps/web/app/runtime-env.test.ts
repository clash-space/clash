import { beforeEach, describe, expect, it } from "vitest";
import { installViteRuntimeConfig } from "./runtime-env";

function runtimeGlobal() {
  return globalThis as typeof globalThis & {
    __CLASH_RUNTIME_CONFIG__?:
      | { mode?: string; apiBaseUrl?: string; wsBaseUrl?: string }
      | undefined;
  };
}

describe("installViteRuntimeConfig", () => {
  beforeEach(() => {
    runtimeGlobal().__CLASH_RUNTIME_CONFIG__ = undefined;
  });

  it("leaves hosted runtime untouched when no local API env is configured", () => {
    installViteRuntimeConfig({});

    expect(runtimeGlobal().__CLASH_RUNTIME_CONFIG__).toBeUndefined();
  });

  it("installs desktop runtime endpoints from Vite env", () => {
    installViteRuntimeConfig({
      VITE_CLASH_API_BASE_URL: "http://127.0.0.1:49321/",
      VITE_CLASH_WS_BASE_URL: "ws://127.0.0.1:49321/",
    });

    expect(runtimeGlobal().__CLASH_RUNTIME_CONFIG__).toEqual({
      mode: "desktop",
      apiBaseUrl: "http://127.0.0.1:49321",
      wsBaseUrl: "ws://127.0.0.1:49321",
    });
  });
});
