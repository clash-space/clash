import { constants } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_ACP_WRAPPERS } from "../scripts/prepare-acp-harnesses.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "..", "..");
const acpBinDir = path.join(desktopDir, "build", "acp-bin");
const acpNodeDir = path.join(desktopDir, "build", "acp-node");
const clashCliDir = path.join(desktopDir, "build", "clash-cli");
const clashCliEntry = path.join(clashCliDir, "dist", "index.js");
const clashCliVendorDir = path.join(clashCliDir, "vendor");

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

async function assertExecutable(file) {
  try {
    const info = await stat(file);
    assert(info.isFile(), `${file} is not a file`);
    await access(file, constants.X_OK);
  } catch (error) {
    failures.push(`${file} is not executable: ${error.message}`);
  }
}

for (const wrapper of BUILTIN_ACP_WRAPPERS) {
  await assertExecutable(path.join(acpBinDir, wrapper));
}

const acpBinEntries = await readdir(acpBinDir).catch(() => []);
assert(!acpBinEntries.includes("claude-code-acp"), "legacy claude-code-acp wrapper is present");
const claudeWrapper = await readFile(path.join(acpBinDir, "claude-agent-acp"), "utf8").catch((error) => {
  failures.push(`cannot read claude-agent-acp wrapper: ${error.message}`);
  return "";
});
assert(
  !claudeWrapper.includes("app.asar/node_modules/@agentclientprotocol/claude-agent-acp"),
  "claude-agent-acp wrapper still points into app.asar node_modules",
);
await access(
  path.join(acpNodeDir, "codex-acp", "node_modules", "@agentclientprotocol", "codex-acp", "dist", "index.js"),
  constants.R_OK,
).catch((error) => {
  failures.push(`packaged Codex agent bundle is missing dist/index.js: ${error.message}`);
});
await access(
  path.join(acpNodeDir, "claude-agent-acp", "node_modules", "@agentclientprotocol", "claude-agent-acp", "dist", "index.js"),
  constants.R_OK,
).catch((error) => {
  failures.push(`packaged Claude agent bundle is missing dist/index.js: ${error.message}`);
});
await assertExecutable(clashCliEntry);
await access(path.join(clashCliVendorDir, "commander"), constants.R_OK).catch((error) => {
  failures.push(`packaged Clash CLI is missing commander dependency: ${error.message}`);
});
await access(path.join(clashCliVendorDir, "loro-crdt"), constants.R_OK).catch((error) => {
  failures.push(`packaged Clash CLI is missing loro-crdt dependency: ${error.message}`);
});

const registrySource = await readFile(
  path.join(repoRoot, "packages", "cli", "src", "runtime", "bridge", "_acp-runtime", "registry.ts"),
  "utf8",
);
assert(!registrySource.includes("claude-code-acp"), "registry still references claude-code-acp");
assert(registrySource.includes("claude-agent-acp"), "registry does not reference claude-agent-acp");
assert(
  registrySource.includes('id: "gemini"') &&
    registrySource.includes('registryShimName("gemini")') &&
    registrySource.includes('args: ["--acp"]'),
  "registry is missing Gemini managed ACP launch",
);
assert(registrySource.includes("hermes") && registrySource.includes("acp"), "registry is missing Hermes native ACP launch");

if (failures.length > 0) {
  console.error("[startup-static] failed");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("[startup-static] ok", JSON.stringify({
  acpBinDir,
  clashCliEntry,
  builtIn: BUILTIN_ACP_WRAPPERS,
}));
