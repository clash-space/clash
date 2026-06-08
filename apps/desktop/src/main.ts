import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, Menu, protocol } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { startLocalApiServer } from "@master-clash/local-api";
import { resolveWebDistDir } from "./paths";
import { resolveDesktopRuntime } from "./runtime";
import { hydrateMacGuiPath } from "./shell-path";
import {
  createWindowRegistry,
  ensureNativeWindowControlsVisible,
  resolveDesktopWindowOptions,
  shouldCreateWindowOnActivate,
} from "./windowing";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiPort = Number(process.env.CLASH_LOCAL_API_PORT ?? 49321);
const remoteDebuggingPort = process.env.CLASH_DESKTOP_REMOTE_DEBUGGING_PORT;
if (remoteDebuggingPort) {
  app.commandLine.appendSwitch("remote-debugging-port", remoteDebuggingPort);
}
hydrateMacGuiPath();

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

const runtime = resolveDesktopRuntime({
  apiPort,
  apiBaseUrl: process.env.CLASH_API_BASE_URL,
  wsBaseUrl: process.env.CLASH_WS_BASE_URL,
  webUrl: process.env.CLASH_WEB_URL,
});

const windowRegistry = createWindowRegistry<BrowserWindow>();
let captureCount = 0;

async function captureRenderer(label: string, window: BrowserWindow): Promise<void> {
  const captureDir = process.env.CLASH_DESKTOP_CAPTURE_DIR;
  if (!captureDir || window.isDestroyed()) return;

  try {
    await mkdir(captureDir, { recursive: true });
    const image = await window.webContents.capturePage();
    const safeLabel = label.replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    const file = join(captureDir, `${String(++captureCount).padStart(3, "0")}-${safeLabel}.png`);
    await writeFile(file, image.toPNG());
    console.log(`[desktop:${label}] capture ${file}`);
  } catch (err) {
    console.error(`[desktop:${label}] capture failed`, err);
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
    console.log(`[desktop:${label}] ${JSON.stringify(state)}`);
    await captureRenderer(label, window);
  } catch (err) {
    console.error(`[desktop:${label}] renderer inspect failed`, err);
  }
}

function resolveDataDir(): string {
  return process.env.CLASH_LOCAL_DATA_DIR ?? join(app.getPath("userData"), "local-api");
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

async function startLocalApi(): Promise<void> {
  if (process.env.CLASH_API_BASE_URL) return;
  await startLocalApiServer({ dataDir: resolveDataDir(), port: apiPort });
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
    console.log(`[desktop:renderer:${window.id}:${level}] ${message}`);
  });
  window.webContents.on("dom-ready", () => {
    void logRendererState(`window-${window.id}-dom-ready`, window);
  });
  window.webContents.on("did-finish-load", () => {
    void logRendererState(`window-${window.id}-finish-load`, window);
  });
  window.webContents.on("did-navigate-in-page", (_event, url) => {
    console.log(`[desktop:${window.id}] navigate in page: ${url}`);
    setTimeout(() => {
      if (!window.isDestroyed()) void logRendererState(`window-${window.id}-after-navigate`, window);
    }, 500);
  });
  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`[desktop:${window.id}] failed to load ${url}: ${code} ${description}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[desktop:${window.id}] renderer gone: ${JSON.stringify(details)}`);
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
    ...resolveDesktopWindowOptions(windowRegistry.count()),
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
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

  await window.loadURL(runtime.webUrl);
  if (!window.isDestroyed() && !window.isVisible()) window.show();

  return window;
}

function registerWindowIpc(): void {
  ipcMain.handle("clash:new-window", async () => {
    const window = await createWindow();
    return { windowId: window.id, windowCount: windowRegistry.count() };
  });
}

process.env.CLASH_DESKTOP_RUNTIME = JSON.stringify(runtime);

app.whenReady().then(async () => {
  registerWebProtocol();
  installApplicationMenu();
  registerWindowIpc();
  await startLocalApi();
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
