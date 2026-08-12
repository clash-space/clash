import { describe, expect, it } from "vitest";

import {
  defaultDaemonNodeCandidates,
  resolveDaemonNodeRuntime,
} from "./local-daemon-runtime";

/**
 * The daemon owns a long-lived local host: SQLite stores, plugin runtime, HTTP
 * surface. Which Node executes it must not depend on who happened to start it.
 *
 * Inheriting `process.execPath` coupled the daemon to three unrelated things:
 * the Electron shell's bundled Node when the GUI started it, whichever nvm
 * version was active in a shell when the CLI started it, and the CI image's
 * Node otherwise. Same code, three runtimes, and `node:sqlite` is not the same
 * feature across them.
 */

const SUPPORTED = ">=24.18.0 <25";

describe("daemon node runtime resolution", () => {
  it("never inherits an Electron binary, even when the GUI launches it", () => {
    const resolved = resolveDaemonNodeRuntime({
      execPath: "/Applications/Clash.app/Contents/MacOS/Clash",
      env: { ELECTRON_RUN_AS_NODE: "1" },
      supportedRange: SUPPORTED,
      candidates: ["/usr/local/bin/node"],
      probeVersion: () => "24.18.0",
    });
    expect(resolved.nodePath).toBe("/usr/local/bin/node");
    expect(resolved.inheritedFromLauncher).toBe(false);
    expect(resolved.reason).toMatch(/electron/i);
  });

  it("refuses a launcher runtime outside the supported range", () => {
    const resolved = resolveDaemonNodeRuntime({
      execPath: "/nvm/versions/node/v23.11.0/bin/node",
      env: {},
      supportedRange: SUPPORTED,
      candidates: ["/usr/local/bin/node"],
      probeVersion: (path) => (path.includes("v23") ? "23.11.0" : "24.18.0"),
    });
    expect(resolved.nodePath).toBe("/usr/local/bin/node");
    expect(resolved.inheritedFromLauncher).toBe(false);
  });

  it("keeps the launcher runtime when it is a plain supported node", () => {
    const resolved = resolveDaemonNodeRuntime({
      execPath: "/nvm/versions/node/v24.18.0/bin/node",
      env: {},
      supportedRange: SUPPORTED,
      candidates: [],
      probeVersion: () => "24.18.0",
    });
    expect(resolved.nodePath).toBe("/nvm/versions/node/v24.18.0/bin/node");
    expect(resolved.inheritedFromLauncher).toBe(true);
  });

  it("prefers an explicit override over every discovered candidate", () => {
    const resolved = resolveDaemonNodeRuntime({
      execPath: "/nvm/versions/node/v24.18.0/bin/node",
      env: { CLASH_DAEMON_NODE_PATH: "/opt/pinned/node" },
      supportedRange: SUPPORTED,
      candidates: ["/usr/local/bin/node"],
      probeVersion: () => "24.18.0",
    });
    expect(resolved.nodePath).toBe("/opt/pinned/node");
    expect(resolved.source).toBe("explicit");
  });

  it("fails loudly instead of starting the host on an unsupported runtime", () => {
    expect(() =>
      resolveDaemonNodeRuntime({
        execPath: "/nvm/versions/node/v23.11.0/bin/node",
        env: {},
        supportedRange: SUPPORTED,
        candidates: ["/usr/bin/node"],
        probeVersion: () => "23.11.0",
      }),
    ).toThrow(/No Node runtime satisfying >=24\.18\.0 <25/);
  });

  it("reports the resolved runtime so a host can be inspected, not guessed", () => {
    const resolved = resolveDaemonNodeRuntime({
      execPath: "/usr/local/bin/node",
      env: {},
      supportedRange: SUPPORTED,
      candidates: [],
      probeVersion: () => "24.18.0",
    });
    expect(resolved).toMatchObject({
      nodePath: "/usr/local/bin/node",
      version: "24.18.0",
      source: "launcher",
    });
  });
});

describe("supported range has an upper bound", () => {
  const BOUNDED = SUPPORTED;

  it("refuses a runtime newer than anything the stores were verified against", () => {
    // Discovery found Homebrew's Node 26 on a real machine. An unbounded range
    // silently adopted it for the host that owns every SQLite store.
    expect(() =>
      resolveDaemonNodeRuntime({
        execPath: "/Applications/Clash.app/Contents/MacOS/Clash",
        env: { ELECTRON_RUN_AS_NODE: "1" },
        supportedRange: BOUNDED,
        candidates: ["/opt/homebrew/bin/node"],
        probeVersion: () => "26.4.0",
      }),
    ).toThrow(/No Node runtime satisfying >=24\.18\.0 <25/);
  });

  it("picks the supported candidate over a newer unsupported one", () => {
    const resolved = resolveDaemonNodeRuntime({
      execPath: "/Applications/Clash.app/Contents/MacOS/Clash",
      env: { ELECTRON_RUN_AS_NODE: "1" },
      supportedRange: BOUNDED,
      candidates: ["/opt/homebrew/bin/node", "/usr/local/bin/node"],
      probeVersion: (path) => (path.includes("homebrew") ? "26.4.0" : "24.18.0"),
    });
    expect(resolved.nodePath).toBe("/usr/local/bin/node");
    expect(resolved.version).toBe("24.18.0");
  });

  it("still accepts the boundary version itself", () => {
    expect(
      resolveDaemonNodeRuntime({
        execPath: "/usr/local/bin/node",
        env: {},
        supportedRange: BOUNDED,
        candidates: [],
        probeVersion: () => "24.99.9",
      }).inheritedFromLauncher,
    ).toBe(true);
  });
});

describe("candidate discovery", () => {
  it("offers concrete nvm version paths but never the mutable current symlink", () => {
    const candidates = defaultDaemonNodeCandidates(
      { HOME: "/Users/dev" },
      {
        listNvmVersions: () => ["v24.18.0", "v23.11.0", "v20.11.0"],
      },
    );
    // A concrete version directory is immutable, so pinning it is safe.
    expect(candidates).toContain("/Users/dev/.nvm/versions/node/v24.18.0/bin/node");
    expect(candidates).toContain("/Users/dev/.nvm/versions/node/v23.11.0/bin/node");
    // `current`/`default` move when a shell switches versions, which would
    // reintroduce the coupling this module removes.
    expect(candidates.some((path) => /current|default|alias/u.test(path))).toBe(false);
  });

  it("prefers newer installed versions so a pin is not stuck on the oldest", () => {
    const candidates = defaultDaemonNodeCandidates(
      { HOME: "/Users/dev" },
      { listNvmVersions: () => ["v23.11.0", "v24.18.0"] },
    );
    const nvm = candidates.filter((path) => path.includes("/.nvm/"));
    expect(nvm[0]).toContain("v24.18.0");
  });
});
