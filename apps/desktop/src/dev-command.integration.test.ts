import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("make dev-desktop", () => {
  it("routes the root command to Desktop HMR instead of the standalone web stack", () => {
    const result = spawnSync(
      "make",
      ["-n", "--no-print-directory", "dev-desktop"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: process.env,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("pnpm --filter @clash/desktop dev");
    expect(result.stdout).not.toContain("pnpm dev:package @clash/web");
  });
});
