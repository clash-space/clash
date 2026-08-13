import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(e2eDir, "..");
const repoRoot = path.resolve(webDir, "..", "..");
const dataDir =
  process.env.CLASH_WEB_ASSET_E2E_DATA_DIR ??
  path.join(
    repoRoot,
    ".tmp",
    "web-asset-persistence-e2e",
    "clash-home",
    "local-api",
  );
const chromeDataDir =
  process.env.CLASH_WEB_ASSET_E2E_CHROME_DATA_DIR ??
  path.join(repoRoot, ".tmp", "web-asset-persistence-e2e", "chrome");

function assert(
  condition: unknown,
  message: string,
  details?: unknown,
): asserts condition {
  if (!condition) {
    throw new Error(
      `${message}${details === undefined ? "" : `: ${JSON.stringify(details)}`}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port += 1) {
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
    });
    if (available) return port;
  }
  throw new Error(`No free port found from ${start}`);
}

async function waitForHttp(
  url: string,
  label: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw new Error(
    `Timed out waiting for ${label} at ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function chromeBinary(): string {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter((candidate): candidate is string => Boolean(candidate));
  const binary = candidates.find((candidate) => existsSync(candidate));
  if (!binary) {
    throw new Error(
      "No Chrome-compatible browser found. Set CHROME_BIN to run the Asset product E2E.",
    );
  }
  return binary;
}

function viteCli(): string {
  const candidates = [
    path.join(webDir, "node_modules", "vite", "bin", "vite.js"),
    path.join(repoRoot, "node_modules", "vite", "bin", "vite.js"),
  ];
  const cli = candidates.find((candidate) => existsSync(candidate));
  if (!cli)
    throw new Error("Vite CLI not found. Run dependency install first.");
  return cli;
}

function tail(lines: string[], max = 100): string {
  return lines.slice(Math.max(0, lines.length - max)).join("");
}

async function stopProcess(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.once("exit", () => resolve(true))),
    sleep(3_000).then(() => false),
  ]);
  if (!exited) child.kill("SIGKILL");
}

type PendingCdpCall = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
};

class CdpClient {
  readonly #socket: WebSocket;
  readonly #pending = new Map<number, PendingCdpCall>();
  #id = 0;

  constructor(url: string) {
    this.#socket = new WebSocket(url);
    this.#socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        error?: unknown;
        result?: Record<string, unknown>;
      };
      if (!message.id) return;
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result ?? {});
      }
    });
  }

  async ready(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#socket.addEventListener("open", () => resolve(), { once: true });
      this.#socket.addEventListener(
        "error",
        () => reject(new Error("CDP socket failed")),
        {
          once: true,
        },
      );
    });
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const id = ++this.#id;
    this.#socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
  }

  close(): void {
    this.#socket.close();
  }
}

async function waitForTarget(cdpPort: number): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
      if (response.ok) {
        const targets = (await response.json()) as Array<{
          type?: string;
          webSocketDebuggerUrl?: string;
        }>;
        const page = targets.find(
          (target) => target.type === "page" && target.webSocketDebuggerUrl,
        );
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch {
      // Chrome is still booting.
    }
    await sleep(200);
  }
  throw new Error("Timed out waiting for Chrome CDP target");
}

async function evaluate<T>(cdp: CdpClient, expression: string): Promise<T> {
  const response = (await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })) as {
    exceptionDetails?: { text?: string };
    result?: { value?: T };
  };
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.text ?? "Runtime evaluation failed",
    );
  }
  return response.result?.value as T;
}

async function waitFor<T>(
  cdp: CdpClient,
  expression: string,
  label: string,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastValue: T | undefined;
  while (Date.now() < deadline) {
    lastValue = await evaluate<T>(cdp, expression);
    if (lastValue) return lastValue;
    await sleep(200);
  }
  throw new Error(
    `Timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}`,
  );
}

