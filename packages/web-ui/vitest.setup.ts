import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import "@testing-library/jest-dom/vitest";

/**
 * Many suites in this package assert on repository source files and resolve them
 * from `process.cwd()`. They were written while the only way to run them was
 * from the repository root, so running them per-package broke every path.
 *
 * Pin the working directory instead of rewriting 267 path expressions: the
 * suites' intent is "resolve against the repository", and this makes that true
 * no matter where the runner is invoked from.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
process.chdir(repoRoot);

// AgentChatView owns transcript geometry through use-stick-to-bottom. jsdom
// does not ship the observer used by that primitive, so component tests use a
// no-op observer while interaction assertions drive disclosure state directly.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
