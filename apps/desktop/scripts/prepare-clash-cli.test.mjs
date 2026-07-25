import { describe, expect, it } from "vitest";
import { resolvePnpmInvocation } from "./prepare-clash-cli.mjs";

describe("prepare packaged Clash CLI", () => {
  it("reuses the active pnpm JavaScript entrypoint when available", () => {
    expect(resolvePnpmInvocation({
      env: { npm_execpath: String.raw`D:\pnpm\pnpm.cjs` },
      platform: "win32",
      execPath: String.raw`C:\Program Files\nodejs\node.exe`,
    })).toEqual({
      command: String.raw`C:\Program Files\nodejs\node.exe`,
      argsPrefix: [String.raw`D:\pnpm\pnpm.cjs`],
    });
  });

  it("falls back to the Windows command interpreter for pnpm shims", () => {
    expect(resolvePnpmInvocation({
      env: { ComSpec: String.raw`C:\Windows\System32\cmd.exe` },
      platform: "win32",
      execPath: "node",
    })).toEqual({
      command: String.raw`C:\Windows\System32\cmd.exe`,
      argsPrefix: ["/d", "/s", "/c", "pnpm"],
    });
  });
});
