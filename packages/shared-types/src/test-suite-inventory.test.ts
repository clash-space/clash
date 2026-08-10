import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..');

/**
 * A package with tests must have a way to run them, and must not run its own build output.
 *
 * Two failure modes, both silent, both found in this repo:
 *
 * - `action-sdk` and `clash-sdk/js` had test files, no `test` script, and no test runner in their
 *   dependencies. Thirteen assertions had never executed. Nothing was red, because nothing ran.
 * - `apps/web` had no vitest `include`. vitest's defaults exclude `dist` but not `.next`, which is
 *   where this app builds, so a compiled chunk matching `*.test.*` is collected: a planted file
 *   under `.next/server/chunks/` executed and failed the suite. A stale build could equally
 *   contribute a pass nobody wrote.
 *
 * Asserting on discovery is itself a trap -- if the walk returns nothing, every filter below is
 * vacuously satisfied and the guard passes while checking nothing. The sentinel guards the guard.
 */
const BUILD_DIRS = ['dist', '.next', 'build', 'out', '.turbo', 'coverage'];

function packageDirs(): string[] {
  const roots = ['packages', 'apps', 'plugins'];
  const found: string[] = [];
  for (const root of roots) {
    const rootPath = join(repoRoot, root);
    if (!existsSync(rootPath)) continue;
    for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const dir = join(rootPath, entry.name);
      if (existsSync(join(dir, 'package.json'))) found.push(dir);
      else {
        // One level deeper for grouped workspaces such as `packages/clash-sdk/js`.
        for (const nested of readdirSync(dir, { withFileTypes: true })) {
          if (!nested.isDirectory() || nested.name.startsWith('.')) continue;
          const nestedDir = join(dir, nested.name);
          if (existsSync(join(nestedDir, 'package.json'))) found.push(nestedDir);
        }
      }
    }
  }
  return found;
}

function testFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || BUILD_DIRS.includes(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.test\.(ts|tsx|mts)$/.test(entry.name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

describe('test suite inventory', () => {
  const packages = packageDirs().map(dir => ({
    dir,
    manifest: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      name?: string;
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    },
    tests: testFiles(dir),
  }));

  it('discovered a plausible number of packages and tests', () => {
    // Without this the filters below are vacuous, which is exactly how a guard passes while
    // checking nothing.
    expect(packages.length).toBeGreaterThan(15);
    expect(packages.reduce((total, entry) => total + entry.tests.length, 0)).toBeGreaterThan(100);
  });

  it('gives every package with tests a test script', () => {
    const orphans = packages
      .filter(entry => entry.tests.length > 0 && !entry.manifest.scripts?.test)
      .map(entry => entry.manifest.name ?? entry.dir);
    expect(orphans, 'these packages hold tests nothing runs').toEqual([]);
  });

  it('gives every package with tests a runner it can resolve', () => {
    const missing = packages
      .filter(entry => entry.tests.length > 0)
      .filter(entry => {
        const script = entry.manifest.scripts?.test ?? '';
        // Node's own runner needs no dependency, however it is invoked -- `node --test`,
        // `node --import tsx --test`, or a script that drives it.
        if (/\bnode\b[^&|]*--test\b/.test(script) || script.includes('run-tests')) return false;
        const deps = { ...entry.manifest.dependencies, ...entry.manifest.devDependencies };
        return !Object.keys(deps).some(name => name === 'vitest' || name === 'jest');
      })
      .map(entry => entry.manifest.name ?? entry.dir);
    expect(missing, 'these packages name a runner they do not depend on').toEqual([]);
  });

  it('keeps build output out of every vitest config', () => {
    const unscoped = packages
      .filter(entry => existsSync(join(entry.dir, 'vitest.config.ts')))
      .filter(entry => {
        const config = readFileSync(join(entry.dir, 'vitest.config.ts'), 'utf8');
        if (/exclude\s*:/.test(config)) return false;
        const include = /include\s*:\s*\[([^\]]*)\]/s.exec(config);
        if (!include) return true;
        // An include rooted at a source directory cannot reach a build output.
        return !/["'`](src|app|lib|test|scripts|\*)/.test(include[1]);
      })
      .map(entry => entry.manifest.name ?? entry.dir);
    expect(unscoped, 'these configs can collect their own build output').toEqual([]);
  });
});
