import { describe, expect, it } from "vitest";
import {
  resolveDesktopHostStartupTimeoutMs,
  resolveDesktopRuntime,
  useDesktopSourceHostWatch,
} from "./runtime";
import * as desktopRuntime from "./runtime";

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

  it("keeps daemon startup tuning opt-in and validates the E2E override", () => {
    expect(resolveDesktopHostStartupTimeoutMs({})).toBeUndefined();
    expect(
      resolveDesktopHostStartupTimeoutMs({
        CLASH_DESKTOP_HOST_STARTUP_TIMEOUT_MS: "60000",
      }),
    ).toBe(60_000);
    expect(() =>
      resolveDesktopHostStartupTimeoutMs({
        CLASH_DESKTOP_HOST_STARTUP_TIMEOUT_MS: "eventually",
      }),
    ).toThrow(/startup timeout/iu);
  });

  it("allows an isolated smoke run to disable the source-host watch wrapper", () => {
    expect(useDesktopSourceHostWatch({})).toBe(true);
    expect(useDesktopSourceHostWatch({ CLASH_DESKTOP_SOURCE_HOST_WATCH: "0" })).toBe(false);
  });

  it("validates the opt-in detached Host stdio instrumentation", () => {
    const resolveDesktopHostStdio = (
      desktopRuntime as unknown as {
        resolveDesktopHostStdio?: (
          env: Record<string, string | undefined>,
        ) => "ignore" | "inherit" | undefined;
      }
    ).resolveDesktopHostStdio;

    expect(typeof resolveDesktopHostStdio).toBe("function");
    expect(resolveDesktopHostStdio?.({})).toBeUndefined();
    expect(
      resolveDesktopHostStdio?.({ CLASH_DESKTOP_HOST_STDIO: "inherit" }),
    ).toBe("inherit");
    expect(
      resolveDesktopHostStdio?.({ CLASH_DESKTOP_HOST_STDIO: "ignore" }),
    ).toBe("ignore");
    expect(() =>
      resolveDesktopHostStdio?.({ CLASH_DESKTOP_HOST_STDIO: "pipe" }),
    ).toThrow(/Host stdio/iu);
  });
});
