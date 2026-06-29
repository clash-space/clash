import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

process.env.CLASH_DESKTOP_AGENT_BROWSER_CAPTURE_DIR ??= path.join(
  repoRoot,
  ".tmp",
  "startup-ui-smoke",
  "screenshots",
);
process.env.CLASH_DESKTOP_AGENT_BROWSER_DATA_DIR ??= path.join(
  repoRoot,
  ".tmp",
  "startup-ui-smoke",
  "data",
);

await import("./agent-browser-smoke.mjs");