function buttonByAriaLabel(label: string): string {
  return `([...document.querySelectorAll("button")].find((button) => {
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return button.getAttribute("aria-label") === ${JSON.stringify(label)} &&
      !button.disabled && rect.width > 0 && rect.height > 0 &&
      style.display !== "none" && style.visibility !== "hidden";
  }))`;
}

async function clickButton(cdp: CdpClient, label: string): Promise<void> {
  await waitFor(
    cdp,
    `(() => {
      const button = ${buttonByAriaLabel(label)};
      if (!button) return false;
      button.scrollIntoView({ block: "center", inline: "center" });
      button.click();
      return true;
    })()`,
    `button ${label}`,
  );
}

async function openAssetsPage(
  cdp: CdpClient,
  webOrigin: string,
  cacheBust: string,
): Promise<void> {
  await cdp.send("Page.navigate", {
    url: `${webOrigin}/assets?e2e=${encodeURIComponent(cacheBust)}`,
  });
  await waitFor(
    cdp,
    `(() => {
      const input = document.querySelector('input[aria-label="Upload global assets"]');
      return location.pathname === "/assets" && document.body.innerText.includes("Assets") && !!input;
    })()`,
    "Global Assets product page",
    20_000,
  );
}

async function uploadThroughUi(
  cdp: CdpClient,
  fileName: string,
): Promise<void> {
  const dispatched = await evaluate<boolean>(
    cdp,
    `(() => {
      const input = document.querySelector('input[aria-label="Upload global assets"]');
      if (!(input instanceof HTMLInputElement)) return false;
      const transfer = new DataTransfer();
      transfer.items.add(new File(
        [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
        ${JSON.stringify(fileName)},
        { type: "image/png" },
      ));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`,
  );
  assert(dispatched, "Browser found the Global Asset upload input");
  await waitFor(
    cdp,
    `(() => document.body.innerText.includes(${JSON.stringify(fileName)}) && !!${buttonByAriaLabel(`Move ${fileName} to Trash`)})()`,
    "uploaded Global Asset in the active library",
    20_000,
  );
}

