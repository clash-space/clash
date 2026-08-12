import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  protocol,
} from "electron";
import type { MenuItemConstructorOptions } from "electron";

import {
  directorVideoBytes,
  safeDirectorVideoExportName,
  type DesktopDirectorVideoExportRequest,
} from "../director-video-export";
import {
  detectNleAvailability,
  materializeNleHandoff,
  openNleDocument,
  type DesktopNleHandoffRequest,
} from "../nle-handoff";
import { resolveWebDistDir } from "../paths";
import {
  authorizeProviderInWindow,
  type ProviderOAuthAuthorizationRequest,
} from "../provider-oauth-window";
import type { DesktopRuntime } from "../runtime";
import {
  createWindowRegistry,
  ensureNativeWindowControlsVisible,
  resolveDesktopWindowOptions,
  shouldCreateWindowOnActivate,
} from "../windowing";
import type { DesktopControllerLogger } from "./types";

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

export function createDesktopWindowController({
  moduleDir,
  dataDir,
  currentRuntime,
  log,
}: {
  moduleDir: string;
  dataDir: string;
  currentRuntime: () => DesktopRuntime;
  log: DesktopControllerLogger;
}) {
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
      log.info(`[desktop:${label}] capture ${file}`);
    } catch (error) {
      if (window.isDestroyed() || String(error).includes("Object has been destroyed")) return;
      log.error(`[desktop:${label}] capture failed`, error);
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
      log.info(`[desktop:${label}] ${JSON.stringify(state)}`);
      await captureRenderer(label, window);
    } catch (error) {
      if (window.isDestroyed() || String(error).includes("Object has been destroyed")) return;
      log.error(`[desktop:${label}] renderer inspect failed`, error);
    }
  }

  function bindWindowEvents(window: BrowserWindow): void {
    window.webContents.on("console-message", (_event, level, message) => {
      log.info(`[desktop:renderer:${window.id}:${level}] ${message}`);
    });
    window.webContents.on("dom-ready", () => {
      void logRendererState(`window-${window.id}-dom-ready`, window);
    });
    window.webContents.on("did-finish-load", () => {
      void logRendererState(`window-${window.id}-finish-load`, window);
    });
    window.webContents.on("did-navigate-in-page", (_event, url) => {
      log.info(`[desktop:${window.id}] navigate in page: ${url}`);
      setTimeout(() => {
        if (!window.isDestroyed()) void logRendererState(`window-${window.id}-after-navigate`, window);
      }, 500);
    });
    window.webContents.on("did-fail-load", (_event, code, description, url) => {
      log.error(`[desktop:${window.id}] failed to load ${url}: ${code} ${description}`);
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      log.error(`[desktop:${window.id}] renderer gone: ${JSON.stringify(details)}`);
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
        preload: join(moduleDir, "preload.js"),
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

  function registerWebProtocol(): void {
    const distDir = resolveWebDistDir({
      envWebDistDir: process.env.CLASH_WEB_DIST_DIR,
      isPackaged: app.isPackaged,
      moduleDir,
      resourcesPath: process.resourcesPath,
    });
    protocol.handle("clash", async (request) => {
      const url = new URL(request.url);
      return readWebAsset(distDir, url.pathname);
    });
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

  function registerWindowIpc(): void {
    ipcMain.handle("clash:new-window", async () => {
      const window = await createWindow();
      return { windowId: window.id, windowCount: windowRegistry.count() };
    });
    ipcMain.handle("clash:get-nle-availability", async () => detectNleAvailability());
    ipcMain.handle("clash:authorize-provider", async (event, request: ProviderOAuthAuthorizationRequest) => {
      const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const authorizationWindow = new BrowserWindow({
        width: 520,
        height: 760,
        minWidth: 420,
        minHeight: 600,
        title: "Connect provider",
        show: false,
        ...(parent ? { parent, modal: true } : {}),
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      authorizationWindow.once("ready-to-show", () => {
        if (!authorizationWindow.isDestroyed()) authorizationWindow.show();
      });
      return authorizeProviderInWindow(authorizationWindow, request);
    });
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

  function registerHostBindings(): void {
    registerWebProtocol();
    installApplicationMenu();
    registerWindowIpc();
  }

  function activate(): void {
    if (shouldCreateWindowOnActivate(windowRegistry.count())) {
      void createWindow();
    }
  }

  return { registerHostBindings, createWindow, activate };
}
