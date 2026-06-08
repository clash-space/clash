import { describe, expect, it } from "vitest";
import { resolveMacGuiPath } from "./shell-path";

describe("macOS GUI shell PATH", () => {
  it("merges login shell PATH and common user binary paths ahead of the Finder default PATH", () => {
    const path = resolveMacGuiPath({
      env: {
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        SHELL: "/bin/zsh",
      },
      homeDir: "/Users/tester",
      platform: "darwin",
      readLoginShellPath: () => "/opt/homebrew/bin:/Users/tester/.npm-global/bin:/usr/bin:/bin",
    });

    const segments = path.split(":");
    expect(segments.slice(0, 2)).toEqual(["/opt/homebrew/bin", "/Users/tester/.npm-global/bin"]);
    expect(segments).toContain("/usr/local/bin");
    expect(segments).toContain("/Users/tester/.local/bin");
    expect(segments).toContain("/usr/bin");
    expect(new Set(segments).size).toBe(segments.length);
  });

  it("leaves non-macOS PATH unchanged", () => {
    expect(resolveMacGuiPath({
      env: { PATH: "/custom/bin:/usr/bin" },
      homeDir: "/Users/tester",
      platform: "linux",
      readLoginShellPath: () => "/ignored/bin",
    })).toBe("/custom/bin:/usr/bin");
  });
});
