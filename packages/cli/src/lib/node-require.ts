import { createRequire } from "node:module";

/**
 * A `require` that works in both shapes this package is executed in.
 *
 * The source is authored as ES modules and type-checked as ES2022, but the shipped bundle is
 * CommonJS on purpose: `tsup.config.ts` records that ESM bundling fails at runtime on bundled
 * transitive dependencies which dynamic-require built-in modules. So the same file runs as ESM under `tsx` during
 * development and as CJS from `dist` in production, and neither `require` nor `import.meta` is
 * available in both.
 *
 * A bare `require` is not an option even though the bundle is CJS. In a file that also uses
 * `import`, it leaves the module kind ambiguous: `tsx` refuses such a file outright with
 * ERR_AMBIGUOUS_MODULE_SYNTAX, so a script importing the module cannot run at all -- which is how
 * this was found.
 *
 * `eval("require")` is the fallback rather than a plain reference because a literal `require`
 * identifier is what bundlers and loaders detect and rewrite; hiding it from static analysis is the
 * point. It is only reached in the CJS bundle, where `require` genuinely exists.
 */
export function nodeRequire(): NodeRequire {
  const url = typeof import.meta !== "undefined" ? import.meta.url : undefined;
  if (typeof url === "string" && url) return createRequire(url);
  return eval("require") as NodeRequire;
}
