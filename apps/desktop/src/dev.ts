import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createServer } from "node:net";

const require = createRequire(import.meta.url);
const rendererPort = Number.parseInt(process.env.CLASH_DESKTOP_RENDERER_PORT ?? "3001", 10);
const rendererUrl = `http://127.0.0.1:${rendererPort}`;
const managedChildren = new Set<ChildProcess>();
let stopping = false;

function resolvePnpmCli(): string {
  const pnpmCli = process.env.npm_execpath;
  if (pnpmCli) return pnpmCli;
  throw new Error(
    "Desktop dev must be started through pnpm so child processes inherit the selected Node runtime. Run: pnpm --filter @master-clash/desktop dev",
  );
}

function assertRendererNodeCapabilities(): void {
  const nodeModule = require("node:module") as { registerHooks?: unknown };
  if (typeof nodeModule.registerHooks === "function") return;
  throw new Error(
    `Node ${process.version} cannot run the renderer toolchain. From the repository root, run: nvm install && nvm use`,
  );
}

function spawnManaged(args: string[], env: NodeJS.ProcessEnv = process.env): ChildProcess {
  const child = spawn(process.execPath, [resolvePnpmCli(), ...args], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  managedChildren.add(child);
  child.once("exit", () => managedChildren.delete(child));
  return child;
}

async function waitForChild(child: ChildProcess, label: string): Promise<number> {
  const [code, signal] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
  if (signal) throw new Error(`${label} exited from ${signal}`);
  return code ?? 1;
}

async function runCommand(args: string[], label: string): Promise<void> {
  const child = spawnManaged(args);
  const code = await waitForChild(child, label);
  if (code !== 0) throw new Error(`${label} exited with code ${code}`);
}

async function waitForHttp(url: string, child: ChildProcess, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Renderer exited before ${url} became ready`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The renderer is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for renderer at ${url}`);
}

async function assertPortAvailable(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", () => {
      reject(
        new Error(
          `Renderer port ${port} is already in use. Stop the existing Desktop dev instance or set CLASH_DESKTOP_RENDERER_PORT.`,
        ),
      );
    });
    probe.listen(port, "127.0.0.1", () => {
      probe.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

async function shutdownProcessTree(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }

  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      if (process.platform === "win32") child.kill("SIGKILL");
      else process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

async function shutdown(signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
  if (stopping) return;
  stopping = true;
  await Promise.allSettled([...managedChildren].reverse().map((child) => shutdownProcessTree(child, signal)));
}

function installSignalHandler(signal: NodeJS.Signals): void {
  process.once(signal, () => {
    void shutdown(signal).finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  });
}

async function main(): Promise<void> {
  assertRendererNodeCapabilities();
  if (!Number.isInteger(rendererPort) || rendererPort < 1 || rendererPort > 65_535) {
    throw new Error(`Invalid CLASH_DESKTOP_RENDERER_PORT: ${process.env.CLASH_DESKTOP_RENDERER_PORT}`);
  }

  installSignalHandler("SIGINT");
  installSignalHandler("SIGTERM");

  await runCommand(["--filter", "@master-clash/local-api", "build"], "Local API build");
  await runCommand(["run", "build"], "Desktop build");
  await assertPortAvailable(rendererPort);

  const renderer = spawnManaged([
    "--filter",
    "@master-clash/web",
    "exec",
    "vite",
    "--host",
    "127.0.0.1",
    "--port",
    String(rendererPort),
    "--strictPort",
  ]);
  await waitForHttp(rendererUrl, renderer);

  const electron = spawnManaged(["exec", "electron", "."], {
    ...process.env,
    CLASH_WEB_URL: rendererUrl,
  });

  const firstExit = await Promise.race([
    waitForChild(electron, "Electron").then((code) => ({ process: "electron", code })),
    waitForChild(renderer, "Renderer").then((code) => ({ process: "renderer", code })),
  ]);
  if (firstExit.process === "renderer" && !stopping) {
    throw new Error(`Renderer exited while Electron was running (code ${firstExit.code})`);
  }
  process.exitCode = firstExit.code;
}

main()
  .catch((error) => {
    console.error("[desktop-dev]", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => shutdown());
