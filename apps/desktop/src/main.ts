import { mkdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, protocol } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import {
  defaultLocalApiDataDir,
  startLocalApiServer,
} from "@master-clash/local-api";
import { createLocalDaemonBootstrap } from "@clash/shared-runtime/local-daemon";
import {
  clashHomeForLocalDataDir,
  resolveClashProfile,
} from "@clash/shared-runtime/local-paths";
import {
  DEFAULT_DESKTOP_API_PORT,
  isAddressInUse,
  resolveAvailableDesktopApiPort,
} from "./api-port";
import {
  prependPythonPath,
  resolveAcpBinDir,
  resolveAgentBundleRoot,
  resolveClashCliEntryPath,
  resolveClashCliNodePath,
  resolveDesktopStatePaths,
  resolveClashSdkPythonPath,
  resolveWebDistDir,
} from "./paths";
import { resolveDesktopRuntime, type DesktopRuntime } from "./runtime";
import { hydrateMacGuiPath } from "./shell-path";
import {
  createWindowRegistry,
  ensureNativeWindowControlsVisible,
  resolveDesktopWindowOptions,
  shouldCreateWindowOnActivate,
} from "./windowing";
import { createDesktopLogger } from "./stdio-logger";
import {
  detectNleAvailability,
  materializeNleHandoff,
  openNleDocument,
  type DesktopNleHandoffRequest,
} from "./nle-handoff";
import {
  createDesktopTimelineRenderer,
} from "./timeline-export";
import {
  directorVideoBytes,
  safeDirectorVideoExportName,
  type DesktopDirectorVideoExportRequest,
} from "./director-video-export";

const __dirname = dirname(fileURLToPath(import.meta.url));
const remoteDebuggingPort = process.env.CLASH_DESKTOP_REMOTE_DEBUGGING_PORT;
if (remoteDebuggingPort) {
  app.commandLine.appendSwitch("remote-debugging-port", remoteDebuggingPort);
}
hydrateMacGuiPath();
const runtimeAppName = process.env.CLASH_APP_NAME?.trim();
if (runtimeAppName) app.setName(runtimeAppName);

