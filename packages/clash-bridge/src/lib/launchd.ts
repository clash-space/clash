/**
 * macOS launchd plist install/uninstall.
 *
 * KeepAlive=true → if the daemon crashes / is killed, launchd restarts it
 * within ~10s. RunAtLoad=true → launchd starts it on load (boot or `load`).
 * StandardOutPath / StandardErrorPath → logs go to ~/Library/Logs/clash/
 * so users can `tail -f` without dealing with `log show` filters.
 *
 * The plist invokes the same `clash-bridge` binary that's on PATH (the one
 * the user installed with `npm i -g @clash-space/bridge`). If the user
 * uninstalls the npm package, the plist will still try to start it on next
 * load and fail — `clash-bridge uninstall` removes the plist explicitly.
 */

import { mkdir, writeFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { paths, currentPlatform } from "./platform.js";

export interface InstallOptions {
  /** Absolute path to the daemon binary (the bin entry of @clash-space/bridge). */
  binaryPath: string;
}

function buildPlist(opts: InstallOptions): string {
  const p = paths();
  // launchd starts processes with a stripped PATH (~ /usr/bin:/bin only),
  // so agents installed under nvm / fnm / asdf / pyenv / cargo etc. are
  // invisible to daemon's `which`. Capture the user's currently-active
  // PATH at setup time and merge with the launchd defaults so common
  // homebrew + system locations are guaranteed even if the user's shell
  // PATH happens to be slim.
  const userPath = (process.env.PATH ?? "").split(":").filter(Boolean);
  const baseline = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  const merged = Array.from(new Set([...userPath, ...baseline]));
  // Also forward HOME explicitly — some tools (claude-agent-acp) read
  // ~/.claude/credentials based on HOME, which launchd already sets,
  // but being explicit doesn't hurt and helps when the daemon is
  // launched manually for testing.
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${p.serviceLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${opts.binaryPath}</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${p.logFile}</string>
  <key>StandardErrorPath</key>
  <string>${p.logFile}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${merged.join(":")}</string>
    <key>HOME</key>
    <string>${process.env.HOME ?? ""}</string>
  </dict>
</dict>
</plist>
`;
}

export async function install(opts: InstallOptions): Promise<void> {
  if (currentPlatform() !== "darwin") {
    throw new Error(
      `launchd install only supported on macOS. Run \`clash-bridge daemon\` in foreground or wire your own systemd unit.`,
    );
  }
  const p = paths();
  if (!p.serviceFile) throw new Error("no service file path on this platform");

  await mkdir(dirname(p.logFile), { recursive: true });
  await mkdir(dirname(p.serviceFile), { recursive: true });

  await writeFile(p.serviceFile, buildPlist(opts), "utf-8");

  // Reload — `unload` is best-effort (plist may not be loaded yet); the
  // load that follows is the one that must succeed.
  await runLaunchctl(["unload", p.serviceFile]).catch(() => undefined);
  await runLaunchctl(["load", "-w", p.serviceFile]);
}

export async function uninstall(): Promise<{ removed: boolean }> {
  if (currentPlatform() !== "darwin") {
    return { removed: false };
  }
  const p = paths();
  if (!p.serviceFile) return { removed: false };

  await runLaunchctl(["unload", p.serviceFile]).catch(() => undefined);
  try {
    await unlink(p.serviceFile);
    return { removed: true };
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { removed: false };
    throw e;
  }
}

function runLaunchctl(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("launchctl", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    p.once("error", reject);
    p.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`launchctl ${args.join(" ")} exited ${code}: ${stderr.trim()}`));
    });
  });
}