function startSourceLocalApi(options: {
  apiPort: number;
  logs: string[];
}): ChildProcess {
  const entry = path.join(repoRoot, "apps", "local-api", "src", "server.ts");
  if (!existsSync(entry)) {
    throw new Error(`Source local-api entry not found: ${entry}`);
  }
  const tsxLoader = createRequire(import.meta.url).resolve("tsx");
  const child = spawn(process.execPath, ["--import", tsxLoader, entry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(options.apiPort),
      CLASH_HOME: path.dirname(dataDir),
      CLASH_LOCAL_DATA_DIR: dataDir,
      CLASH_PROFILE: "prod",
      TSX_TSCONFIG_PATH: path.join(
        repoRoot,
        "apps",
        "local-api",
        "tsconfig.dev.json",
      ),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => options.logs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => options.logs.push(String(chunk)));
  return child;
}

async function main(): Promise<void> {
  await rm(dataDir, { recursive: true, force: true });
  await rm(chromeDataDir, { recursive: true, force: true });

  const apiPort = await findFreePort(49800);
  const webPort = await findFreePort(49900);
  const cdpPort = await findFreePort(50000);
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const webOrigin = `http://127.0.0.1:${webPort}`;
  const fileName = "restart-proof-global-asset.png";

  let apiDaemon: ChildProcess | undefined;
  let web: ChildProcess | undefined;
  let chrome: ChildProcess | undefined;
  let cdp: CdpClient | undefined;
  const apiLogs: string[] = [];
  const webLogs: string[] = [];
  const chromeLogs: string[] = [];

  try {
    apiDaemon = startSourceLocalApi({ apiPort, logs: apiLogs });
    await waitForHttp(`${apiOrigin}/health`, "local-api Host");

    web = spawn(
      process.execPath,
      [viteCli(), "--host", "127.0.0.1", "--port", String(webPort)],
      {
        cwd: webDir,
        env: {
          ...process.env,
          VITE_CLASH_API_BASE_URL: apiOrigin,
          VITE_CLASH_WS_BASE_URL: apiOrigin.replace("http:", "ws:"),
          CLASH_WEB_E2E_NO_CLOUDFLARE: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    web.stdout?.on("data", (chunk) => webLogs.push(String(chunk)));
    web.stderr?.on("data", (chunk) => webLogs.push(String(chunk)));
    await waitForHttp(webOrigin, "Vite web server");

    chrome = spawn(
      chromeBinary(),
      [
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${chromeDataDir}`,
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-renderer-backgrounding",
        "--window-size=1440,1000",
        "about:blank",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    chrome.stdout?.on("data", (chunk) => chromeLogs.push(String(chunk)));
    chrome.stderr?.on("data", (chunk) => chromeLogs.push(String(chunk)));

    cdp = new CdpClient(await waitForTarget(cdpPort));
    await cdp.ready();
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");

    await openAssetsPage(cdp, webOrigin, "before-upload");
    const runtimeApiOrigin = await evaluate<string | undefined>(
      cdp,
      `window.__CLASH_RUNTIME_CONFIG__?.apiBaseUrl`,
    );
    assert(
      runtimeApiOrigin === apiOrigin,
      "Browser Assets UI targets the isolated local-api Host",
      { expected: apiOrigin, actual: runtimeApiOrigin },
    );

    await uploadThroughUi(cdp, fileName);
    await clickButton(cdp, `Move ${fileName} to Trash`);
    await waitFor(
      cdp,
      `!!${buttonByAriaLabel(`Restore ${fileName}`)}`,
      "trashed Global Asset",
    );

    await stopProcess(apiDaemon);
    apiDaemon = undefined;
    await waitForHttp(webOrigin, "web while local-api is stopped");
    apiDaemon = startSourceLocalApi({ apiPort, logs: apiLogs });
    await waitForHttp(`${apiOrigin}/health`, "restarted local-api Host");

    await openAssetsPage(cdp, webOrigin, "after-daemon-restart");
    await waitFor(
      cdp,
      `(() => document.body.innerText.includes(${JSON.stringify(fileName)}) && !!${buttonByAriaLabel(`Restore ${fileName}`)})()`,
      "persisted trashed Global Asset after daemon restart",
      20_000,
    );

    await clickButton(cdp, `Restore ${fileName}`);
    await waitFor(
      cdp,
      `!!${buttonByAriaLabel(`Move ${fileName} to Trash`)}`,
      "restored Global Asset after daemon restart",
    );

    const result = await evaluate(
      cdp,
      `({
      href: location.href,
      assetVisible: document.body.innerText.includes(${JSON.stringify(fileName)}),
      restored: !!${buttonByAriaLabel(`Move ${fileName} to Trash`)},
      runtime: window.__CLASH_RUNTIME_CONFIG__ ?? null,
    })`,
    );
    assert(
      result && typeof result === "object",
      "Browser returned the post-restart Asset state",
      result,
    );
    console.log(`[asset-persistence-e2e] ${JSON.stringify(result)}`);
  } catch (error) {
    if (cdp) {
      const browserState = await evaluate(
        cdp,
        `({
        href: location.href,
        title: document.title,
        text: document.body?.innerText?.slice(0, 2000) ?? "",
      })`,
      ).catch((diagnosticError) => ({
        diagnosticError:
          diagnosticError instanceof Error
            ? diagnosticError.message
            : String(diagnosticError),
      }));
      console.error(
        `[asset-persistence-e2e] browser state\n${JSON.stringify(browserState, null, 2)}`,
      );
    }
    console.error(`[asset-persistence-e2e] local-api logs\n${tail(apiLogs)}`);
    console.error(`[asset-persistence-e2e] web logs\n${tail(webLogs)}`);
    console.error(`[asset-persistence-e2e] chrome logs\n${tail(chromeLogs)}`);
    throw error;
  } finally {
    cdp?.close();
    await stopProcess(chrome);
    await stopProcess(web);
    await stopProcess(apiDaemon);
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exitCode = 1;
});
