/**
 * Ambient declarations for transitive imports from @master-clash/api-cf.
 *
 * api-cf's own tsconfig satisfies these via Workers types under
 * `nodejs_compat`. When hosted typechecks, it pulls api-cf source through
 * its own tsconfig and TypeScript re-resolves these specifiers; we relax
 * them here so the wrapper's typecheck stays focused on its own source.
 *
 * Runtime correctness comes from wrangler.toml `nodejs_compat` flag,
 * not from these stubs.
 */
declare module "node:buffer" {
  export const Buffer: typeof globalThis extends { Buffer: infer T } ? T : any;
}
declare module "cloudflare:test";
