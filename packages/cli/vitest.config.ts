import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  // Resolve workspace packages to their source. Without this, `@clash/shared-types` resolves to
  // dist, so a change to its source is invisible until it is rebuilt -- a test asserting on new
  // code fails against the old bundle, and the failure names the assertion rather than the
  // staleness. `authFormControls` was moved into shared-types and stayed "not a function" here
  // through two rebuild attempts for exactly this reason.
  resolve: {
    // An alias rather than a `development` export condition. The intent is the same -- workspace
    // packages resolve to source, so a change to `shared-types` is visible without a rebuild, and
    // `authFormControls` does not sit at "not a function" through two rebuild attempts. But a
    // condition has to be declared on the other side, and declaring it made `require.resolve` land
    // on `src/index.ts`, whose 52 sibling imports use `.js` specifiers that Vite rewrites and Node
    // does not. The host finds its bundled plugins with `require.resolve`. An alias is scoped to
    // this runner and cannot reach the host at all.
    alias: [
      {
        find: /^@clash\/shared-types\/(.+)$/,
        replacement: resolve(__dirname, "../shared-types/src/$1.ts"),
      },
      {
        find: /^@clash\/shared-types$/,
        replacement: resolve(__dirname, "../shared-types/src/index.ts"),
      },
      {
        find: /^@clash\/shared-runtime\/(.+)$/,
        replacement: resolve(__dirname, "../shared-runtime/src/$1.ts"),
      },
      {
        find: /^@clash\/shared-runtime$/,
        replacement: resolve(__dirname, "../shared-runtime/src/index.ts"),
      },
      {
        find: /^@clash\/shared-layout$/,
        replacement: resolve(__dirname, "../shared-layout/src/index.ts"),
      },
      {
        find: /^@clash\/remotion-effects\/(.+)$/,
        replacement: resolve(__dirname, "../remotion-effects/src/$1.ts"),
      },
      {
        find: /^@clash\/remotion-effects$/,
        replacement: resolve(__dirname, "../remotion-effects/src/index.ts"),
      },
    ],
  },
  test: {
    // Only source suites, and only the ones this runner can collect. Without the `src/` root the
    // compiled copies under dist/ come too: every suite runs twice and the stale copy fails against
    // current fixtures. The exclusion is the other half of the same problem -- 49 of this package's
    // 69 test files are still written against `node:test`, which vitest loads and then reports as
    // "No test suite found". They run under `node --test`; converting them is its own job.
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Node resolves A/AAAA in whatever order the resolver returns, and picks the first; curl falls
    // back on reachability and Node does not. A machine whose DNS answers IPv6 first then times out
    // against vendors that are reachable over IPv4.
    env: { NODE_OPTIONS: "--dns-result-order=ipv4first" },
  },
});
