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

function setInputValueByLabel(agentBrowser, label, value) {
  return evalJson(agentBrowser, `(() => {
    const wanted = ${JSON.stringify(label)};
    const input = [...document.querySelectorAll("input, textarea")].find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      return candidate.getAttribute("aria-label") === wanted &&
        rect.width > 0 && rect.height > 0 &&
        style.display !== "none" && style.visibility !== "hidden" &&
        !candidate.disabled;
    });
    if (!input) return false;
    input.scrollIntoView({ block: "center", inline: "center" });
    input.focus();
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter?.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: ${JSON.stringify(value)}, inputType: "insertText" }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

function clickButtonInGroup(agentBrowser, groupLabel, buttonLabel) {
  return evalJson(agentBrowser, `(() => {
    const wantedGroup = ${JSON.stringify(groupLabel)};
    const wantedButton = ${JSON.stringify(buttonLabel)};
    const group = [...document.querySelectorAll("[role='group']")].find((candidate) =>
      candidate.getAttribute("aria-label") === wantedGroup
    );
    if (!group) return false;
    const button = [...group.querySelectorAll("button")].find((candidate) => {
      const text = (candidate.innerText || candidate.textContent || "").trim();
      const aria = candidate.getAttribute("aria-label") || "";
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      return (text === wantedButton || aria === wantedButton) &&
        rect.width > 0 && rect.height > 0 &&
        style.display !== "none" && style.visibility !== "hidden" &&
        !candidate.disabled;
    });
    if (!button) return false;
    button.scrollIntoView({ block: "center", inline: "center" });
    button.click();
    return true;
  })()`);
}

function clickMenuItemContaining(agentBrowser, text) {
  return evalJson(agentBrowser, `(() => {
    const wanted = ${JSON.stringify(text)};
    const item = [...document.querySelectorAll("[role='menu'] [role='menuitemradio'], [role='menu'] [role='menuitem']")].find((candidate) => {
      const value = (candidate.innerText || candidate.textContent || "").trim();
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      return value.includes(wanted) &&
        rect.width > 0 && rect.height > 0 &&
        style.display !== "none" && style.visibility !== "hidden" &&
        !candidate.disabled;
    });
    if (!item) return false;
    item.scrollIntoView({ block: "center", inline: "center" });
    item.click();
    return true;
  })()`);
}

function clickListboxOptionContaining(agentBrowser, text) {
  return evalJson(agentBrowser, `(() => {
    const wanted = ${JSON.stringify(text)};
    const item = [...document.querySelectorAll("[role='listbox'] [role='option']")].find((candidate) => {
      const value = (candidate.innerText || candidate.textContent || "").trim();
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      return value.includes(wanted) &&
        rect.width > 0 && rect.height > 0 &&
        style.display !== "none" && style.visibility !== "hidden" &&
        !candidate.disabled;
    });
    if (!item) return false;
    item.scrollIntoView({ block: "center", inline: "center" });
    item.click();
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

  if (!clickButtonByLabel(agentBrowser, "Model to test")) {
    throw new Error("Could not open desktop provider test model selector");
  }
  if (!clickMenuItemContaining(agentBrowser, "GPT Image 2")) {
    throw new Error("Could not select GPT Image 2 for the desktop mock provider test");
  }
  await waitForEval(
    agentBrowser,
    `document.body.innerText.includes("GPT Image 2")`,
    "desktop mock provider selected test model",
  );
  if (!clickButtonByLabel(agentBrowser, "Run provider test")) {
    throw new Error("Could not run desktop mock provider test");
  }
  await waitForEval(
    agentBrowser,
    `document.body.innerText.includes("Mock provider can run GPT Image 2.")`,
    "desktop mock provider test result",
  );

  if (!clickButtonByLabel(agentBrowser, "Model access")) {
    throw new Error("Could not open desktop model access selector");
  }
  if (!clickMenuItemContaining(agentBrowser, "Specific models")) {
    throw new Error("Could not switch desktop mock provider to specific model access");
  }
  await waitForEval(
    agentBrowser,
    `!!document.querySelector("button[aria-label='Add supported model']")`,
    "desktop specific model access controls",
  );
  if (!clickButtonByLabel(agentBrowser, "Add supported model")) {
    throw new Error("Could not open desktop supported model picker");
  }
  await waitForEval(
    agentBrowser,
    `!!document.querySelector("input[aria-label='Filter supported models']")`,
    "desktop supported model picker search",
  );
  if (!setInputValueByLabel(agentBrowser, "Filter supported models", "gpt image")) {
    throw new Error("Could not filter desktop supported models");
  }
  if (!clickListboxOptionContaining(agentBrowser, "GPT Image 2")) {
    throw new Error("Could not add GPT Image 2 to the desktop mock provider allowlist");
  }
  await waitForEval(
    agentBrowser,
    `document.body.innerText.includes("GPT Image 2") && (() => {
      const editor = document.querySelector("[role='group'][aria-label='Mock primary Mock Provider API key']");
      return !![...(editor?.querySelectorAll("button") ?? [])].find((button) =>
        (button.innerText || button.textContent || "").trim() === "Save" && !button.disabled
      );
    })()`,
    "desktop mock provider model allowlist draft",
  );
  if (!clickButtonInGroup(agentBrowser, "Mock primary Mock Provider API key", "Save")) {
    throw new Error("Could not save desktop mock provider model allowlist");
  }
  await waitForEval(
    agentBrowser,
    `fetch(${JSON.stringify(`${apiOrigin}/api/v1/model-providers`)})
      .then((res) => res.json())
      .then((json) => json.providers?.some((provider) =>
        provider.id === "mock-primary" &&
        Array.isArray(provider.supportedModelIds) &&
        provider.supportedModelIds.length === 1 &&
        provider.supportedModelIds[0] === "gpt-image-2"
      ))
      .catch(() => false)`,
    "desktop mock provider model allowlist saved",
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

  navigateTo(agentBrowser, "/settings?section=providers");
  await waitForEval(agentBrowser, `document.body.innerText.includes("BYOK")`, "desktop BYOK providers after model order");
  if (!clickButtonByLabel(agentBrowser, "Open Replicate BYOK settings")) {
    throw new Error("Could not open Replicate BYOK settings");
  }
  await waitForEval(agentBrowser, `document.body.innerText.includes("Replicate primary")`, "desktop Replicate provider row");
  if (!clickButtonByLabel(agentBrowser, "Add prioritized Replicate key")) {
    throw new Error("Could not add a Replicate provider key");
  }
  await waitForEval(
    agentBrowser,
    `!!document.querySelector("[role='group'][aria-label='New Replicate API key']")`,
    "desktop new Replicate key editor",
  );
  if (!setInputValueByLabel(agentBrowser, "Replicate key name", "Desktop smoke key")) {
    throw new Error("Could not enter Replicate key name");
  }
  if (!setInputValueByLabel(agentBrowser, "Replicate API key", "r8-desktop-smoke-extra-key")) {
    throw new Error("Could not enter Replicate API key");
  }
  if (!clickButtonInGroup(agentBrowser, "New Replicate API key", "Save")) {
    throw new Error("Could not save the Replicate key draft");
  }
  await waitForEval(
    agentBrowser,
    `fetch(${JSON.stringify(`${apiOrigin}/api/v1/model-providers`)})
      .then((res) => res.json())
      .then((json) => (json.providers ?? []).some((provider) =>
        provider.providerId === "replicate" &&
        provider.label === "Desktop smoke key" &&
        provider.configuredCredentials?.includes("apiKey")
      ))
      .catch(() => false)`,
    "desktop Replicate key saved",
  );
  await waitForEval(agentBrowser, `document.body.innerText.includes("Desktop smoke key")`, "desktop saved Replicate key visible");
  if (!clickButtonByLabel(agentBrowser, "Expand Desktop smoke key")) {
    throw new Error("Could not expand the saved desktop Replicate key");
  }
  await waitForEval(
    agentBrowser,
    `!!document.querySelector("[role='group'][aria-label='Desktop smoke key Replicate API key']")`,
    "desktop saved Replicate key editor",
  );
  if (!clickButtonInGroup(agentBrowser, "Desktop smoke key Replicate API key", "Remove key")) {
    throw new Error("Could not remove the saved desktop Replicate key");
  }
  await waitForEval(
    agentBrowser,
    `fetch(${JSON.stringify(`${apiOrigin}/api/v1/model-providers`)})
      .then((res) => res.json())
      .then((json) => {
        const providers = json.providers ?? [];
        return providers.some((provider) => provider.id === "replicate-primary") &&
          !providers.some((provider) => provider.providerId === "replicate" && provider.label === "Desktop smoke key");
      })
      .catch(() => false)`,
    "desktop Replicate key removed",
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
