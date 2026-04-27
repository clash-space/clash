#!/usr/bin/env node
/**
 * Direct npm-registry publish, bypassing `npm publish`.
 *
 * `npm publish` (and `pnpm publish`) consistently uploaded a 2KB
 * LICENSE+package.json tarball for this package even when given an
 * explicitly verified 11KB tarball with dist/cli.js. Five attempts,
 * all failed identically (beta.{1,2,3,4,5}). The pack notice always
 * showed the right contents — but what landed on registry was wrong.
 *
 * Bypass the npm CLI entirely: read the verified tarball, build the
 * registry's expected JSON envelope, PUT directly. Documented here:
 * https://github.com/npm/registry/blob/master/docs/REGISTRY-API.md#publish
 *
 * Usage (from packages/clash-bridge/, with NPM_TOKEN env set):
 *   node scripts/publish.mjs <path-to-tarball> --tag beta
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { argv, env, exit } from "node:process";

function fail(msg) {
  process.stderr.write(`✗ ${msg}\n`);
  exit(1);
}

const tarballPath = argv[2];
const tagFlag = argv.indexOf("--tag");
const tag = tagFlag !== -1 ? argv[tagFlag + 1] : "latest";

if (!tarballPath) fail("usage: publish.mjs <tarball.tgz> [--tag beta]");
if (!env.NPM_TOKEN && !env.NODE_AUTH_TOKEN) fail("NPM_TOKEN env var required");

const token = env.NPM_TOKEN ?? env.NODE_AUTH_TOKEN;

const tarball = await readFile(tarballPath);
const pkg = JSON.parse(await readFile("./package.json", "utf-8"));

// `private: true` is a CLI-side guard to stop `npm publish` from running.
// The registry doesn't enforce it, but its presence in version metadata
// would be confusing. Strip before building the envelope. We rely on
// `private: true` in package.json to make `pnpm -r publish` (run by the
// changesets release workflow) skip this package — only this script,
// invoked by the manual publish-beta workflow, is allowed to publish it.
delete pkg.private;

const { name, version } = pkg;
if (!name || !version) fail("package.json missing name or version");

// SHA-1 (legacy) + SHA-512 base64 (modern integrity) — registry accepts both
// but won't accept upload without integrity for new packages.
const shasum = createHash("sha1").update(tarball).digest("hex");
const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
const tarballName = `${name.replace(/^@.+\//, "")}-${version}.tgz`;
const registryUrl = "https://registry.npmjs.org";
const tarballUrl = `${registryUrl}/${name}/-/${tarballName}`;

// Build the registry envelope. Matches what `npm publish` would normally
// PUT — verified against npm-registry-fetch source. The "_attachments"
// keyed by tarball filename carries the binary as base64.
const body = {
  _id: name,
  name,
  "dist-tags": { [tag]: version },
  versions: {
    [version]: {
      ...pkg,
      _id: `${name}@${version}`,
      dist: {
        shasum,
        integrity,
        tarball: tarballUrl,
      },
    },
  },
  _attachments: {
    [tarballName]: {
      content_type: "application/octet-stream",
      data: tarball.toString("base64"),
      length: tarball.byteLength,
    },
  },
};

process.stderr.write(
  `→ PUT ${registryUrl}/${encodeURIComponent(name)}\n` +
    `  version: ${version}, tag: ${tag}\n` +
    `  tarball: ${tarball.byteLength} bytes, sha1=${shasum.slice(0, 12)}…\n`,
);

const res = await fetch(`${registryUrl}/${encodeURIComponent(name)}`, {
  method: "PUT",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  },
  body: JSON.stringify(body),
});

const text = await res.text();
if (!res.ok) {
  fail(`registry returned ${res.status}: ${text}`);
}
process.stderr.write(`✓ published ${name}@${version} (tag: ${tag})\n`);
