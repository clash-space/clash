import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details === undefined ? "" : `: ${JSON.stringify(details)}`}`);
  }
}

export async function findFreePort(start) {
  for (let port = start; port < start + 100; port += 1) {
    const ok = await new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
    });
    if (ok) return port;
  }
  throw new Error(`No free port found from ${start}`);
}

export async function waitForHttp(url, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(
    `Timed out waiting for ${label}: ${url}` +
      (lastError ? ` (${lastError instanceof Error ? lastError.message : String(lastError)})` : ""),
  );
}

export function tail(lines, max = 100) {
  return lines.slice(Math.max(0, lines.length - max)).join("");
}

export function chromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("No Chrome-compatible browser found. Set CHROME_BIN to run GUI E2E.");
  }
  return found;
}

export async function waitForTarget(cdpPort, timeoutMs = 15000) {
  const url = `http://127.0.0.1:${cdpPort}/json/list`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const targets = await res.json();
        const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {
      // CDP is still booting.
    }
    await sleep(200);
  }
  throw new Error("Timed out waiting for Chrome CDP target");
}

export class CdpClient {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.ws = new WebSocket(url);
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      if (!msg.id || !this.pending.has(msg.id)) return;
      const pending = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(JSON.stringify(msg.error)));
      else pending.resolve(msg.result);
    });
  }

  async ready() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  close() {
    this.ws.close();
  }
}

export async function evaluate(cdp, expression, { timeoutMs = 12000 } = {}) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: timeoutMs,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Runtime evaluation failed");
  }
  return result.result.value;
}

export async function pageDiagnostics(cdp) {
  try {
    return await evaluate(cdp, `(() => ({
      href: location.href,
      title: document.title,
      bodyText: document.body.innerText.slice(0, 2400),
      activeElement: document.activeElement ? {
        tag: document.activeElement.tagName,
        text: (document.activeElement.innerText || document.activeElement.textContent || "").trim().slice(0, 200),
        aria: document.activeElement.getAttribute("aria-label"),
      } : null,
      dialogs: [...document.querySelectorAll("[role='dialog']")].map((el) => (el.innerText || el.textContent || "").trim().slice(0, 1000)),
      buttons: [...document.querySelectorAll("button, a, [role='button'], [role='menuitem'], [role='tab']")]
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        })
        .slice(0, 80)
        .map((el) => ({
          tag: el.tagName,
          text: (el.innerText || el.textContent || "").trim().slice(0, 160),
          aria: el.getAttribute("aria-label"),
          role: el.getAttribute("role"),
          disabled: el.disabled || el.getAttribute("aria-disabled"),
        })),
    }))()`, { timeoutMs: 3000 });
  } catch (error) {
    return { diagnosticsError: error instanceof Error ? error.message : String(error) };
  }
}

export async function waitFor(cdp, expression, label, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(cdp, expression);
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  const diagnostics = await pageDiagnostics(cdp);
  throw new Error(
    `Timed out waiting for ${label}` +
      (lastError ? `; last error: ${lastError instanceof Error ? lastError.message : String(lastError)}` : "") +
      `; page: ${JSON.stringify(diagnostics)}`,
  );
}

async function resolveVisibleElement(cdp, selectorExpression, label) {
  return waitFor(
    cdp,
    `(() => {
      const el = (${selectorExpression});
      if (!el) return false;
      el.scrollIntoView({ block: "center", inline: "center" });
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width <= 0 || rect.height <= 0 || style.visibility === "hidden" || style.display === "none") return false;
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        text: (el.innerText || el.textContent || "").trim().slice(0, 200),
        aria: el.getAttribute("aria-label"),
        tag: el.tagName,
      };
    })()`,
    `resolve ${label}`,
  );
}

export async function click(cdp, selectorExpression, label) {
  const point = await resolveVisibleElement(cdp, selectorExpression, label);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    button: "none",
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  return point;
}

export function clickableByTextExpression(label) {
  return `([...document.querySelectorAll("a, button, [role='button'], [role='menuitem'], [role='tab']")].find((el) => {
    const text = (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim();
    if (text !== ${JSON.stringify(label)}) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }))`;
}

export async function clickByText(cdp, label, description = label) {
  return click(cdp, clickableByTextExpression(label), description);
}

export async function typeText(cdp, selector, text) {
  const inserted = await evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.focus();
    if (el.isContentEditable) {
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, ${JSON.stringify(text)});
      el.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: ${JSON.stringify(text)}
      }));
      return (el.innerText || el.textContent || "").includes(${JSON.stringify(text)});
    }
    if ("value" in el) {
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: ${JSON.stringify(text)}
      }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value === ${JSON.stringify(text)};
    }
    return false;
  })()`);
  if (!inserted) {
    const diagnostics = await pageDiagnostics(cdp);
    throw new Error(`Could not type into ${selector}: ${JSON.stringify(diagnostics)}`);
  }
}

export async function capture(cdp, targetPath) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  await writeFile(targetPath, Buffer.from(shot.data, "base64"));
}

export async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    sleep(3000).then(() => false),
  ]);
  if (!exited) child.kill("SIGKILL");
}