protocol.registerSchemesAsPrivileged([
  {
    scheme: "clash",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

const windowRegistry = createWindowRegistry<BrowserWindow>();
let captureCount = 0;
let runtime: DesktopRuntime | null = null;
let localApiServer: Awaited<ReturnType<typeof startLocalApiServer>> | null = null;
let shutdownBarrierStarted = false;
const desktopLog = createDesktopLogger();

function currentRuntime(): DesktopRuntime {
  if (!runtime) throw new Error("Desktop runtime is not initialized");
  return runtime;
}

async function captureRenderer(label: string, window: BrowserWindow): Promise<void> {
  const captureDir = process.env.CLASH_DESKTOP_CAPTURE_DIR;
  if (!captureDir || window.isDestroyed()) return;

  try {
    await mkdir(captureDir, { recursive: true });
    const image = await window.webContents.capturePage();
    const safeLabel = label.replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    const file = join(captureDir, `${String(++captureCount).padStart(3, "0")}-${safeLabel}.png`);
    await writeFile(file, image.toPNG());
    desktopLog.info(`[desktop:${label}] capture ${file}`);
  } catch (err) {
    if (window.isDestroyed() || String(err).includes("Object has been destroyed")) return;
    desktopLog.error(`[desktop:${label}] capture failed`, err);
  }
}

async function logRendererState(label: string, window: BrowserWindow): Promise<void> {
  try {
    const state = await window.webContents.executeJavaScript(`
      ({
        href: location.href,
        title: document.title,
        rootChildren: document.querySelector('#root')?.children.length ?? null,
        bodyText: document.body?.innerText?.slice(0, 500) ?? '',
        runtime: window.__CLASH_RUNTIME_CONFIG__ ?? null
      })
    `);
    desktopLog.info(`[desktop:${label}] ${JSON.stringify(state)}`);
    await captureRenderer(label, window);
  } catch (err) {
    if (window.isDestroyed() || String(err).includes("Object has been destroyed")) return;
    desktopLog.error(`[desktop:${label}] renderer inspect failed`, err);
  }
}

function resolveDataDir(): string {
  return defaultLocalApiDataDir(process.env);
}

function configureElectronStatePaths(dataDir: string): void {
  const state = resolveDesktopStatePaths(dataDir);
  for (const directory of Object.values(state)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  app.setPath("userData", state.userData);
  app.setPath("sessionData", state.sessionData);
  app.setPath("logs", state.logs);
  app.setPath("crashDumps", state.crashDumps);
}

const desktopDataDir = resolveDataDir();
configureElectronStatePaths(desktopDataDir);

async function configureAcpHarnessEnvironment(dataDir: string): Promise<void> {
  const acpBinDir = resolveAcpBinDir(dataDir);
  process.env.CLASH_ACP_BIN_DIR = process.env.CLASH_ACP_TEST_BIN_DIR || acpBinDir;
  process.env.CLASH_AGENT_BUNDLE_ROOT = resolveAgentBundleRoot({
    isPackaged: app.isPackaged,
    moduleDir: __dirname,
    resourcesPath: process.resourcesPath,
  });
  process.env.CLASH_CLI_ENTRY_PATH = resolveClashCliEntryPath({
    isPackaged: app.isPackaged,
    moduleDir: __dirname,
    resourcesPath: process.resourcesPath,
  });
  const clashCliNodePath = resolveClashCliNodePath({
    isPackaged: app.isPackaged,
    moduleDir: __dirname,
    resourcesPath: process.resourcesPath,
  });
  if (clashCliNodePath) process.env.CLASH_CLI_NODE_PATH = clashCliNodePath;
  process.env.CLASH_NODE_EXEC_PATH ??= process.execPath;
  const clashSdkPythonPath = resolveClashSdkPythonPath({
    envPythonSdkPath: process.env.CLASH_PYTHON_SDK_PATH,
    isPackaged: app.isPackaged,
    moduleDir: __dirname,
    resourcesPath: process.resourcesPath,
  });
  process.env.PYTHONPATH = prependPythonPath(process.env.PYTHONPATH, clashSdkPythonPath);

  await mkdir(acpBinDir, { recursive: true });
}

function contentTypeForPath(path: string): string {
  if (path.endsWith(".html")) return "text/html";
  if (path.endsWith(".js")) return "text/javascript";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".wasm")) return "application/wasm";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

async function readWebAsset(distDir: string, pathname: string): Promise<Response> {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const candidate = normalize(join(distDir, cleanPath));
  const rel = relative(distDir, candidate);
  const safeCandidate = rel.startsWith("..") || rel === ".." ? join(distDir, "index.html") : candidate;

  try {
    const bytes = await readFile(safeCandidate);
    return new Response(bytes, { headers: { "content-type": contentTypeForPath(safeCandidate) } });
  } catch {
    const index = join(distDir, "index.html");
    const bytes = await readFile(index);
    return new Response(bytes, { headers: { "content-type": "text/html" } });
  }
}

function registerWebProtocol(): void {
  const distDir = resolveWebDistDir({
    envWebDistDir: process.env.CLASH_WEB_DIST_DIR,
    isPackaged: app.isPackaged,
    moduleDir: __dirname,
    resourcesPath: process.resourcesPath,
  });
  protocol.handle("clash", async (request) => {
    const url = new URL(request.url);
    return readWebAsset(distDir, url.pathname);
  });
}

async function startLocalApiOnPort(port: number, dataDir: string, runDir: string): Promise<void> {
  localApiServer = await startLocalApiServer({
    dataDir,
    port,
    discovery: {
      enabled: true,
      runDir,
      launchMode: "desktop",
      startedBy: "desktop",
      ownerClientId: `desktop-${process.pid}`,
    },
    timelineRenderer: createDesktopTimelineRenderer({
      moduleDir: __dirname,
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
    }),
  });
}

async function closeLocalApiServer(): Promise<void> {
  const server = localApiServer;
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      if (localApiServer === server) localApiServer = null;
      resolve();
    });
  });
}

async function initializeRuntime(dataDir: string): Promise<void> {
  let apiPort = DEFAULT_DESKTOP_API_PORT;
  let apiBaseUrl = process.env.CLASH_API_BASE_URL;
  await configureAcpHarnessEnvironment(dataDir);

  if (!apiBaseUrl) {
    const runDir = join(clashHomeForLocalDataDir(dataDir), "run");
    const daemon = createLocalDaemonBootstrap({
      runDir,
      profile: resolveClashProfile(process.env),
      launch: async () => {
        const resolved = await resolveAvailableDesktopApiPort({
          envPort: process.env.CLASH_LOCAL_API_PORT,
        });
        apiPort = resolved.port;
        if (resolved.source === "ephemeral") {
          desktopLog.warn(`[desktop] local API port ${resolved.preferredPort} is unavailable; using ${resolved.port}`);
        }

        try {
          await startLocalApiOnPort(apiPort, dataDir, runDir);
        } catch (error) {
          if (process.env.CLASH_LOCAL_API_PORT || !isAddressInUse(error)) throw error;
          const fallback = await resolveAvailableDesktopApiPort({ envPort: "0" });
          apiPort = fallback.port;
          desktopLog.warn(`[desktop] local API port changed during startup; retrying on ${apiPort}`);
          await startLocalApiOnPort(apiPort, dataDir, runDir);
        }
        return { pid: process.pid, stop: closeLocalApiServer };
      },
    });
    try {
      const host = await daemon.ensureDaemon();
      apiBaseUrl = host.endpoint;
      const discoveredPort = Number(new URL(host.endpoint).port);
      if (Number.isInteger(discoveredPort) && discoveredPort > 0) apiPort = discoveredPort;
    } finally {
      await daemon.close();
    }
  }

  runtime = resolveDesktopRuntime({
    apiPort,
    apiBaseUrl,
    wsBaseUrl: process.env.CLASH_WS_BASE_URL,
    webUrl: process.env.CLASH_WEB_URL,
  });
  process.env.CLASH_DESKTOP_RUNTIME = JSON.stringify(runtime);
}

