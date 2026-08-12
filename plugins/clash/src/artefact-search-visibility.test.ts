import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(
  dirname(fileURLToPath(new URL("../package.json", import.meta.url))),
  "..",
  "..",
);

/**
 * A bundled artefact must not answer a source search.
 *
 * Committed bundles under `plugins/*<>/runtime/` are the published npm payload -- `runtime` is listed
 * in `files` and both `bin` entries point into it -- so they belong in git. But they are minified
 * copies of the very sources beside them, and a search tool cannot tell the difference: every
 * identifier in the tree appears twice, once where it is defined and once where it was inlined.
 *
 * That symmetry is actively misleading rather than merely noisy, because source and bundle drift.
 * Searching this repo for `list-model-bindings` matched a bundle and implied the IPC protocol
 * handled the operation; the source implemented it zero times, and the bundle was what ran.
 * Searching for `durationFromData(data, card)` matched a *parameter* name inside minified output and
 * sent a reader hunting a call site that has never existed -- the source says `modelCard`.
 *
 * `.ignore` is the fix rather than `.gitignore`: it removes these paths from ripgrep, fd, and the
 * editors that honour it while leaving them tracked and publishable. A deliberate look inside a
 * bundle stays available through `rg --no-ignore-dot`.
 */

function tracked(pattern: string): string[] {
  return execFileSync("git", ["ls-files", pattern], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

function searchable(): string[] {
  // `rg --files` applies the same ignore rules as a content search, so it reports exactly the set a
  // plain `rg <pattern>` would read.
  return execFileSync("rg", ["--files"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
}

function gitIgnored(paths: readonly string[]): string[] {
  // `check-ignore` exits 1 when nothing matches, which is the healthy case here.
  const result = spawnSync("git", ["check-ignore", "--no-index", ...paths], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.ok(
    result.status === 0 || result.status === 1,
    `git check-ignore failed: ${result.stderr}`,
  );
  return result.stdout.split("\n").filter(Boolean);
}

test("committed runtime bundles stay in git", () => {
  // They are the package payload. Removing them from the index would break the CLI, MCP,
  // and internal host shipped by `clash`, so the hazard has to be solved without deleting them.
  const bundles = tracked("plugins/*/runtime/**");
  assert.ok(
    bundles.length > 0,
    "the published runtime payload must remain tracked",
  );

  const manifest = JSON.parse(
    readFileSync(join(repoRoot, "plugins", "clash", "package.json"), "utf8"),
  ) as { files?: string[]; bin?: Record<string, string> };
  assert.ok(
    manifest.files?.includes("runtime"),
    "runtime is published, so it cannot be untracked",
  );
  assert.ok(
    Object.values(manifest.bin ?? {}).some((entry) =>
      entry.includes("runtime/"),
    ),
    "an executable resolves through runtime/, so the directory has to ship",
  );

  // Asserted through `check-ignore` rather than `ls-files`, because git applies `.gitignore` only to
  // untracked paths: moving these rules into `.gitignore` would leave the files listed and the
  // working copy healthy, while silently dropping them from any fresh clone or reset. The distinction
  // between hiding a path from a search tool and dropping it from the repository is the whole point.
  const gitignored = gitIgnored(bundles.slice(0, 40));
  assert.deepEqual(
    gitignored,
    [],
    "the published payload must not be gitignored; use .ignore to hide it from searches",
  );
});

test("no committed runtime bundle is searched by default", () => {
  const visible = new Set(searchable());
  const exposed = tracked("plugins/*/runtime/**").filter((file) =>
    visible.has(file),
  );

  assert.deepEqual(
    exposed,
    [],
    `these bundles answer a plain source search and would report identifiers they only inlined:\n  ${exposed.slice(0, 5).join("\n  ")}`,
  );
});

test("a bundle is still readable when a reader deliberately asks for one", () => {
  // Ignoring a path must not make it unreachable: comparing what shipped against what the source
  // says is exactly how the drift above was eventually found.
  const found = execFileSync(
    "rg",
    [
      "--no-ignore-dot",
      "--files-with-matches",
      "durationFromData",
      "plugins/clash/runtime/local-api.cjs",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  ).trim();

  assert.equal(found, "plugins/clash/runtime/local-api.cjs");
});

test("source is untouched by the ignore rules", () => {
  const visible = new Set(searchable());
  const sources = tracked("*.ts").filter(
    (file) => !file.includes("/runtime/") && existsSync(join(repoRoot, file)),
  );

  const hidden = sources.filter((file) => !visible.has(file));
  assert.deepEqual(
    hidden,
    [],
    "ignoring artefacts must not hide any tracked TypeScript source",
  );
});

test("the emitted agent tree cannot shadow a real source path", () => {
  // `bundle-agents.mjs` copies the plugin into `dist/agents/clash/plugins/clash/`, a path that
  // mirrors the repo's own layout closely enough that a hit there reads as a hit in `plugins/clash`.
  // `dist/` is gitignored, so it is invisible to a default search; this asserts the emitter keeps
  // writing beneath a directory that the ignore rules already cover, instead of somewhere tracked.
  const emitter = readFileSync(
    join(repoRoot, "packages", "cli", "scripts", "bundle-agents.mjs"),
    "utf8",
  );
  assert.match(
    emitter,
    /const DIST = join\(root, "dist", "agents"\)/,
    "the agent tree must be emitted under dist/, which search tools already skip",
  );

  const visible = searchable();
  const leaked = visible.filter((file) => file.includes("dist/agents/"));
  assert.deepEqual(
    leaked,
    [],
    "the emitted agent tree must never be searchable",
  );
});

test("every ignored bundle is genuinely generated", () => {
  // An ignore rule is only safe over regenerable output. If one of these were hand-edited it would
  // become invisible source, which is a worse failure than the one being fixed.
  const scripts = JSON.parse(
    readFileSync(join(repoRoot, "plugins", "clash", "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  assert.match(
    scripts.scripts.clean,
    /rm -rf runtime/,
    "runtime/ must be disposable output",
  );

  const builder = readFileSync(
    join(repoRoot, "plugins", "clash", "scripts", "build-host-runtime.ts"),
    "utf8",
  );
  assert.match(builder, /outfile: resolve\(runtimeDir, "local-api\.cjs"\)/);

  const bundle = statSync(
    join(repoRoot, "plugins", "clash", "runtime", "local-api.cjs"),
  );
  assert.ok(
    bundle.size > 1024 * 1024,
    "a bundle this large is machine-written, not authored",
  );
});

test("a bundle announces itself on its first line", () => {
  // The ignore rules keep bundles out of a search, but a reader who opens one -- or who greps with
  // `--no-ignore-dot` -- still needs to know within one line that this is generated output and where
  // the real code lives. Minified `esbuild` output otherwise begins with anonymous helper
  // declarations that read like source.
  const builder = readFileSync(
    join(repoRoot, "plugins", "clash", "scripts", "build-host-runtime.ts"),
    "utf8",
  );
  assert.match(
    builder,
    /GENERATED FILE -- DO NOT EDIT/,
    "every emitted bundle must carry a banner naming itself as generated",
  );

  for (const bundle of ["local-api.cjs", "clash-cli.cjs"]) {
    const head = readFileSync(
      join(repoRoot, "plugins", "clash", "runtime", bundle),
      "utf8",
    ).slice(0, 400);
    assert.match(
      head,
      /GENERATED FILE -- DO NOT EDIT/,
      `${bundle} must say so before its first statement`,
    );
    assert.match(
      head,
      /build-host-runtime/,
      `${bundle} must name the script that wrote it`,
    );
  }
});
