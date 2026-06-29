import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);

export const BUILTIN_ACP_WRAPPERS = ["codex-acp", "claude-agent-acp"];

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function packageRoot(packageName) {
  return dirname(require.resolve(`${packageName}/package.json`));
}

function packageBinPath(packageName, binName) {
  const root = packageRoot(packageName);
  const pkg = require(`${packageName}/package.json`);
  const bin = typeof pkg.bin === "string"
    ? pkg.bin
    : pkg.bin?.[binName] ?? (Object.keys(pkg.bin ?? {}).length === 1 ? Object.values(pkg.bin)[0] : undefined);
  if (!bin) throw new Error(`${packageName} does not expose bin ${binName}`);
  return join(root, bin);
}

function packageNodeModulesDir(packageName) {
  return dirname(dirname(packageRoot(packageName)));
}

function codexNativePackageName(platform = process.platform, arch = process.arch) {
  const platformPackages = {
    darwin: {
      arm64: "@zed-industries/codex-acp-darwin-arm64",
      x64: "@zed-industries/codex-acp-darwin-x64",
    },
    linux: {
      arm64: "@zed-industries/codex-acp-linux-arm64",
      x64: "@zed-industries/codex-acp-linux-x64",
    },
    win32: {
      arm64: "@zed-industries/codex-acp-win32-arm64",
      x64: "@zed-industries/codex-acp-win32-x64",
    },
  };
  const packageName = platformPackages[platform]?.[arch];
  if (!packageName) throw new Error(`Unsupported Codex ACP platform: ${platform}/${arch}`);
  return packageName;
}

export function renderCodexAcpWrapper({ packagedNativePath, devNativePath }) {
  return [
    "#!/bin/sh",
    "set -eu",
    "DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)",
    "RESOURCES_DIR=$(CDPATH= cd -- \"$DIR/..\" && pwd)",
    `PACKAGED_NATIVE="${packagedNativePath}"`,
    "if [ -x \"$PACKAGED_NATIVE\" ]; then",
    "  exec \"$PACKAGED_NATIVE\" \"$@\"",
    "fi",
    `exec ${shellQuote(devNativePath)} "$@"`,
    "",
  ].join("\n");
}

export function renderNodeAcpWrapper({ packagedScriptPath, devScriptPath }) {
  return [
    "#!/bin/sh",
    "set -eu",
    "DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)",
    "RESOURCES_DIR=$(CDPATH= cd -- \"$DIR/..\" && pwd)",
    `PACKAGED_SCRIPT="${packagedScriptPath}"`,
    "if [ -f \"$PACKAGED_SCRIPT\" ]; then",
    "  SCRIPT=\"$PACKAGED_SCRIPT\"",
    "else",
    `  SCRIPT=${shellQuote(devScriptPath)}`,
    "fi",
    "if [ -n \"${CLASH_NODE_EXEC_PATH:-}\" ]; then",
    "  export ELECTRON_RUN_AS_NODE=1",
    "  exec \"$CLASH_NODE_EXEC_PATH\" \"$SCRIPT\" \"$@\"",
    "fi",
    "if command -v node >/dev/null 2>&1; then",
    "  exec node \"$SCRIPT\" \"$@\"",
    "fi",
    "echo \"Unable to run agent harness: CLASH_NODE_EXEC_PATH is not set and node is not on PATH\" >&2",
    "exit 127",
    "",
  ].join("\n");
}

export async function prepareAcpHarnesses({ outputDir = join(desktopRoot, "build", "acp-bin") } = {}) {
  const codexNativePackage = codexNativePackageName();
  const codexNativeBin = packageBinPath(codexNativePackage, process.platform === "win32" ? "codex-acp.exe" : "codex-acp");
  const claudeAgentScript = packageBinPath("@agentclientprotocol/claude-agent-acp", "claude-agent-acp");
  const claudeAgentNodeModules = packageNodeModulesDir("@agentclientprotocol/claude-agent-acp");
  const resourceBuildDir = dirname(outputDir);
  const claudeAgentBundleDir = join(resourceBuildDir, "acp-node", "claude-agent-acp");

  await rm(outputDir, { recursive: true, force: true });
  await rm(claudeAgentBundleDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await mkdir(claudeAgentBundleDir, { recursive: true });
  await cp(claudeAgentNodeModules, join(claudeAgentBundleDir, "node_modules"), {
    recursive: true,
    dereference: true,
    force: true,
  });

  const codexWrapper = renderCodexAcpWrapper({
    packagedNativePath: `$RESOURCES_DIR/app.asar.unpacked/node_modules/${codexNativePackage}/bin/${process.platform === "win32" ? "codex-acp.exe" : "codex-acp"}`,
    devNativePath: codexNativeBin,
  });
  const claudeAgentWrapper = renderNodeAcpWrapper({
    packagedScriptPath: "$RESOURCES_DIR/acp-node/claude-agent-acp/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js",
    devScriptPath: claudeAgentScript,
  });

  const wrappers = [
    ["codex-acp", codexWrapper],
    ["claude-agent-acp", claudeAgentWrapper],
  ];
  for (const [name, contents] of wrappers) {
    const file = join(outputDir, name);
    await writeFile(file, contents, "utf8");
    await chmod(file, 0o755);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await prepareAcpHarnesses();
}
