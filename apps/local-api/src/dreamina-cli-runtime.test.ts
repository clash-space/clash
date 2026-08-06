import { spawn } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  DREAMINA_CLI_VERSION,
  dreaminaCliBinaryPath,
  createManagedDreaminaCliRun,
  createDatabaseDreaminaCliAuthSandbox,
  ensureDreaminaCliRuntime,
} from "./dreamina-cli-runtime";
import { DreaminaCliCommandError, type DreaminaCliRun } from "./dreamina-cli";

describe("managed Dreamina CLI runtime", () => {
  it("uses a stable Clash-owned absolute install path", () => {
    expect(dreaminaCliBinaryPath("/var/lib/clash/local-api", {
      platform: "darwin",
      arch: "arm64",
    })).toBe(`/var/lib/clash/local-api/tools/dreamina/${DREAMINA_CLI_VERSION}/dreamina`);
  });

  it("downloads the pinned Clash-hosted artifact, verifies sha256, and installs executable bytes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-dreamina-runtime-"));
    const bytes = new TextEncoder().encode("verified-dreamina-cli");
    const fetchImpl = vi.fn(async () => new Response(bytes));

    const result = await ensureDreaminaCliRuntime({
      dataDir,
      platform: "darwin",
      arch: "arm64",
      fetch: fetchImpl as typeof fetch,
      artifact: {
        url: "https://github.com/clash-space/clash/releases/download/dreamina-cli-v-test/dreamina_cli_darwin_arm64",
        sha256: "9be7b764af9a22c681de3ee3e247182ec1431a3deba0982ae3ee4fa6f2bfd149",
      },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://github.com/clash-space/clash/releases/download/dreamina-cli-v-test/dreamina_cli_darwin_arm64",
    );
    expect(result.binary).toBe(dreaminaCliBinaryPath(dataDir, { platform: "darwin", arch: "arm64" }));
    expect(await readFile(result.binary)).toEqual(Buffer.from(bytes));
    expect((await stat(result.binary)).mode & 0o111).not.toBe(0);
  });

  it("rejects bytes that do not match the pinned checksum", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-dreamina-runtime-bad-hash-"));
    await expect(ensureDreaminaCliRuntime({
      dataDir,
      platform: "darwin",
      arch: "arm64",
      fetch: async () => new Response("tampered") as never,
      artifact: {
        url: "https://downloads.clash.space/dreamina/test",
        sha256: "0".repeat(64),
      },
    })).rejects.toThrow("checksum");
  });

  it("lazily runs every stdio command through the managed binary with database-backed global auth", async () => {
    const run: DreaminaCliRun = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const createRun = vi.fn(() => run);
    const authSandbox = {
      run: vi.fn(async ({ run: rawRun, args, options, authState }: {
        run: typeof run;
        args: string[];
        options: Record<string, unknown> | undefined;
        authState: string | undefined;
      }) => rawRun(args, { ...options, authState } as never)),
    };
    const ensure = vi.fn(async () => ({
      binary: "/var/lib/clash/local-api/tools/dreamina/1.4.15/dreamina",
      version: "1.4.15",
      installed: false,
    }));
    const managedRun = createManagedDreaminaCliRun({
      dataDir: "/var/lib/clash/local-api",
      ensure,
      createRun,
      loadAuthState: async () => "encrypted-db-oauth-envelope",
      authSandbox,
    });

    await managedRun(["login", "--headless"], { env: { LANG: "zh_CN.UTF-8" } });
    await managedRun(["user_credit"]);

    expect(ensure).toHaveBeenCalledTimes(1);
    expect(createRun).toHaveBeenCalledWith("/var/lib/clash/local-api/tools/dreamina/1.4.15/dreamina");
    expect(authSandbox.run).toHaveBeenNthCalledWith(1, expect.objectContaining({
      args: ["login", "--headless"],
      authState: "encrypted-db-oauth-envelope",
    }));
    expect(authSandbox.run).toHaveBeenNthCalledWith(2, expect.objectContaining({
      args: ["user_credit"],
      authState: "encrypted-db-oauth-envelope",
    }));
  });

  it.runIf(process.platform === "darwin")("round-trips CLI auth through Clash SQLite envelopes without touching Keychain", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-dreamina-db-auth-"));
    const sandbox = createDatabaseDreaminaCliAuthSandbox({ dataDir });
    let observedHome = "";
    const setRun = vi.fn(async (_args: string[], options?: { env?: Record<string, string | undefined> }) => {
      observedHome = options?.env?.HOME ?? "";
      await new Promise<void>((resolve, reject) => {
        const child = spawn(options?.env?.CLASH_DREAMINA_SECURITY_EXECUTABLE ?? "", ["-i"], {
          env: { ...process.env, ...(options?.env ?? {}) },
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stderr = "";
        child.stderr.on("data", (chunk) => { stderr += String(chunk); });
        child.once("error", reject);
        child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
        child.stdin.end("add-generic-password -U -s 'dreamina-test' -a 'oauth' -w 'go-keyring-base64:c2VjcmV0'\n");
      });
      return { stdout: "stored", stderr: "" };
    });
    const captured = await sandbox.run({
      run: setRun,
      args: ["login", "checklogin"],
      options: { captureAuthState: true },
      authState: undefined,
    });
    expect(captured.authState).toContain('"service":"dreamina-test"');
    await expect(stat(observedHome)).rejects.toThrow();

    const getRun = vi.fn(async (_args: string[], options?: { env?: Record<string, string | undefined> }) => {
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn(options?.env?.CLASH_DREAMINA_SECURITY_EXECUTABLE ?? "", [
          "find-generic-password", "-s", "dreamina-test", "-wa", "oauth",
        ], {
          env: { ...process.env, ...(options?.env ?? {}) },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { output += String(chunk); });
        child.stderr.on("data", (chunk) => { stderr += String(chunk); });
        child.once("error", reject);
        child.once("exit", (code) => code === 0 ? resolve(output) : reject(new Error(stderr)));
      });
      return { stdout, stderr: "" };
    });
    const restored = await sandbox.run({
      run: getRun,
      args: ["validate-auth-token"],
      options: {},
      authState: captured.authState,
    });
    expect(restored.stdout.trim()).toBe("go-keyring-base64:c2VjcmV0");
  }, 20_000);

  it.runIf(process.platform === "darwin")("captures OAuth written before a non-zero CLI entitlement exit", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "clash-dreamina-db-auth-error-"));
    const sandbox = createDatabaseDreaminaCliAuthSandbox({ dataDir });
    const failingRun = async (_args: string[], options?: { env?: Record<string, string | undefined> }) => {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(options?.env?.CLASH_DREAMINA_SECURITY_EXECUTABLE ?? "", ["-i"], {
          env: { ...process.env, ...(options?.env ?? {}) },
          stdio: ["pipe", "ignore", "pipe"],
        });
        child.once("error", reject);
        child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`shim exit ${code}`)));
        child.stdin.end("add-generic-password -U -s 'dreamina-test' -a 'oauth' -w 'token'\n");
      });
      throw new DreaminaCliCommandError("membership required", { stdout: "", stderr: "membership required" });
    };

    const error = await sandbox.run({
      run: failingRun,
      args: ["login", "checklogin"],
      options: { captureAuthState: true },
    }).catch((reason) => reason);
    expect(error).toBeInstanceOf(DreaminaCliCommandError);
    expect(error.result.authState).toContain('"account":"oauth"');
  }, 20_000);
});
