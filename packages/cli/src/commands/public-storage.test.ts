import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  LOCAL_HOST_PROTOCOL_VERSION,
  LOCAL_HOST_RECORD_SCHEMA_VERSION,
  type LocalHostDiscoveryRecord,
} from "@clash/shared-runtime";
import { createCliProgram } from "../program";

const originalClashHome = process.env.CLASH_HOME;
const originalClashProfile = process.env.CLASH_PROFILE;

afterEach(() => {
  if (originalClashHome === undefined) delete process.env.CLASH_HOME;
  else process.env.CLASH_HOME = originalClashHome;
  if (originalClashProfile === undefined) delete process.env.CLASH_PROFILE;
  else process.env.CLASH_PROFILE = originalClashProfile;
  vi.restoreAllMocks();
});

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function replyJson(response: ServerResponse, body: unknown): void {
  response.statusCode = 200;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

it("configures TOS through the discovered host without printing credentials", async () => {
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const server = createServer(async (request, response) => {
    requests.push({
      method: request.method ?? "",
      path: request.url ?? "",
      body: JSON.parse(await readRequestBody(request)),
    });
    replyJson(response, {
      capability: "public-asset-storage",
      mode: "byos",
      available: true,
      provider: "tos",
      account_id: null,
      endpoint: null,
      bucket: "clash-001",
      region: "cn-beijing",
      key_prefix: "clash-temporary",
      force_path_style: false,
      has_access_key_id: true,
      has_secret_access_key: true,
      has_session_token: false,
      managed: { available: false, authenticated: false },
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server has no TCP address");
    const clashHome = await mkdtemp(join(tmpdir(), "clash-public-storage-cli-"));
    const runDir = join(clashHome, "run");
    await mkdir(runDir, { recursive: true });
    const record: LocalHostDiscoveryRecord = {
      schemaVersion: LOCAL_HOST_RECORD_SCHEMA_VERSION,
      protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
      dataSchemaVersion: 1,
      hostId: "public-storage-cli-test",
      endpoint: `http://127.0.0.1:${address.port}`,
      pid: process.pid,
      launchMode: "desktop",
      startedBy: "desktop",
      ownerClientId: "desktop-test",
      startedAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
    };
    await writeFile(join(runDir, "host.json"), JSON.stringify(record), "utf8");
    const credentialsFile = join(clashHome, "tos-credentials.txt");
    await writeFile(
      credentialsFile,
      "AccessKeyId: AK_TEST_NEVER_PRINT\nSecretAccessKey: SK_TEST_NEVER_PRINT\n",
      { encoding: "utf8", mode: 0o600 },
    );
    process.env.CLASH_HOME = clashHome;
    process.env.CLASH_PROFILE = "prod";

    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line?: unknown) => output.push(String(line ?? "")));
    vi.spyOn(console, "error").mockImplementation((line?: unknown) => output.push(String(line ?? "")));

    await createCliProgram().exitOverride().parseAsync([
      "host",
      "public-storage",
      "configure",
      "--provider",
      "tos",
      "--bucket",
      "clash-001",
      "--region",
      "cn-beijing",
      "--credentials-file",
      credentialsFile,
      "--json",
    ], { from: "user" });

    expect(requests).toEqual([{
      method: "PATCH",
      path: "/api/v1/local/public-storage",
      body: {
        mode: "byos",
        provider: "tos",
        bucket: "clash-001",
        region: "cn-beijing",
        key_prefix: "clash-temporary",
        force_path_style: false,
        access_key_id: "AK_TEST_NEVER_PRINT",
        secret_access_key: "SK_TEST_NEVER_PRINT",
      },
    }]);
    expect(output.join("\n")).not.toContain("AK_TEST_NEVER_PRINT");
    expect(output.join("\n")).not.toContain("SK_TEST_NEVER_PRINT");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

it("tests the configured backend through the discovered host", async () => {
  const requests: Array<{ method: string; path: string }> = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method ?? "", path: request.url ?? "" });
    replyJson(response, { ok: true });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server has no TCP address");
    const clashHome = await mkdtemp(join(tmpdir(), "clash-public-storage-test-cli-"));
    const runDir = join(clashHome, "run");
    await mkdir(runDir, { recursive: true });
    const record: LocalHostDiscoveryRecord = {
      schemaVersion: LOCAL_HOST_RECORD_SCHEMA_VERSION,
      protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
      dataSchemaVersion: 1,
      hostId: "public-storage-test-cli-test",
      endpoint: `http://127.0.0.1:${address.port}`,
      pid: process.pid,
      launchMode: "desktop",
      startedBy: "desktop",
      ownerClientId: "desktop-test",
      startedAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
    };
    await writeFile(join(runDir, "host.json"), JSON.stringify(record), "utf8");
    process.env.CLASH_HOME = clashHome;
    process.env.CLASH_PROFILE = "prod";

    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line?: unknown) => output.push(String(line ?? "")));

    await createCliProgram().exitOverride().parseAsync([
      "host",
      "public-storage",
      "test",
      "--json",
    ], { from: "user" });

    expect(requests).toEqual([{
      method: "POST",
      path: "/api/v1/local/public-storage/test",
    }]);
    expect(JSON.parse(output.join("\n"))).toEqual({ ok: true });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