function installApplicationMenu(): void {
  const closeOrQuit: MenuItemConstructorOptions =
    process.platform === "darwin" ? { role: "close" } : { role: "quit" };
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" } satisfies MenuItemConstructorOptions] : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            void createWindow();
          },
        },
        { type: "separator" },
        closeOrQuit,
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function bindWindowEvents(window: BrowserWindow): void {
  window.webContents.on("console-message", (_event, level, message) => {
    desktopLog.info(`[desktop:renderer:${window.id}:${level}] ${message}`);
  });
  window.webContents.on("dom-ready", () => {
    void logRendererState(`window-${window.id}-dom-ready`, window);
  });
  window.webContents.on("did-finish-load", () => {
    void logRendererState(`window-${window.id}-finish-load`, window);
  });
  window.webContents.on("did-navigate-in-page", (_event, url) => {
    desktopLog.info(`[desktop:${window.id}] navigate in page: ${url}`);
    setTimeout(() => {
      if (!window.isDestroyed()) void logRendererState(`window-${window.id}-after-navigate`, window);
    }, 500);
  });
  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    desktopLog.error(`[desktop:${window.id}] failed to load ${url}: ${code} ${description}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    desktopLog.error(`[desktop:${window.id}] renderer gone: ${JSON.stringify(details)}`);
  });

  const captureIntervalMs = Number(process.env.CLASH_DESKTOP_CAPTURE_INTERVAL_MS ?? 0);
  if (captureIntervalMs > 0) {
    const interval = setInterval(() => {
      if (window.isDestroyed()) {
        clearInterval(interval);
        return;
      }
      void logRendererState(`window-${window.id}-capture-interval`, window);
    }, captureIntervalMs);
    window.on("closed", () => clearInterval(interval));
  }
}

async function createWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    ...resolveDesktopWindowOptions(windowRegistry.count(), nativeTheme.shouldUseDarkColors),
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      sandbox: false,
      additionalArguments: [],
    },
  });
  windowRegistry.register(window);
  bindWindowEvents(window);
  ensureNativeWindowControlsVisible(window);

  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) window.show();
  });

  await window.loadURL(currentRuntime().webUrl);
  if (!window.isDestroyed() && !window.isVisible()) window.show();

  return window;
}

function registerWindowIpc(dataDir: string): void {
  ipcMain.handle("clash:new-window", async () => {
    const window = await createWindow();
    return { windowId: window.id, windowCount: windowRegistry.count() };
  });
  ipcMain.handle("clash:get-nle-availability", async () => detectNleAvailability());
  ipcMain.handle("clash:export-director-video", async (_event, request: DesktopDirectorVideoExportRequest) => {
    const forcedPath = process.env.CLASH_DIRECTOR_E2E_VIDEO_EXPORT_PATH;
    const save = forcedPath
      ? { canceled: false, filePath: forcedPath }
      : await dialog.showSaveDialog({
          title: "Export Director camera video",
          defaultPath: join(
            app.getPath("videos"),
            safeDirectorVideoExportName(request.stageName, request.cameraName),
          ),
          filters: [{ name: "WebM video", extensions: ["webm"] }],
          properties: ["createDirectory", "showOverwriteConfirmation"],
        });
    if (save.canceled || !save.filePath) return { canceled: true };
    await mkdir(dirname(save.filePath), { recursive: true });
    await writeFile(save.filePath, directorVideoBytes(request.bytes));
    return { canceled: false, outputPath: save.filePath };
  });
  ipcMain.handle("clash:open-in-nle", async (_event, request: DesktopNleHandoffRequest) => {
    const documentPath = await materializeNleHandoff(
      join(dirname(dataDir), "nle-handoffs"),
      request,
    );
    await openNleDocument(request.target, documentPath);
    return { documentPath };
  });
}

app.whenReady().then(async () => {
  const dataDir = desktopDataDir;
  registerWebProtocol();
  installApplicationMenu();
  registerWindowIpc(dataDir);
  await initializeRuntime(dataDir);
  await createWindow();

  app.on("activate", () => {
    if (shouldCreateWindowOnActivate(windowRegistry.count())) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (!localApiServer || shutdownBarrierStarted) return;
  event.preventDefault();
  shutdownBarrierStarted = true;
  localApiServer.close(() => {
    localApiServer = null;
    app.quit();
  });
});
