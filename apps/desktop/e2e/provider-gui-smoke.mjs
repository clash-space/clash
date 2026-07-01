import path from "node:path";
import {
  clickButtonByLabel,
  clickByText,
  createAgentBrowser,
  ensureAgentBrowser,
  evalJson,
  findFreePort,
  repoRoot,
  resetDirs,
  startElectron,
  startVite,
  stopProcess,
  tail,
  waitForEval,
  waitForHttp,
} from "./startup-shared.mjs";

const captureDir =
  process.env.CLASH_DESKTOP_PROVIDER_GUI_CAPTURE_DIR ??
  path.join(repoRoot, ".tmp", "provider-gui-desktop-captures");
const dataDir =
  process.env.CLASH_DESKTOP_PROVIDER_GUI_DATA_DIR ??
  path.join(repoRoot, ".tmp", "provider-gui-desktop-data");
const sessionName = `clash-desktop-provider-gui-${Date.now().toString(36)}`;
const latestScreenshot = path.join(captureDir, "latest-provider-gui-desktop.png");

async function seedMockProviders(apiOrigin) {
  const res = await fetch(`${apiOrigin}/api/v1/model-providers`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      providers: [
        {
          id: "mock-primary",
          label: "Mock primary",
          providerId: "mock",
          upstreamId: "mock",
          enabled: true,
          priority: 10,
        },
        {
          id: "replicate-primary",
          label: "Replicate primary",
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          priority: 20,
          credentials: { apiKey: "r8-desktop-gui-key" },
        },
      ],
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`Could not seed desktop mock providers: HTTP ${res.status} ${await res.text().catch(() => "")}`);
  }
}

function navigateTo(agentBrowser, pathname) {
  return evalJson(agentBrowser, `(() => {
    window.location.assign(${JSON.stringify(pathname)});
    return true;
  })()`);
}

async function runProviderFlow(agentBrowser, apiOrigin) {
  await seedMockProviders(apiOrigin);
  navigateTo(agentBrowser, "/settings?section=providers");
  await waitForEval(
    agentBrowser,
    `location.pathname === "/settings" &&
      location.search.includes("section=providers") &&
      document.body.innerText.includes("BYOK")`,
    "desktop BYOK providers settings",
    20000,
  );

  if (!clickButtonByLabel(agentBrowser, "Open Mock Provider BYOK settings")) {
    throw new Error("Could not open Mock Provider BYOK settings");
  }
  await waitForEval(agentBrowser, `document.body.innerText.includes("Mock primary")`, "desktop mock provider row");

  if (!clickButtonByLabel(agentBrowser, "Expand Mock primary")) {
    throw new Error("Could not expand Mock primary provider account");
  }
  await waitForEval(
    agentBrowser,
    `document.body.innerText.includes("Model to test") &&
      !!document.querySelector("button[aria-label='Run provider test']")`,
    "desktop mock provider test controls",
  );

  if (!clickButtonByLabel(agentBrowser, "Run provider test")) {
    throw new Error("Could not run desktop mock provider test");
  }
  await waitForEval(
    agentBrowser,
    `document.body.innerText.includes("Mock provider can run Nano Banana 2.")`,
    "desktop mock provider test result",
  );

  if (!clickByText(agentBrowser, "View supported models")) {
    throw new Error("Could not open desktop supported models link");
  }
  await waitForEval(
    agentBrowser,
    `location.pathname === "/settings" &&
      location.search.includes("section=models") &&
      location.search.includes("provider=mock%3Amock%3A") &&
      document.body.innerText.includes("Models supported by Mock Provider")`,
    "desktop mock supported models page",
  );

  if (!clickButtonByLabel(agentBrowser, "Edit provider order for GPT Image 2")) {
    throw new Error("Could not open desktop GPT Image 2 provider order");
  }
  await waitForEval(
    agentBrowser,
    `!!document.querySelector("[aria-label='GPT Image 2 provider order']")`,
    "desktop GPT Image 2 provider order",
  );
  if (!clickButtonByLabel(agentBrowser, "Move Replicate up for GPT Image 2")) {
    throw new Error("Could not move Replicate up for GPT Image 2 in desktop settings");
  }
  await waitForEval(
    agentBrowser,
    `fetch(${JSON.stringify(`${apiOrigin}/api/v1/model-providers`)})
      .then((res) => res.json())
      .then((json) => {
        const providers = json.providers ?? [];
        const replicate = providers.find((provider) => provider.id === "replicate-primary");
        const mock = providers.find((provider) => provider.id === "mock-primary");
        return replicate?.modelPriorities?.["gpt-image-2"] === 10 &&
          mock?.modelPriorities?.["gpt-image-2"] === 20;
      })
      .catch(() => false)`,
    "desktop GPT Image 2 provider order saved",
  );

  return evalJson(agentBrowser, `(() => ({
    href: location.href,
    text: document.body.innerText.slice(0, 900),
    providers: window.__CLASH_RUNTIME_CONFIG__?.apiBaseUrl ? "desktop-api" : "missing-runtime"
  }))()`);
}

async function main() {
  ensureAgentBrowser();
  process.env.CLASH_E2E_STUB_ACP = "1";
  await resetDirs(dataDir, captureDir);

  const webPort = await findFreePort(49880);
  const apiPort = await findFreePort(49930);
  const cdpPort = await findFreePort(49980);
  const webOrigin = `http://127.0.0.1:${webPort}`;

  const webLogs = [];
  const electronLogs = [];
  let web;
  let electron;
  const agentBrowser = createAgentBrowser({ sessionName, captureDir });

  try {
    web = await startVite({ webPort, logs: webLogs });
    await waitForHttp(webOrigin, "Vite desktop provider web shell");

    electron = await startElectron({
      cdpPort,
      webOrigin,
      apiPort,
      dataDir,
      captureDir,
      logs: electronLogs,
      env: { CLASH_E2E_STUB_ACP: "1" },
    });
    await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`, "Electron CDP");

    agentBrowser(["close"], { allowFailure: true });
    agentBrowser(["connect", String(cdpPort)]);
    await waitForEval(agentBrowser, `document.body.innerText.includes("Home")`, "desktop home page");
    const runtime = await waitForEval(
      agentBrowser,
      `(() => window.__CLASH_RUNTIME_CONFIG__?.apiBaseUrl ? window.__CLASH_RUNTIME_CONFIG__ : false)()`,
      "Electron desktop runtime config",
    );

    const state = await runProviderFlow(agentBrowser, runtime.apiBaseUrl);
    agentBrowser(["screenshot", latestScreenshot]);
    console.log("[desktop-provider-gui] state", JSON.stringify(state));
    console.log(`[desktop-provider-gui] screenshot ${latestScreenshot}`);
  } catch (error) {
    try {
      agentBrowser(["screenshot", latestScreenshot], { allowFailure: true });
      console.error(`[desktop-provider-gui] failure screenshot ${latestScreenshot}`);
    } catch {
      // Ignore screenshot failure while unwinding.
    }
    console.error("[desktop-provider-gui] web logs\n" + tail(webLogs));
    console.error("[desktop-provider-gui] electron logs\n" + tail(electronLogs));
    throw error;
  } finally {
    agentBrowser(["close"], { allowFailure: true });
    await stopProcess(electron);
    await stopProcess(web);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
