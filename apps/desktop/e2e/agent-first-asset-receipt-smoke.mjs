import { mkdir, stat, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "..", "..");
const runId = process.env.CLASH_ASSET_RECEIPT_RUN_ID || new Date().toISOString().replace(/[:.]/g, "-");
const artifactRoot = path.resolve(
  process.env.CLASH_ASSET_RECEIPT_ARTIFACT_ROOT ||
    path.join(repoRoot, ".tmp", "agent-first-asset-receipts", runId),
);
const dataDir = path.join(artifactRoot, "local-api-data");
const reportPath = path.join(artifactRoot, "agent-first-asset-receipt-report.json");

const checks = [];

function now() {
  return new Date().toISOString();
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function recordCheck(name, pass, evidence, extra = {}) {
  checks.push({
    name,
    status: pass ? "pass" : "fail",
    observedAt: now(),
    evidence,
    ...extra,
  });
  if (!pass) {
    throw new Error(`${name}: ${evidence}`);
  }
}

function baseReadToken(readToken) {
  const marker = ":receipt:";
  const receiptAt = typeof readToken === "string" ? readToken.indexOf(marker) : -1;
  return receiptAt === -1 ? readToken : readToken.slice(0, receiptAt);
}

function hasReceipt(readToken, namespace) {
  return (
    typeof readToken === "string" &&
    readToken.startsWith(`${namespace}-v1:`) &&
    readToken.includes(":receipt:")
  );
}

function appRequest(app) {
  return async (pathname, init = {}) => {
    const headers = new Headers(init.headers ?? {});
    const isFormDataBody = typeof FormData !== "undefined" && init.body instanceof FormData;
    if (init.body != null && !headers.has("content-type") && !isFormDataBody) {
      headers.set("content-type", "application/json");
    }
    return app.request(pathname, { ...init, headers });
  };
}

function sqliteCount(sql, params = []) {
  const db = new DatabaseSync(path.join(dataDir, "local.sqlite"));
  try {
    return db.prepare(sql).get(...params)?.count ?? 0;
  } finally {
    db.close();
  }
}

async function pathIsMissing(filePath) {
  try {
    await stat(filePath);
    return false;
  } catch (error) {
    return error?.code === "ENOENT";
  }
}

async function parseJsonResponse(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function expectRejected(name, action, expectedMessages) {
  const expected = Array.isArray(expectedMessages) ? expectedMessages : [expectedMessages];
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordCheck(
      name,
      expected.every((expectedMessage) => message.includes(expectedMessage)),
      message,
      { expectedMessages: expected },
    );
    return message;
  }
  recordCheck(name, false, "command unexpectedly succeeded", { expectedMessages: expected });
  return "";
}

async function main() {
  await mkdir(dataDir, { recursive: true });
  const startedAt = now();
  const { createLocalApiApp } = await import("../../local-api/src/app.ts");
  const { createLocalAudioConfigStore } = await import("../../local-api/src/audio-config.ts");
  const { FileReplicaStore } = await import("../../local-api/src/loro/file-replica-store.ts");
  const {
    deleteAssetProjectRef,
    fetchAssetProjectRef,
    fetchAssetRecord,
    updateAssetCover,
    runAssetGarbageCollection,
  } = await import("../../../packages/cli/src/commands/assets.ts");

  let enabledHarnessIds = ["codex-acp"];
  let geminiInstalled = false;
  let audioInstalled = false;
  let oauthStartCount = 0;
  const audioConfig = createLocalAudioConfigStore({
    dataDir,
    builtinStatus: async () => ({ available: audioInstalled, message: audioInstalled ? undefined : "FunASR is not installed" }),
    builtinInstall: async () => {
      audioInstalled = true;
    },
    builtinTranscribe: async (input) => ({
      text: `transcribed:${input.model}:${input.file.name}:${input.language ?? "auto"}`,
    }),
  });
  const harnessRows = () => [
    {
      id: "codex-acp",
      label: "Codex",
      binary: "codex-acp",
      enabled: enabledHarnessIds.includes("codex-acp"),
      available: true,
    },
    {
      id: "claude-acp",
      label: "Claude",
      binary: "claude-agent-acp",
      enabled: enabledHarnessIds.includes("claude-acp"),
      available: true,
    },
    {
      id: "gemini",
      label: "Gemini",
      binary: "gemini",
      enabled: false,
      available: geminiInstalled,
      installed: geminiInstalled,
      installable: true,
      installSource: "registry",
      installedVersion: geminiInstalled ? "1.1.0" : undefined,
      latestVersion: "1.1.0",
    },
  ];
  let agentServers = {
    "OpenClaw ACP": {
      type: "custom",
      command: "openclaw",
      args: ["acp"],
      env: {},
    },
  };
  const app = createLocalApiApp({
    dataDir,
    userId: "asset-receipt-smoke-user",
    audioConfig,
    localAcp: {
      async listRuntimes() {
        return { runtimes: [] };
      },
	      async createSession() {
	        return { session_id: "local-session-existing" };
	      },
	      async attachSession(params) {
	        return { session_id: params.sessionId };
	      },
	      async listResumeSessions() {
	        return { sessions: [] };
	      },
      async listHarnesses() {
        return { harnesses: harnessRows() };
      },
      async updateHarnesses(ids) {
        enabledHarnessIds = ids;
        return { harnesses: harnessRows() };
      },
      async installHarness() {
        geminiInstalled = true;
        return { harnesses: harnessRows() };
      },
      async uninstallHarness() {
        geminiInstalled = false;
        return { harnesses: harnessRows() };
      },
      async listAgentServers() {
        return { agent_servers: agentServers };
      },
      async updateAgentServers(servers) {
        agentServers = servers;
        return {
          agent_servers: agentServers,
          harnesses: [{ id: "custom-openclaw-acp", custom: true }],
        };
      },
    },
    providerOAuth: {
      dreamina: {
        start: async () => {
          oauthStartCount += 1;
          return {
            verificationUri: "https://jimeng.jianying.com/device",
            userCode: `SMOKE-CODE-${oauthStartCount}`,
            deviceCode: `device-code-smoke-${oauthStartCount}`,
            expiresAt: "2026-06-26T03:00:00.000Z",
            intervalSeconds: 5,
          };
        },
        complete: async () => ({
          accessToken: "access-token-smoke",
          refreshToken: "refresh-token-smoke",
          expiresAt: "2026-06-27T03:00:00.000Z",
          accountLabel: "Smoke Dreamina",
        }),
      },
    },
  });
  const request = appRequest(app);
  const projectId = "project-asset-receipt-smoke";
  const agentEnv = { CLASH_AGENT_MEMBER_ID: "asset-receipt-smoke-agent" };

  const agentReadOnlyProjectResponse = await request("/api/v1/projects", {
    method: "POST",
    body: JSON.stringify({ name: "Agent read-only smoke" }),
  });
  const agentReadOnlyProject = await parseJsonResponse(agentReadOnlyProjectResponse);
  recordCheck(
    "project create initializes metadata before agents read-only smoke",
    agentReadOnlyProjectResponse.status === 201 && agentReadOnlyProject.mutation?.accepted === true,
    JSON.stringify(agentReadOnlyProject),
    { mutation: agentReadOnlyProject.mutation },
  );

  const agentsResponse = await request("/api/v1/agents");
  const agentsJson = await parseJsonResponse(agentsResponse);
  recordCheck(
    "agents read returns derived built-in members",
    agentsResponse.status === 200 &&
      agentsJson.agents?.some((agent) => agent.id === "local-master-clash" && agent.template_id === "master-clash"),
    JSON.stringify(agentsJson),
  );
  const persistedAgentMembersAfterRead = sqliteCount("SELECT COUNT(*) AS count FROM agent_member");
  recordCheck(
    "agents read does not persist derived built-in members",
    persistedAgentMembersAfterRead === 0,
    JSON.stringify({ count: persistedAgentMembersAfterRead }),
  );

  const initialSyncResponse = await request("/api/v1/local/sync");
  const initialSync = await parseJsonResponse(initialSyncResponse);
  recordCheck(
    "sync config get returns receipt read token",
    hasReceipt(initialSync.readToken, "local-config"),
    initialSync.readToken ?? JSON.stringify(initialSync),
  );

  const missingSyncUpdate = await request("/api/v1/local/sync", {
    method: "PATCH",
    headers: { "x-clash-client-type": "agent" },
    body: JSON.stringify({
      mode: "cloud-sync",
      remote_loro_url: "https://cloud.example",
    }),
  });
  const missingSyncUpdateJson = await parseJsonResponse(missingSyncUpdate);
  recordCheck(
    "sync config update without prior read is rejected",
    missingSyncUpdate.status === 409 &&
      /Missing local sync config update read proof for agent/.test(missingSyncUpdateJson.error ?? ""),
    JSON.stringify(missingSyncUpdateJson),
    { mutation: missingSyncUpdateJson.mutation },
  );

  const bareSyncUpdate = await request("/api/v1/local/sync", {
    method: "PATCH",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": baseReadToken(initialSync.readToken),
    },
    body: JSON.stringify({
      mode: "cloud-sync",
      remote_loro_url: "https://cloud.example",
    }),
  });
  const bareSyncUpdateJson = await parseJsonResponse(bareSyncUpdate);
  recordCheck(
    "sync config update with bare CAS token is rejected",
    bareSyncUpdate.status === 409 &&
      /Missing local sync config update read receipt for agent/.test(bareSyncUpdateJson.error ?? ""),
    JSON.stringify(bareSyncUpdateJson),
    { mutation: bareSyncUpdateJson.mutation },
  );

  await request("/api/v1/local/sync", {
    method: "PATCH",
    body: JSON.stringify({
      mode: "cloud-sync",
      remote_loro_url: "https://first-cloud.example",
    }),
  });
  const staleSyncUpdate = await request("/api/v1/local/sync", {
    method: "PATCH",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": initialSync.readToken,
    },
    body: JSON.stringify({
      mode: "cloud-sync",
      remote_loro_url: "https://second-cloud.example",
    }),
  });
  const staleSyncUpdateJson = await parseJsonResponse(staleSyncUpdate);
  recordCheck(
    "sync config update with stale receipt is rejected",
    staleSyncUpdate.status === 409 &&
      /Stale local sync config update rejected/.test(staleSyncUpdateJson.error ?? ""),
    JSON.stringify(staleSyncUpdateJson),
    { mutation: staleSyncUpdateJson.mutation },
  );

  const currentSyncResponse = await request("/api/v1/local/sync");
  const currentSync = await parseJsonResponse(currentSyncResponse);
  const acceptedSyncUpdate = await request("/api/v1/local/sync", {
    method: "PATCH",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": currentSync.readToken,
    },
    body: JSON.stringify({
      mode: "cloud-sync",
      remote_loro_url: "https://second-cloud.example",
    }),
  });
  const acceptedSyncUpdateJson = await parseJsonResponse(acceptedSyncUpdate);
  recordCheck(
    "sync config update with receipt read token is accepted",
    acceptedSyncUpdate.status === 200 &&
      acceptedSyncUpdateJson.mutation?.accepted === true &&
      hasReceipt(acceptedSyncUpdateJson.readToken, "local-config"),
    JSON.stringify(acceptedSyncUpdateJson),
    { mutation: acceptedSyncUpdateJson.mutation },
  );

  const initialAudioResponse = await request("/api/v1/local/audio");
  const initialAudio = await parseJsonResponse(initialAudioResponse);
  recordCheck(
    "audio config get returns receipt read token",
    hasReceipt(initialAudio.readToken, "local-config"),
    initialAudio.readToken ?? JSON.stringify(initialAudio),
  );

  const missingAudioUpdate = await request("/api/v1/local/audio", {
    method: "PATCH",
    headers: { "x-clash-client-type": "agent" },
    body: JSON.stringify({
      asr_enabled: true,
      asr_model: "iic/SenseVoiceSmall",
    }),
  });
  const missingAudioUpdateJson = await parseJsonResponse(missingAudioUpdate);
  recordCheck(
    "audio config update without prior read is rejected",
    missingAudioUpdate.status === 409 &&
      /Missing local audio config update read proof for agent/.test(missingAudioUpdateJson.error ?? ""),
    JSON.stringify(missingAudioUpdateJson),
    { mutation: missingAudioUpdateJson.mutation },
  );

  const bareAudioUpdate = await request("/api/v1/local/audio", {
    method: "PATCH",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": baseReadToken(initialAudio.readToken),
    },
    body: JSON.stringify({
      asr_enabled: true,
      asr_model: "iic/SenseVoiceSmall",
    }),
  });
  const bareAudioUpdateJson = await parseJsonResponse(bareAudioUpdate);
  recordCheck(
    "audio config update with bare CAS token is rejected",
    bareAudioUpdate.status === 409 &&
      /Missing local audio config update read receipt for agent/.test(bareAudioUpdateJson.error ?? ""),
    JSON.stringify(bareAudioUpdateJson),
    { mutation: bareAudioUpdateJson.mutation },
  );

  await request("/api/v1/local/audio", {
    method: "PATCH",
    body: JSON.stringify({
      asr_enabled: true,
      asr_model: "iic/SenseVoiceSmall",
    }),
  });
  const staleAudioUpdate = await request("/api/v1/local/audio", {
    method: "PATCH",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": initialAudio.readToken,
    },
    body: JSON.stringify({
      asr_enabled: false,
      asr_model: "iic/SenseVoiceSmall",
    }),
  });
  const staleAudioUpdateJson = await parseJsonResponse(staleAudioUpdate);
  recordCheck(
    "audio config update with stale receipt is rejected",
    staleAudioUpdate.status === 409 &&
      /Stale local audio config update rejected/.test(staleAudioUpdateJson.error ?? ""),
    JSON.stringify(staleAudioUpdateJson),
    { mutation: staleAudioUpdateJson.mutation },
  );

  const currentAudioResponse = await request("/api/v1/local/audio");
  const currentAudio = await parseJsonResponse(currentAudioResponse);
  const acceptedAudioUpdate = await request("/api/v1/local/audio", {
    method: "PATCH",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": currentAudio.readToken,
    },
    body: JSON.stringify({
      asr_enabled: false,
      asr_model: "iic/SenseVoiceSmall",
    }),
  });
  const acceptedAudioUpdateJson = await parseJsonResponse(acceptedAudioUpdate);
  recordCheck(
    "audio config update with receipt read token is accepted",
    acceptedAudioUpdate.status === 200 &&
      acceptedAudioUpdateJson.mutation?.accepted === true &&
      hasReceipt(acceptedAudioUpdateJson.readToken, "local-config"),
    JSON.stringify(acceptedAudioUpdateJson),
    { mutation: acceptedAudioUpdateJson.mutation },
  );

  const missingAudioInstall = await request("/api/v1/local/audio/install", {
    method: "POST",
    headers: { "x-clash-client-type": "agent" },
    body: JSON.stringify({ asr_model: "iic/SenseVoiceSmall" }),
  });
  const missingAudioInstallJson = await parseJsonResponse(missingAudioInstall);
  recordCheck(
    "audio install without prior read is rejected",
    missingAudioInstall.status === 409 &&
      /Missing local audio model install read proof for agent/.test(missingAudioInstallJson.error ?? ""),
    JSON.stringify(missingAudioInstallJson),
    { mutation: missingAudioInstallJson.mutation },
  );

  const bareAudioInstall = await request("/api/v1/local/audio/install", {
    method: "POST",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": baseReadToken(acceptedAudioUpdateJson.readToken),
    },
    body: JSON.stringify({ asr_model: "iic/SenseVoiceSmall" }),
  });
  const bareAudioInstallJson = await parseJsonResponse(bareAudioInstall);
  recordCheck(
    "audio install with bare CAS token is rejected",
    bareAudioInstall.status === 409 &&
      /Missing local audio model install read receipt for agent/.test(bareAudioInstallJson.error ?? ""),
    JSON.stringify(bareAudioInstallJson),
    { mutation: bareAudioInstallJson.mutation },
  );

  const acceptedAudioInstall = await request("/api/v1/local/audio/install", {
    method: "POST",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": acceptedAudioUpdateJson.readToken,
    },
    body: JSON.stringify({ asr_model: "iic/SenseVoiceSmall" }),
  });
  const acceptedAudioInstallJson = await parseJsonResponse(acceptedAudioInstall);
  recordCheck(
    "audio install with receipt read token is accepted",
    acceptedAudioInstall.status === 200 &&
      acceptedAudioInstallJson.mutation?.accepted === true &&
      hasReceipt(acceptedAudioInstallJson.readToken, "local-config") &&
      acceptedAudioInstallJson.readToken !== acceptedAudioUpdateJson.readToken &&
      acceptedAudioInstallJson.asr?.setup?.available === true,
    JSON.stringify(acceptedAudioInstallJson),
    { mutation: acceptedAudioInstallJson.mutation },
  );

  const staleAudioInstall = await request("/api/v1/local/audio/install", {
    method: "POST",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": acceptedAudioUpdateJson.readToken,
    },
    body: JSON.stringify({ asr_model: "iic/SenseVoiceSmall" }),
  });
  const staleAudioInstallJson = await parseJsonResponse(staleAudioInstall);
  recordCheck(
    "audio install with stale receipt is rejected",
    staleAudioInstall.status === 409 &&
      /Stale local audio model install rejected/.test(staleAudioInstallJson.error ?? ""),
    JSON.stringify(staleAudioInstallJson),
    { mutation: staleAudioInstallJson.mutation },
  );

  await request("/api/v1/local/audio", {
    method: "PATCH",
    body: JSON.stringify({
      asr_enabled: true,
      asr_model: "iic/SenseVoiceSmall",
    }),
  });
  const audioTranscriptionForm = new FormData();
  audioTranscriptionForm.append("file", new File(["voice-bytes"], "voice.webm", { type: "audio/webm" }));
  const audioTranscriptionResponse = await request("/api/v1/local/audio/transcriptions", {
    method: "POST",
    body: audioTranscriptionForm,
  });
  const audioTranscriptionJson = await parseJsonResponse(audioTranscriptionResponse);
  recordCheck(
    "audio transcription action returns host mutation record",
    audioTranscriptionResponse.status === 200 &&
      audioTranscriptionJson.text === "transcribed:iic/SenseVoiceSmall:voice.webm:auto" &&
      audioTranscriptionJson.mutation?.operation === "local_audio_transcription" &&
      audioTranscriptionJson.mutation?.accepted === true,
    JSON.stringify(audioTranscriptionJson),
    { mutation: audioTranscriptionJson.mutation },
  );

  const initialHarnessesResponse = await request("/api/v1/local/harnesses");
  const initialHarnesses = await parseJsonResponse(initialHarnessesResponse);
  recordCheck(
    "local harnesses get returns receipt read token",
    hasReceipt(initialHarnesses.readToken, "local-config"),
    initialHarnesses.readToken ?? JSON.stringify(initialHarnesses),
  );

  const missingHarnessUpdate = await request("/api/v1/local/harnesses", {
    method: "PUT",
    headers: { "x-clash-client-type": "agent" },
    body: JSON.stringify({ enabled_harness_ids: ["claude-acp"] }),
  });
  const missingHarnessUpdateJson = await parseJsonResponse(missingHarnessUpdate);
  recordCheck(
    "local harness enablement update without prior read is rejected",
    missingHarnessUpdate.status === 409 &&
      /Missing local harness enablement update read proof for agent/.test(missingHarnessUpdateJson.error ?? ""),
    JSON.stringify(missingHarnessUpdateJson),
    { mutation: missingHarnessUpdateJson.mutation },
  );

  const bareHarnessUpdate = await request("/api/v1/local/harnesses", {
    method: "PUT",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": baseReadToken(initialHarnesses.readToken),
    },
    body: JSON.stringify({ enabled_harness_ids: ["claude-acp"] }),
  });
  const bareHarnessUpdateJson = await parseJsonResponse(bareHarnessUpdate);
  recordCheck(
    "local harness enablement update with bare CAS token is rejected",
    bareHarnessUpdate.status === 409 &&
      /Missing local harness enablement update read receipt for agent/.test(bareHarnessUpdateJson.error ?? ""),
    JSON.stringify(bareHarnessUpdateJson),
    { mutation: bareHarnessUpdateJson.mutation },
  );

  await request("/api/v1/local/harnesses", {
    method: "PUT",
    body: JSON.stringify({ enabled_harness_ids: ["codex-acp", "claude-acp"] }),
  });
  const staleHarnessUpdate = await request("/api/v1/local/harnesses", {
    method: "PUT",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": initialHarnesses.readToken,
    },
    body: JSON.stringify({ enabled_harness_ids: ["claude-acp"] }),
  });
  const staleHarnessUpdateJson = await parseJsonResponse(staleHarnessUpdate);
  recordCheck(
    "local harness enablement update with stale receipt is rejected",
    staleHarnessUpdate.status === 409 &&
      /Stale local harness enablement update rejected/.test(staleHarnessUpdateJson.error ?? ""),
    JSON.stringify(staleHarnessUpdateJson),
    { mutation: staleHarnessUpdateJson.mutation },
  );

  const currentHarnessesResponse = await request("/api/v1/local/harnesses");
  const currentHarnesses = await parseJsonResponse(currentHarnessesResponse);
  const acceptedHarnessUpdate = await request("/api/v1/local/harnesses", {
    method: "PUT",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": currentHarnesses.readToken,
    },
    body: JSON.stringify({ enabled_harness_ids: ["claude-acp"] }),
  });
  const acceptedHarnessUpdateJson = await parseJsonResponse(acceptedHarnessUpdate);
  recordCheck(
    "local harness enablement update with receipt read token is accepted",
    acceptedHarnessUpdate.status === 200 &&
      acceptedHarnessUpdateJson.mutation?.accepted === true &&
      hasReceipt(acceptedHarnessUpdateJson.readToken, "local-config") &&
      acceptedHarnessUpdateJson.harnesses?.find((row) => row.id === "claude-acp")?.enabled === true,
    JSON.stringify(acceptedHarnessUpdateJson),
    { mutation: acceptedHarnessUpdateJson.mutation },
  );

  const missingHarnessInstall = await request("/api/v1/local/harnesses/gemini/install", {
    method: "POST",
    headers: { "x-clash-client-type": "agent" },
  });
  const missingHarnessInstallJson = await parseJsonResponse(missingHarnessInstall);
  recordCheck(
    "local harness install without prior read is rejected",
    missingHarnessInstall.status === 409 &&
      /Missing local harness install read proof for agent/.test(missingHarnessInstallJson.error ?? ""),
    JSON.stringify(missingHarnessInstallJson),
    { mutation: missingHarnessInstallJson.mutation },
  );

  const bareHarnessInstall = await request("/api/v1/local/harnesses/gemini/install", {
    method: "POST",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": baseReadToken(acceptedHarnessUpdateJson.readToken),
    },
  });
  const bareHarnessInstallJson = await parseJsonResponse(bareHarnessInstall);
  recordCheck(
    "local harness install with bare CAS token is rejected",
    bareHarnessInstall.status === 409 &&
      /Missing local harness install read receipt for agent/.test(bareHarnessInstallJson.error ?? ""),
    JSON.stringify(bareHarnessInstallJson),
    { mutation: bareHarnessInstallJson.mutation },
  );

  const acceptedHarnessInstall = await request("/api/v1/local/harnesses/gemini/install", {
    method: "POST",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": acceptedHarnessUpdateJson.readToken,
    },
  });
  const acceptedHarnessInstallJson = await parseJsonResponse(acceptedHarnessInstall);
  recordCheck(
    "local harness install with receipt read token is accepted",
    acceptedHarnessInstall.status === 200 &&
      acceptedHarnessInstallJson.mutation?.accepted === true &&
      hasReceipt(acceptedHarnessInstallJson.readToken, "local-config") &&
      acceptedHarnessInstallJson.readToken !== acceptedHarnessUpdateJson.readToken &&
      acceptedHarnessInstallJson.harnesses?.find((row) => row.id === "gemini")?.installed === true,
    JSON.stringify(acceptedHarnessInstallJson),
    { mutation: acceptedHarnessInstallJson.mutation },
  );

  const staleHarnessUninstall = await request("/api/v1/local/harnesses/gemini/install", {
    method: "DELETE",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": acceptedHarnessUpdateJson.readToken,
    },
  });
  const staleHarnessUninstallJson = await parseJsonResponse(staleHarnessUninstall);
  recordCheck(
    "local harness uninstall with stale receipt is rejected",
    staleHarnessUninstall.status === 409 &&
      /Stale local harness uninstall rejected/.test(staleHarnessUninstallJson.error ?? ""),
    JSON.stringify(staleHarnessUninstallJson),
    { mutation: staleHarnessUninstallJson.mutation },
  );

  const initialAgentServersResponse = await request("/api/v1/local/agent-servers");
  const initialAgentServers = await parseJsonResponse(initialAgentServersResponse);
  recordCheck(
    "local agent servers get returns receipt read token",
    hasReceipt(initialAgentServers.readToken, "local-config"),
    initialAgentServers.readToken ?? JSON.stringify(initialAgentServers),
  );

  const nextAgentServers = {
    "OpenClaw ACP": {
      type: "custom",
      command: "openclaw",
      args: ["acp", "--session", "agent:design:main"],
      env: {},
    },
  };
  const missingAgentServersUpdate = await request("/api/v1/local/agent-servers", {
    method: "PUT",
    headers: { "x-clash-client-type": "agent" },
    body: JSON.stringify({ agent_servers: nextAgentServers }),
  });
  const missingAgentServersUpdateJson = await parseJsonResponse(missingAgentServersUpdate);
  recordCheck(
    "local agent servers update without prior read is rejected",
    missingAgentServersUpdate.status === 409 &&
      /Missing local agent servers update read proof for agent/.test(missingAgentServersUpdateJson.error ?? ""),
    JSON.stringify(missingAgentServersUpdateJson),
    { mutation: missingAgentServersUpdateJson.mutation },
  );

  const bareAgentServersUpdate = await request("/api/v1/local/agent-servers", {
    method: "PUT",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": baseReadToken(initialAgentServers.readToken),
    },
    body: JSON.stringify({ agent_servers: nextAgentServers }),
  });
  const bareAgentServersUpdateJson = await parseJsonResponse(bareAgentServersUpdate);
  recordCheck(
    "local agent servers update with bare CAS token is rejected",
    bareAgentServersUpdate.status === 409 &&
      /Missing local agent servers update read receipt for agent/.test(bareAgentServersUpdateJson.error ?? ""),
    JSON.stringify(bareAgentServersUpdateJson),
    { mutation: bareAgentServersUpdateJson.mutation },
  );

  await request("/api/v1/local/agent-servers", {
    method: "PUT",
    body: JSON.stringify({
      agent_servers: {
        "OpenClaw ACP": {
          type: "custom",
          command: "openclaw",
          args: ["acp", "--human"],
          env: {},
        },
      },
    }),
  });
  const staleAgentServersUpdate = await request("/api/v1/local/agent-servers", {
    method: "PUT",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": initialAgentServers.readToken,
    },
    body: JSON.stringify({ agent_servers: nextAgentServers }),
  });
  const staleAgentServersUpdateJson = await parseJsonResponse(staleAgentServersUpdate);
  recordCheck(
    "local agent servers update with stale receipt is rejected",
    staleAgentServersUpdate.status === 409 &&
      /Stale local agent servers update rejected/.test(staleAgentServersUpdateJson.error ?? ""),
    JSON.stringify(staleAgentServersUpdateJson),
    { mutation: staleAgentServersUpdateJson.mutation },
  );

  const currentAgentServersResponse = await request("/api/v1/local/agent-servers");
  const currentAgentServers = await parseJsonResponse(currentAgentServersResponse);
  const acceptedAgentServersUpdate = await request("/api/v1/local/agent-servers", {
    method: "PUT",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": currentAgentServers.readToken,
    },
    body: JSON.stringify({ agent_servers: nextAgentServers }),
  });
  const acceptedAgentServersUpdateJson = await parseJsonResponse(acceptedAgentServersUpdate);
  recordCheck(
    "local agent servers update with receipt read token is accepted",
    acceptedAgentServersUpdate.status === 200 &&
      acceptedAgentServersUpdateJson.mutation?.accepted === true &&
      hasReceipt(acceptedAgentServersUpdateJson.readToken, "local-config") &&
      JSON.stringify(acceptedAgentServersUpdateJson.agent_servers) === JSON.stringify(nextAgentServers),
    JSON.stringify(acceptedAgentServersUpdateJson),
    { mutation: acceptedAgentServersUpdateJson.mutation },
  );

  await request("/api/v1/model-providers", {
    method: "PATCH",
    body: JSON.stringify({
      providers: [
        {
          id: "replicate-primary",
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          weight: 10,
          credentials: { apiKey: "r8-provider-receipt-primary" },
        },
        {
          id: "replicate-secondary",
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          weight: 5,
          credentials: { apiKey: "r8-provider-receipt-secondary" },
        },
      ],
    }),
  });
  const initialProviderResponse = await request("/api/v1/model-providers");
  const initialProviderConfig = await parseJsonResponse(initialProviderResponse);
  const initialPrimaryProvider = initialProviderConfig.providers?.find((provider) => provider.id === "replicate-primary");
  recordCheck(
    "provider accounts get returns collection receipt read token",
    hasReceipt(initialProviderConfig.readToken, "provider-accounts"),
    initialProviderConfig.readToken ?? JSON.stringify(initialProviderConfig),
  );
  recordCheck(
    "provider account get returns account receipt read token",
    hasReceipt(initialPrimaryProvider?.readToken, "provider-account"),
    initialPrimaryProvider?.readToken ?? JSON.stringify(initialProviderConfig),
  );

  const missingProviderUpdate = await request("/api/v1/model-providers", {
    method: "PATCH",
    headers: { "x-clash-client-type": "agent" },
    body: JSON.stringify({
      providers: [{ id: "replicate-primary", providerId: "replicate", upstreamId: "replicate", weight: 11 }],
    }),
  });
  const missingProviderUpdateJson = await parseJsonResponse(missingProviderUpdate);
  recordCheck(
    "provider accounts update without prior read is rejected",
    missingProviderUpdate.status === 409 &&
      /Missing provider accounts update read proof for agent/.test(missingProviderUpdateJson.error ?? ""),
    JSON.stringify(missingProviderUpdateJson),
    { mutation: missingProviderUpdateJson.mutation },
  );

  const bareProviderUpdate = await request("/api/v1/model-providers", {
    method: "PATCH",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": baseReadToken(initialProviderConfig.readToken),
    },
    body: JSON.stringify({
      providers: [{ id: "replicate-primary", providerId: "replicate", upstreamId: "replicate", weight: 11 }],
    }),
  });
  const bareProviderUpdateJson = await parseJsonResponse(bareProviderUpdate);
  recordCheck(
    "provider accounts update with bare CAS token is rejected",
    bareProviderUpdate.status === 409 &&
      /Missing provider accounts update read receipt for agent/.test(bareProviderUpdateJson.error ?? ""),
    JSON.stringify(bareProviderUpdateJson),
    { mutation: bareProviderUpdateJson.mutation },
  );

  const acceptedProviderUpdate = await request("/api/v1/model-providers", {
    method: "PATCH",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": initialProviderConfig.readToken,
    },
    body: JSON.stringify({
      providers: [{ id: "replicate-primary", providerId: "replicate", upstreamId: "replicate", weight: 11 }],
    }),
  });
  const acceptedProviderUpdateJson = await parseJsonResponse(acceptedProviderUpdate);
  const freshPrimaryProvider = acceptedProviderUpdateJson.providers?.find((provider) => provider.id === "replicate-primary");
  recordCheck(
    "provider accounts update with receipt read token is accepted",
    acceptedProviderUpdate.status === 200 &&
      acceptedProviderUpdateJson.mutation?.accepted === true &&
      hasReceipt(acceptedProviderUpdateJson.readToken, "provider-accounts") &&
      hasReceipt(freshPrimaryProvider?.readToken, "provider-account") &&
      freshPrimaryProvider?.weight === 11,
    JSON.stringify(acceptedProviderUpdateJson),
    { mutation: acceptedProviderUpdateJson.mutation },
  );

  const providerModelTestResponse = await request("/api/v1/model-providers/test", {
    method: "POST",
    body: JSON.stringify({
      provider: { id: "replicate-primary", providerId: "replicate", upstreamId: "replicate", enabled: true },
      modelId: "nano-banana-2",
    }),
  });
  const providerModelTestJson = await parseJsonResponse(providerModelTestResponse);
  recordCheck(
    "provider model test action returns host mutation record",
    providerModelTestResponse.status === 200 &&
      providerModelTestJson.ok === true &&
      providerModelTestJson.mutation?.operation === "provider_model_test" &&
      providerModelTestJson.mutation?.accepted === true,
    JSON.stringify(providerModelTestJson),
    { mutation: providerModelTestJson.mutation },
  );

  const missingProviderDelete = await request("/api/v1/model-providers/replicate-primary", {
    method: "DELETE",
    headers: { "x-clash-client-type": "agent" },
  });
  const missingProviderDeleteJson = await parseJsonResponse(missingProviderDelete);
  recordCheck(
    "provider account delete without prior read is rejected",
    missingProviderDelete.status === 409 &&
      /Missing provider account delete read proof for agent/.test(missingProviderDeleteJson.error ?? ""),
    JSON.stringify(missingProviderDeleteJson),
    { mutation: missingProviderDeleteJson.mutation },
  );

  const staleProviderDelete = await request("/api/v1/model-providers/replicate-primary", {
    method: "DELETE",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": initialPrimaryProvider.readToken,
    },
  });
  const staleProviderDeleteJson = await parseJsonResponse(staleProviderDelete);
  recordCheck(
    "provider account delete with stale receipt is rejected",
    staleProviderDelete.status === 409 &&
      /Stale provider account delete rejected/.test(staleProviderDeleteJson.error ?? ""),
    JSON.stringify(staleProviderDeleteJson),
    { mutation: staleProviderDeleteJson.mutation },
  );

  const bareProviderDelete = await request("/api/v1/model-providers/replicate-primary", {
    method: "DELETE",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": baseReadToken(freshPrimaryProvider.readToken),
    },
  });
  const bareProviderDeleteJson = await parseJsonResponse(bareProviderDelete);
  recordCheck(
    "provider account delete with bare CAS token is rejected",
    bareProviderDelete.status === 409 &&
      /Missing provider account delete read receipt for agent/.test(bareProviderDeleteJson.error ?? ""),
    JSON.stringify(bareProviderDeleteJson),
    { mutation: bareProviderDeleteJson.mutation },
  );

  const acceptedProviderDelete = await request("/api/v1/model-providers/replicate-primary", {
    method: "DELETE",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": freshPrimaryProvider.readToken,
    },
  });
  const acceptedProviderDeleteJson = await parseJsonResponse(acceptedProviderDelete);
  recordCheck(
    "provider account delete with receipt read token is accepted",
    acceptedProviderDelete.status === 200 && acceptedProviderDeleteJson.mutation?.accepted === true,
    JSON.stringify(acceptedProviderDeleteJson),
    { mutation: acceptedProviderDeleteJson.mutation },
  );
  const providersAfterDeleteResponse = await request("/api/v1/model-providers");
  const providersAfterDelete = await parseJsonResponse(providersAfterDeleteResponse);
  const providerIdsAfterDelete = providersAfterDelete.providers?.map((provider) => provider.id).filter(Boolean) ?? [];
  recordCheck(
    "provider account delete persists in host state",
    !providerIdsAfterDelete.includes("replicate-primary") && providerIdsAfterDelete.includes("replicate-secondary"),
    JSON.stringify(providersAfterDelete),
    { providerIds: providerIdsAfterDelete },
  );

  const oauthStartResponse = await request("/api/v1/provider-oauth/dreamina/start", {
    method: "POST",
    body: JSON.stringify({ accountId: "jimeng-smoke", accountLabel: "Smoke Dreamina" }),
  });
  const oauthStart = await parseJsonResponse(oauthStartResponse);
  recordCheck(
    "provider OAuth start accepted",
    oauthStartResponse.status === 200 && oauthStart.status === "pending",
    JSON.stringify(oauthStart),
    { mutation: oauthStart.mutation },
  );

  const pendingOAuthResponse = await request("/api/v1/provider-oauth");
  const pendingOAuthList = await parseJsonResponse(pendingOAuthResponse);
  let pendingOAuth = pendingOAuthList.providers?.find((record) =>
    record.providerId === "dreamina" && record.accountId === "jimeng-smoke"
  );
  recordCheck(
    "provider OAuth get returns receipt read token",
    hasReceipt(pendingOAuth?.readToken, "provider-oauth"),
    pendingOAuth?.readToken ?? JSON.stringify(pendingOAuthList),
  );

  const missingOAuthStart = await request("/api/v1/provider-oauth/dreamina/start", {
    method: "POST",
    headers: { "x-clash-client-type": "agent" },
    body: JSON.stringify({ accountId: "jimeng-smoke", accountLabel: "Smoke Dreamina restart" }),
  });
  const missingOAuthStartJson = await parseJsonResponse(missingOAuthStart);
  recordCheck(
    "provider OAuth start without prior read is rejected",
    missingOAuthStart.status === 409 &&
      /Missing provider OAuth start read proof for agent/.test(missingOAuthStartJson.error ?? ""),
    JSON.stringify(missingOAuthStartJson),
    { mutation: missingOAuthStartJson.mutation },
  );

  const bareOAuthStart = await request("/api/v1/provider-oauth/dreamina/start", {
    method: "POST",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": baseReadToken(pendingOAuth.readToken),
    },
    body: JSON.stringify({ accountId: "jimeng-smoke", accountLabel: "Smoke Dreamina restart" }),
  });
  const bareOAuthStartJson = await parseJsonResponse(bareOAuthStart);
  recordCheck(
    "provider OAuth start with bare CAS token is rejected",
    bareOAuthStart.status === 409 &&
      /Missing provider OAuth start read receipt for agent/.test(bareOAuthStartJson.error ?? ""),
    JSON.stringify(bareOAuthStartJson),
    { mutation: bareOAuthStartJson.mutation },
  );

  const oauthRestartResponse = await request("/api/v1/provider-oauth/dreamina/start", {
    method: "POST",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": pendingOAuth.readToken,
    },
    body: JSON.stringify({ accountId: "jimeng-smoke", accountLabel: "Smoke Dreamina restart" }),
  });
  const oauthRestart = await parseJsonResponse(oauthRestartResponse);
  recordCheck(
    "provider OAuth start with receipt read token is accepted",
    oauthRestartResponse.status === 200 &&
      oauthRestart.status === "pending" &&
      oauthRestart.mutation?.accepted === true &&
      hasReceipt(oauthRestart.readToken, "provider-oauth") &&
      oauthRestart.readToken !== pendingOAuth.readToken,
    JSON.stringify(oauthRestart),
    { mutation: oauthRestart.mutation },
  );

  const staleOAuthStart = await request("/api/v1/provider-oauth/dreamina/start", {
    method: "POST",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": pendingOAuth.readToken,
    },
    body: JSON.stringify({ accountId: "jimeng-smoke", accountLabel: "Smoke Dreamina restart" }),
  });
  const staleOAuthStartJson = await parseJsonResponse(staleOAuthStart);
  recordCheck(
    "provider OAuth start with stale receipt is rejected",
    staleOAuthStart.status === 409 &&
      /Stale provider OAuth start rejected/.test(staleOAuthStartJson.error ?? ""),
    JSON.stringify(staleOAuthStartJson),
    { mutation: staleOAuthStartJson.mutation },
  );
  pendingOAuth = { ...pendingOAuth, ...oauthRestart };

  const missingOAuthDelete = await request("/api/v1/provider-oauth/dreamina?accountId=jimeng-smoke", {
    method: "DELETE",
    headers: { "x-clash-client-type": "agent" },
  });
  const missingOAuthDeleteJson = await parseJsonResponse(missingOAuthDelete);
  recordCheck(
    "provider OAuth delete without prior read is rejected",
    missingOAuthDelete.status === 409 &&
      /Missing provider OAuth delete read proof for agent/.test(missingOAuthDeleteJson.error ?? ""),
    JSON.stringify(missingOAuthDeleteJson),
    { mutation: missingOAuthDeleteJson.mutation },
  );

  const bareOAuthDelete = await request("/api/v1/provider-oauth/dreamina?accountId=jimeng-smoke", {
    method: "DELETE",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": baseReadToken(pendingOAuth.readToken),
    },
  });
  const bareOAuthDeleteJson = await parseJsonResponse(bareOAuthDelete);
  recordCheck(
    "provider OAuth delete with bare CAS token is rejected",
    bareOAuthDelete.status === 409 &&
      /Missing provider OAuth delete read receipt for agent/.test(bareOAuthDeleteJson.error ?? ""),
    JSON.stringify(bareOAuthDeleteJson),
    { mutation: bareOAuthDeleteJson.mutation },
  );

  const missingOAuthComplete = await request("/api/v1/provider-oauth/dreamina/complete", {
    method: "POST",
    headers: { "x-clash-client-type": "agent" },
    body: JSON.stringify({ accountId: "jimeng-smoke", deviceCode: pendingOAuth.deviceCode }),
  });
  const missingOAuthCompleteJson = await parseJsonResponse(missingOAuthComplete);
  recordCheck(
    "provider OAuth complete without prior read is rejected",
    missingOAuthComplete.status === 409 &&
      /Missing provider OAuth complete read proof for agent/.test(missingOAuthCompleteJson.error ?? ""),
    JSON.stringify(missingOAuthCompleteJson),
    { mutation: missingOAuthCompleteJson.mutation },
  );

  const bareOAuthComplete = await request("/api/v1/provider-oauth/dreamina/complete", {
    method: "POST",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": baseReadToken(pendingOAuth.readToken),
    },
    body: JSON.stringify({ accountId: "jimeng-smoke", deviceCode: pendingOAuth.deviceCode }),
  });
  const bareOAuthCompleteJson = await parseJsonResponse(bareOAuthComplete);
  recordCheck(
    "provider OAuth complete with bare CAS token is rejected",
    bareOAuthComplete.status === 409 &&
      /Missing provider OAuth complete read receipt for agent/.test(bareOAuthCompleteJson.error ?? ""),
    JSON.stringify(bareOAuthCompleteJson),
    { mutation: bareOAuthCompleteJson.mutation },
  );

  const oauthCompleteResponse = await request("/api/v1/provider-oauth/dreamina/complete", {
    method: "POST",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": pendingOAuth.readToken,
    },
    body: JSON.stringify({ accountId: "jimeng-smoke", deviceCode: pendingOAuth.deviceCode }),
  });
  const oauthComplete = await parseJsonResponse(oauthCompleteResponse);
  recordCheck(
    "provider OAuth complete with receipt read token is accepted",
    oauthCompleteResponse.status === 200 &&
      oauthComplete.status === "authorized" &&
      oauthComplete.mutation?.accepted === true &&
      hasReceipt(oauthComplete.readToken, "provider-oauth") &&
      oauthComplete.readToken !== pendingOAuth.readToken,
    JSON.stringify(oauthComplete),
    { mutation: oauthComplete.mutation },
  );

  const staleOAuthComplete = await request("/api/v1/provider-oauth/dreamina/complete", {
    method: "POST",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": pendingOAuth.readToken,
    },
    body: JSON.stringify({ accountId: "jimeng-smoke", deviceCode: pendingOAuth.deviceCode }),
  });
  const staleOAuthCompleteJson = await parseJsonResponse(staleOAuthComplete);
  recordCheck(
    "provider OAuth complete with stale receipt is rejected",
    staleOAuthComplete.status === 409 &&
      /Stale provider OAuth complete rejected/.test(staleOAuthCompleteJson.error ?? ""),
    JSON.stringify(staleOAuthCompleteJson),
    { mutation: staleOAuthCompleteJson.mutation },
  );

  const staleOAuthDelete = await request("/api/v1/provider-oauth/dreamina?accountId=jimeng-smoke", {
    method: "DELETE",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": pendingOAuth.readToken,
    },
  });
  const staleOAuthDeleteJson = await parseJsonResponse(staleOAuthDelete);
  recordCheck(
    "provider OAuth delete with stale receipt is rejected",
    staleOAuthDelete.status === 409 &&
      /Stale provider OAuth delete rejected/.test(staleOAuthDeleteJson.error ?? ""),
    JSON.stringify(staleOAuthDeleteJson),
    { mutation: staleOAuthDeleteJson.mutation },
  );

  const authorizedOAuthResponse = await request("/api/v1/provider-oauth");
  const authorizedOAuthList = await parseJsonResponse(authorizedOAuthResponse);
  const authorizedOAuth = authorizedOAuthList.providers?.find((record) =>
    record.providerId === "dreamina" && record.accountId === "jimeng-smoke"
  );
  recordCheck(
    "provider OAuth authorized get returns fresh receipt read token",
    authorizedOAuth?.status === "authorized" && hasReceipt(authorizedOAuth?.readToken, "provider-oauth"),
    authorizedOAuth?.readToken ?? JSON.stringify(authorizedOAuthList),
  );

  const acceptedOAuthDelete = await request("/api/v1/provider-oauth/dreamina?accountId=jimeng-smoke", {
    method: "DELETE",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": authorizedOAuth.readToken,
    },
  });
  const acceptedOAuthDeleteJson = await parseJsonResponse(acceptedOAuthDelete);
  recordCheck(
    "provider OAuth delete with receipt read token is accepted",
    acceptedOAuthDelete.status === 200 && acceptedOAuthDeleteJson.mutation?.accepted === true,
    JSON.stringify(acceptedOAuthDeleteJson),
    { mutation: acceptedOAuthDeleteJson.mutation },
  );

  const deletedRowOAuthStart = await request("/api/v1/provider-oauth/dreamina/start", {
    method: "POST",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": authorizedOAuth.readToken,
    },
    body: JSON.stringify({ accountId: "jimeng-smoke", accountLabel: "Smoke Dreamina restart" }),
  });
  const deletedRowOAuthStartJson = await parseJsonResponse(deletedRowOAuthStart);
  recordCheck(
    "provider OAuth start with deleted-row stale receipt is rejected",
    deletedRowOAuthStart.status === 409 &&
      /Provider OAuth record not found/.test(deletedRowOAuthStartJson.error ?? ""),
    JSON.stringify(deletedRowOAuthStartJson),
    { mutation: deletedRowOAuthStartJson.mutation },
  );

  const oauthAfterDeleteResponse = await request("/api/v1/provider-oauth");
  const oauthAfterDelete = await parseJsonResponse(oauthAfterDeleteResponse);
  recordCheck(
    "provider OAuth delete persists in host state",
    !oauthAfterDelete.providers?.some((record) =>
      record.providerId === "dreamina" && record.accountId === "jimeng-smoke"
    ),
    JSON.stringify(oauthAfterDelete),
  );

  const firstImportHash = "e".repeat(64);
  const secondImportHash = "f".repeat(64);
  const importedAssetId = `local:sha256:${firstImportHash}`;
  const firstBlobKey = `blobs/${firstImportHash}/original.png`;
  const secondBlobKey = `blobs/${secondImportHash}/original.png`;
  await mkdir(path.join(dataDir, "assets", "blobs", firstImportHash), { recursive: true });
  await mkdir(path.join(dataDir, "assets", "blobs", secondImportHash), { recursive: true });
  await writeFile(path.join(dataDir, "assets", firstBlobKey), "first-local-blob", "utf8");
  await writeFile(path.join(dataDir, "assets", secondBlobKey), "second-local-blob", "utf8");

  const importedLocalAssetResponse = await request("/api/v1/assets/import", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      kind: "image",
      assetId: importedAssetId,
      contentHash: firstImportHash,
      localBlobKey: firstBlobKey,
      contentType: "image/png",
    }),
  });
  const importedLocalAsset = await parseJsonResponse(importedLocalAssetResponse);
  recordCheck(
    "asset import accepts new immutable local blob",
    importedLocalAssetResponse.status === 200 &&
      importedLocalAsset.id === importedAssetId &&
      importedLocalAsset.mutation?.accepted === true,
    JSON.stringify(importedLocalAsset),
    { mutation: importedLocalAsset.mutation },
  );

  const conflictingLocalAssetResponse = await request("/api/v1/assets/import", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      kind: "image",
      assetId: importedAssetId,
      contentHash: secondImportHash,
      localBlobKey: secondBlobKey,
      contentType: "image/png",
    }),
  });
  const conflictingLocalAsset = await parseJsonResponse(conflictingLocalAssetResponse);
  recordCheck(
    "asset import rejects existing asset id with different immutable content",
    conflictingLocalAssetResponse.status === 409 &&
      conflictingLocalAsset.mutation?.accepted === false &&
      /different immutable content/.test(conflictingLocalAsset.error ?? ""),
    JSON.stringify(conflictingLocalAsset),
    { mutation: conflictingLocalAsset.mutation },
  );

  const firstCustomOutput = new FormData();
  firstCustomOutput.append("projectId", projectId);
  firstCustomOutput.append("taskId", "custom-checkpoint-smoke");
  firstCustomOutput.append("nodeId", "custom-node-smoke");
  firstCustomOutput.append("outputType", "image");
  firstCustomOutput.append("file", new File(["first-custom-checkpoint"], "custom.png", { type: "image/png" }));
  const firstCustomOutputResponse = await app.request("/api/custom-action/upload", {
    method: "POST",
    body: firstCustomOutput,
  });
  const firstCustomOutputJson = await parseJsonResponse(firstCustomOutputResponse);
  recordCheck(
    "custom action upload accepts first checkpoint output",
    firstCustomOutputResponse.status === 200 &&
      firstCustomOutputJson.assetId === "custom-checkpoint-smoke" &&
      firstCustomOutputJson.mutation?.accepted === true,
    JSON.stringify(firstCustomOutputJson),
    { mutation: firstCustomOutputJson.mutation },
  );

  const secondCustomOutput = new FormData();
  secondCustomOutput.append("projectId", projectId);
  secondCustomOutput.append("taskId", "custom-checkpoint-smoke");
  secondCustomOutput.append("nodeId", "custom-node-smoke");
  secondCustomOutput.append("outputType", "image");
  secondCustomOutput.append("file", new File(["second-custom-checkpoint"], "custom.png", { type: "image/png" }));
  const secondCustomOutputResponse = await app.request("/api/custom-action/upload", {
    method: "POST",
    body: secondCustomOutput,
  });
  const secondCustomOutputJson = await parseJsonResponse(secondCustomOutputResponse);
  recordCheck(
    "custom action upload rejects checkpoint overwrite",
    secondCustomOutputResponse.status === 409 &&
      secondCustomOutputJson.mutation?.accepted === false &&
      /different checkpoint content/.test(secondCustomOutputJson.error ?? ""),
    JSON.stringify(secondCustomOutputJson),
    { mutation: secondCustomOutputJson.mutation },
  );
  const customOutputBytes = await request("/assets/projects/project-asset-receipt-smoke/custom/custom-checkpoint-smoke.png");
  recordCheck(
    "custom action checkpoint file remains first output after rejected overwrite",
    customOutputBytes.status === 200 && await customOutputBytes.text() === "first-custom-checkpoint",
    `status=${customOutputBytes.status}`,
  );

  const createdResponse = await request("/api/v1/assets", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      kind: "image",
      srcR2Key: "uploads/asset-receipt-source.png",
    }),
  });
  const created = await parseJsonResponse(createdResponse);
  recordCheck(
    "asset create accepted",
    createdResponse.status === 200 && typeof created.id === "string",
    `status=${createdResponse.status} id=${created.id ?? ""}`,
    { mutation: created.mutation },
  );
  const assetId = created.id;

  const initialAsset = await fetchAssetRecord({ assetId, request });
  recordCheck(
    "asset get returns receipt read token",
    hasReceipt(initialAsset.readToken, "asset"),
    initialAsset.readToken,
  );

  await expectRejected(
    "asset cover update without prior read is rejected",
    () =>
      updateAssetCover({
        assetId,
        coverR2Key: "uploads/cover-missing-read.png",
        env: agentEnv,
        request,
      }),
    ["Missing asset update read proof for agent", "clash asset get --asset"],
  );

  await expectRejected(
    "asset cover update with bare CAS token is rejected",
    () =>
      updateAssetCover({
        assetId,
        coverR2Key: "uploads/cover-bare-token.png",
        ifMatch: baseReadToken(initialAsset.readToken),
        env: agentEnv,
        request,
      }),
    ["Missing asset update read receipt for agent", "clash asset get --asset"],
  );

  const acceptedCover = await updateAssetCover({
    assetId,
    coverR2Key: "uploads/cover-accepted.png",
    ifMatch: initialAsset.readToken,
    env: agentEnv,
    request,
  });
  recordCheck(
    "asset cover update with receipt read token is accepted",
    acceptedCover.ok === true && hasReceipt(acceptedCover.readToken, "asset"),
    acceptedCover.readToken,
    { mutation: acceptedCover.mutation },
  );

  await expectRejected(
    "asset cover update with stale receipt is rejected",
    () =>
      updateAssetCover({
        assetId,
        coverR2Key: "uploads/cover-stale-token.png",
        ifMatch: initialAsset.readToken,
        env: agentEnv,
        request,
      }),
    "Stale asset update rejected",
  );

  const currentAsset = await fetchAssetRecord({ assetId, request });
  recordCheck(
    "asset cover mutation persists in host state",
    currentAsset.coverR2Key === "uploads/cover-accepted.png" && hasReceipt(currentAsset.readToken, "asset"),
    `coverR2Key=${currentAsset.coverR2Key ?? ""}`,
    { readToken: currentAsset.readToken },
  );

  const initialRef = await fetchAssetProjectRef({ assetId, projectId, request });
  recordCheck(
    "asset ref get returns receipt read token",
    hasReceipt(initialRef.readToken, "asset-ref"),
    initialRef.readToken,
    { projectId: initialRef.projectId },
  );

  await expectRejected(
    "asset ref delete without prior read is rejected",
    () => deleteAssetProjectRef({ assetId, projectId, env: agentEnv, request }),
    ["Missing asset-ref delete read proof for agent", "clash asset ref get --asset"],
  );

  await expectRejected(
    "asset ref delete with bare CAS token is rejected",
    () =>
      deleteAssetProjectRef({
        assetId,
        projectId,
        ifMatch: baseReadToken(initialRef.readToken),
        env: agentEnv,
        request,
      }),
    ["Missing asset-ref delete read receipt for agent", "clash asset ref get --asset"],
  );

  const deletedRef = await deleteAssetProjectRef({
    assetId,
    projectId,
    ifMatch: initialRef.readToken,
    env: agentEnv,
    request,
  });
	  recordCheck(
	    "asset ref delete with receipt read token is accepted",
	    deletedRef.deleted === true && deletedRef.mutation?.accepted === true,
	    JSON.stringify(deletedRef.mutation),
	    { mutation: deletedRef.mutation },
	  );

	  const refreshedAssetReferencesResponse = await request(`/api/v1/assets/${encodeURIComponent(assetId)}/references/refresh`, {
	    method: "POST",
	    body: JSON.stringify({ projectIds: [projectId] }),
	  });
	  const refreshedAssetReferences = await parseJsonResponse(refreshedAssetReferencesResponse);
	  recordCheck(
	    "asset reference refresh returns host mutation record",
	    refreshedAssetReferencesResponse.status === 200 &&
	      refreshedAssetReferences.refreshed === true &&
	      refreshedAssetReferences.mutation?.operation === "asset_references_refresh" &&
	      refreshedAssetReferences.mutation?.entity?.id === assetId &&
	      refreshedAssetReferences.mutation?.accepted === true,
	    JSON.stringify(refreshedAssetReferences),
	    { mutation: refreshedAssetReferences.mutation },
	  );

	  await expectRejected(
	    "deleted asset ref no longer reads",
	    () => fetchAssetProjectRef({ assetId, projectId, request }),
    "Failed to fetch asset project reference: 404",
  );

  const initialGcDryRun = await runAssetGarbageCollection({
    dryRun: true,
    request,
  });
  recordCheck(
    "asset GC dry-run returns receipt read token",
    hasReceipt(initialGcDryRun.readToken, "asset-gc") &&
      initialGcDryRun.deletedAssets.some((asset) => asset.id === assetId),
    JSON.stringify(initialGcDryRun),
    { readToken: initialGcDryRun.readToken, mutation: initialGcDryRun.mutation },
  );

  const missingGcDelete = await request("/api/v1/assets/gc", {
    method: "POST",
    headers: { "x-clash-client-type": "agent" },
    body: JSON.stringify({ dryRun: false }),
  });
  const missingGcDeleteJson = await parseJsonResponse(missingGcDelete);
  recordCheck(
    "asset GC delete without prior dry-run is rejected",
    missingGcDelete.status === 409 &&
      /Missing asset garbage collection read proof for agent/.test(missingGcDeleteJson.error ?? ""),
    JSON.stringify(missingGcDeleteJson),
    { mutation: missingGcDeleteJson.mutation },
  );

  const bareGcDelete = await request("/api/v1/assets/gc", {
    method: "POST",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": baseReadToken(initialGcDryRun.readToken),
    },
    body: JSON.stringify({ dryRun: false }),
  });
  const bareGcDeleteJson = await parseJsonResponse(bareGcDelete);
  recordCheck(
    "asset GC delete with bare dry-run CAS token is rejected",
    bareGcDelete.status === 409 &&
      /Missing asset garbage collection read receipt for agent/.test(bareGcDeleteJson.error ?? ""),
    JSON.stringify(bareGcDeleteJson),
    { mutation: bareGcDeleteJson.mutation },
  );

  const secondGcAssetResponse = await request("/api/v1/assets", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      kind: "image",
      srcR2Key: "uploads/asset-gc-second.png",
    }),
  });
  const secondGcAsset = await parseJsonResponse(secondGcAssetResponse);
  await request(`/api/v1/assets/${encodeURIComponent(secondGcAsset.id)}/ref?projectId=${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });

  const staleGcDelete = await request("/api/v1/assets/gc", {
    method: "POST",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": initialGcDryRun.readToken,
    },
    body: JSON.stringify({ dryRun: false }),
  });
  const staleGcDeleteJson = await parseJsonResponse(staleGcDelete);
  recordCheck(
    "asset GC delete with stale dry-run receipt is rejected",
    staleGcDelete.status === 409 &&
      /Stale asset garbage collection rejected/.test(staleGcDeleteJson.error ?? ""),
    JSON.stringify(staleGcDeleteJson),
    { mutation: staleGcDeleteJson.mutation },
  );

  const freshGcDryRun = await runAssetGarbageCollection({
    dryRun: true,
    request,
  });
  recordCheck(
    "asset GC fresh dry-run sees current orphan plan",
    hasReceipt(freshGcDryRun.readToken, "asset-gc") &&
      [assetId, secondGcAsset.id].every((id) => freshGcDryRun.deletedAssets.some((asset) => asset.id === id)),
    JSON.stringify(freshGcDryRun),
    { readToken: freshGcDryRun.readToken },
  );

  const acceptedGcDelete = await runAssetGarbageCollection({
    dryRun: false,
    ifMatch: freshGcDryRun.readToken,
    env: agentEnv,
    request,
  });
  recordCheck(
    "asset GC delete with dry-run receipt is accepted",
    acceptedGcDelete.mutation?.accepted === true &&
      acceptedGcDelete.mutation?.expectedReadToken === freshGcDryRun.readToken &&
      acceptedGcDelete.mutation?.beforeReadToken === baseReadToken(freshGcDryRun.readToken) &&
      [assetId, secondGcAsset.id].every((id) => acceptedGcDelete.deletedAssets.some((asset) => asset.id === id)),
    JSON.stringify(acceptedGcDelete),
    { mutation: acceptedGcDelete.mutation },
  );

  const assetGcAuditResponse = await request("/api/v1/mutation-audit?operation=asset_gc&entityId=local");
  const assetGcAudit = await parseJsonResponse(assetGcAuditResponse);
  const assetGcAuditRecord = assetGcAudit.records?.[0];
  recordCheck(
    "asset GC delete writes sanitized local mutation audit evidence",
    assetGcAuditResponse.status === 200 &&
      assetGcAudit.records?.length === 1 &&
      assetGcAuditRecord.operation === "asset_gc" &&
      assetGcAuditRecord.entity?.id === "local" &&
      assetGcAuditRecord.forced === false &&
      assetGcAuditRecord.accepted === true &&
      assetGcAuditRecord.actorClientType === "agent" &&
      assetGcAuditRecord.reason === "asset garbage collection" &&
      !JSON.stringify(assetGcAuditRecord.mutation ?? {}).includes("receipt") &&
      assetGcAuditRecord.mutation?.expectedReadToken == null &&
      assetGcAuditRecord.mutation?.beforeReadToken == null,
    JSON.stringify(assetGcAudit),
  );

  await expectRejected(
    "asset GC removed orphan asset metadata",
    () => fetchAssetRecord({ assetId, request }),
    "Failed to fetch asset: 404",
  );
  await stat(dataDir).then(
    () => recordCheck("asset GC smoke data dir remains intact", true, dataDir),
    (error) => recordCheck("asset GC smoke data dir remains intact", false, String(error)),
  );

  const edgeAuditProjectId = "project-edge-audit-smoke";
  await new FileReplicaStore(path.join(dataDir, "projects")).updateSnapshotAtomic(edgeAuditProjectId, (doc) => {
    doc.getMap("nodes").set("edge-source", { type: "text", data: { label: "Edge source" } });
    doc.getMap("nodes").set("edge-target", { type: "text", data: { label: "Edge target" } });
    doc.getMap("edges").set("edge-source-edge-target", {
      source: "edge-source",
      target: "edge-target",
      type: "default",
    });
    return { value: null };
  });

  const edgeListResponse = await request(`/api/v1/projects/${edgeAuditProjectId}/canvas/edges`);
  const edgeList = await parseJsonResponse(edgeListResponse);
  const edgeToDelete = edgeList.edges?.find((edge) => edge.id === "edge-source-edge-target");
  recordCheck(
    "canvas edge list returns graph and edge receipt read tokens",
    edgeListResponse.status === 200 &&
      hasReceipt(edgeList.readToken, "edges") &&
      hasReceipt(edgeToDelete?.readToken, "edge"),
    JSON.stringify(edgeList),
    { readToken: edgeList.readToken, edgeReadToken: edgeToDelete?.readToken },
  );

  const edgeDeleteResponse = await request(`/api/v1/projects/${edgeAuditProjectId}/canvas/edges/edge-source-edge-target`, {
    method: "DELETE",
    body: JSON.stringify({
      actorClientType: "agent",
      ifMatch: edgeToDelete?.readToken,
    }),
  });
  const edgeDelete = await parseJsonResponse(edgeDeleteResponse);
  recordCheck(
    "canvas edge delete with receipt is accepted",
    edgeDeleteResponse.status === 200 &&
      edgeDelete.mutation?.accepted === true &&
      edgeDelete.mutation?.operation === "canvas_delete_edge" &&
      edgeDelete.mutation?.expectedReadToken === edgeToDelete?.readToken &&
      edgeDelete.mutation?.beforeReadToken === baseReadToken(edgeToDelete?.readToken),
    JSON.stringify(edgeDelete),
    { mutation: edgeDelete.mutation },
  );

  const edgeDeleteAuditResponse = await request("/api/v1/mutation-audit?operation=canvas_delete_edge&entityId=edge-source-edge-target");
  const edgeDeleteAudit = await parseJsonResponse(edgeDeleteAuditResponse);
  const edgeDeleteAuditRecord = edgeDeleteAudit.records?.[0];
  recordCheck(
    "canvas edge delete writes sanitized local mutation audit evidence",
    edgeDeleteAuditResponse.status === 200 &&
      edgeDeleteAudit.records?.length === 1 &&
      edgeDeleteAuditRecord.operation === "canvas_delete_edge" &&
      edgeDeleteAuditRecord.entity?.id === "edge-source-edge-target" &&
      edgeDeleteAuditRecord.accepted === true &&
      edgeDeleteAuditRecord.reason === "canvas edge delete" &&
      !JSON.stringify(edgeDeleteAuditRecord.mutation ?? {}).includes("receipt") &&
      edgeDeleteAuditRecord.mutation?.expectedReadToken == null &&
      edgeDeleteAuditRecord.mutation?.beforeReadToken == null &&
      edgeDeleteAuditRecord.mutation?.afterReadToken == null,
    JSON.stringify(edgeDeleteAudit),
  );

  const restoreProjectResponse = await request("/api/v1/projects", {
    method: "POST",
    body: JSON.stringify({ name: "Project Restore Receipt Smoke" }),
  });
  const restoreProject = await parseJsonResponse(restoreProjectResponse);
  recordCheck(
    "project restore source project create accepted",
    restoreProjectResponse.status === 201 && hasReceipt(restoreProject.readToken, "project"),
    `status=${restoreProjectResponse.status} id=${restoreProject.id ?? ""} readToken=${restoreProject.readToken ?? ""}`,
    { mutation: restoreProject.mutation },
  );

  const deleteProjectResponse = await request(`/api/v1/projects/${encodeURIComponent(restoreProject.id)}`, {
    method: "DELETE",
  });
  const deletedProject = await parseJsonResponse(deleteProjectResponse);
  recordCheck(
    "project delete returns deleted-project receipt",
    deleteProjectResponse.status === 200 &&
      deletedProject.deleted === true &&
      hasReceipt(deletedProject.readToken, "project"),
    JSON.stringify(deletedProject),
    { mutation: deletedProject.mutation },
  );

  const hiddenDeletedProject = await request(`/api/v1/projects/${encodeURIComponent(restoreProject.id)}`);
  recordCheck(
    "deleted project is hidden from normal project get",
    hiddenDeletedProject.status === 404,
    `status=${hiddenDeletedProject.status}`,
  );

  const deletedProjectReadResponse = await request(`/api/v1/projects/${encodeURIComponent(restoreProject.id)}?includeDeleted=true`);
  const deletedProjectRead = await parseJsonResponse(deletedProjectReadResponse);
  recordCheck(
    "deleted project get returns restore receipt",
    deletedProjectReadResponse.status === 200 &&
      deletedProjectRead.id === restoreProject.id &&
      deletedProjectRead.deletedAt === deletedProject.deletedAt &&
      deletedProjectRead.readToken === deletedProject.readToken &&
      hasReceipt(deletedProjectRead.readToken, "project"),
    JSON.stringify(deletedProjectRead),
  );

  const missingProjectRestore = await request(`/api/v1/projects/${encodeURIComponent(restoreProject.id)}/restore`, {
    method: "POST",
    headers: { "x-clash-client-type": "agent" },
  });
  const missingProjectRestoreJson = await parseJsonResponse(missingProjectRestore);
  recordCheck(
    "project restore without prior deleted read is rejected",
    missingProjectRestore.status === 409 &&
      /Missing project restore read proof for agent/.test(missingProjectRestoreJson.error ?? ""),
    JSON.stringify(missingProjectRestoreJson),
    { mutation: missingProjectRestoreJson.mutation },
  );

  const bareProjectRestore = await request(`/api/v1/projects/${encodeURIComponent(restoreProject.id)}/restore`, {
    method: "POST",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": baseReadToken(deletedProjectRead.readToken),
    },
  });
  const bareProjectRestoreJson = await parseJsonResponse(bareProjectRestore);
  recordCheck(
    "project restore with bare CAS token is rejected",
    bareProjectRestore.status === 409 &&
      /Missing project restore read receipt for agent/.test(bareProjectRestoreJson.error ?? ""),
    JSON.stringify(bareProjectRestoreJson),
    { mutation: bareProjectRestoreJson.mutation },
  );

  const staleProjectRestore = await request(`/api/v1/projects/${encodeURIComponent(restoreProject.id)}/restore`, {
    method: "POST",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": restoreProject.readToken,
    },
  });
  const staleProjectRestoreJson = await parseJsonResponse(staleProjectRestore);
  recordCheck(
    "project restore with stale active receipt is rejected",
    staleProjectRestore.status === 409 &&
      /Stale project restore rejected/.test(staleProjectRestoreJson.error ?? ""),
    JSON.stringify(staleProjectRestoreJson),
    { mutation: staleProjectRestoreJson.mutation },
  );

  const acceptedProjectRestore = await request(`/api/v1/projects/${encodeURIComponent(restoreProject.id)}/restore`, {
    method: "POST",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": deletedProjectRead.readToken,
    },
  });
  const acceptedProjectRestoreJson = await parseJsonResponse(acceptedProjectRestore);
  recordCheck(
    "project restore with deleted-project receipt is accepted",
    acceptedProjectRestore.status === 200 &&
      acceptedProjectRestoreJson.restored === true &&
      acceptedProjectRestoreJson.id === restoreProject.id &&
      hasReceipt(acceptedProjectRestoreJson.readToken, "project") &&
      acceptedProjectRestoreJson.mutation?.accepted === true &&
      acceptedProjectRestoreJson.mutation?.expectedReadToken === deletedProjectRead.readToken &&
      acceptedProjectRestoreJson.mutation?.beforeReadToken === baseReadToken(deletedProjectRead.readToken) &&
      acceptedProjectRestoreJson.mutation?.afterReadToken === acceptedProjectRestoreJson.readToken,
    JSON.stringify(acceptedProjectRestoreJson),
    { mutation: acceptedProjectRestoreJson.mutation },
  );

  const restoreAuditResponse = await request(`/api/v1/mutation-audit?operation=project_restore&entityId=${encodeURIComponent(restoreProject.id)}`);
  const restoreAudit = await parseJsonResponse(restoreAuditResponse);
  const restoreAuditRecord = restoreAudit.records?.[0];
  recordCheck(
    "project restore writes sanitized local mutation audit evidence",
    restoreAuditResponse.status === 200 &&
      restoreAudit.records?.length === 1 &&
      restoreAuditRecord.operation === "project_restore" &&
      restoreAuditRecord.entity?.id === restoreProject.id &&
      restoreAuditRecord.accepted === true &&
      restoreAuditRecord.actorClientType === "agent" &&
      restoreAuditRecord.reason === "project restore" &&
      !JSON.stringify(restoreAuditRecord.mutation ?? {}).includes("receipt") &&
      restoreAuditRecord.mutation?.expectedReadToken == null &&
      restoreAuditRecord.mutation?.beforeReadToken == null &&
      restoreAuditRecord.mutation?.afterReadToken == null,
    JSON.stringify(restoreAudit),
  );

  const purgeProjectResponse = await request("/api/v1/projects", {
    method: "POST",
    body: JSON.stringify({ name: "Project Purge Receipt Smoke" }),
  });
  const purgeProject = await parseJsonResponse(purgeProjectResponse);
  recordCheck(
    "project purge source project create accepted",
    purgeProjectResponse.status === 201 && hasReceipt(purgeProject.readToken, "project"),
    `status=${purgeProjectResponse.status} id=${purgeProject.id ?? ""} readToken=${purgeProject.readToken ?? ""}`,
    { mutation: purgeProject.mutation },
  );

  const purgeSessionResponse = await request("/api/v1/sessions", {
    method: "POST",
    body: JSON.stringify({ projectId: purgeProject.id, title: "Purge guarded session" }),
  });
  const purgeSession = await parseJsonResponse(purgeSessionResponse);
  recordCheck(
    "project purge source session create accepted",
    purgeSessionResponse.status === 200 && typeof purgeSession.threadId === "string",
    JSON.stringify(purgeSession),
    { mutation: purgeSession.mutation },
  );

  const purgeReplicaRoot = path.join(dataDir, "projects", encodeURIComponent(purgeProject.id));
  await mkdir(path.join(purgeReplicaRoot, "loro"), { recursive: true });
  await writeFile(path.join(purgeReplicaRoot, "loro", "snapshot.bin"), new Uint8Array([1, 2, 3]));
  recordCheck(
    "project purge source Loro replica exists before purge",
    !(await pathIsMissing(path.join(purgeReplicaRoot, "loro", "snapshot.bin"))),
    purgeReplicaRoot,
  );

  const deletePurgeProjectResponse = await request(`/api/v1/projects/${encodeURIComponent(purgeProject.id)}`, {
    method: "DELETE",
  });
  const deletedPurgeProject = await parseJsonResponse(deletePurgeProjectResponse);
  recordCheck(
    "project purge delete returns deleted-project receipt",
    deletePurgeProjectResponse.status === 200 &&
      deletedPurgeProject.deleted === true &&
      hasReceipt(deletedPurgeProject.readToken, "project"),
    JSON.stringify(deletedPurgeProject),
    { mutation: deletedPurgeProject.mutation },
  );

  const purgeReadResponse = await request(`/api/v1/projects/${encodeURIComponent(purgeProject.id)}?includeDeleted=true`);
  const purgeRead = await parseJsonResponse(purgeReadResponse);
  recordCheck(
    "project purge deleted get returns purge receipt",
    purgeReadResponse.status === 200 &&
      purgeRead.id === purgeProject.id &&
      purgeRead.readToken === deletedPurgeProject.readToken &&
      hasReceipt(purgeRead.readToken, "project"),
    JSON.stringify(purgeRead),
  );

  const missingProjectPurge = await request(`/api/v1/projects/${encodeURIComponent(purgeProject.id)}/purge`, {
    method: "DELETE",
    headers: { "x-clash-client-type": "agent" },
    body: JSON.stringify({ confirm: "purge" }),
  });
  const missingProjectPurgeJson = await parseJsonResponse(missingProjectPurge);
  recordCheck(
    "project purge without prior deleted read is rejected",
    missingProjectPurge.status === 409 &&
      /Missing project purge read proof for agent/.test(missingProjectPurgeJson.error ?? ""),
    JSON.stringify(missingProjectPurgeJson),
    { mutation: missingProjectPurgeJson.mutation },
  );

  const delayedProjectPurge = await request(`/api/v1/projects/${encodeURIComponent(purgeProject.id)}/purge`, {
    method: "DELETE",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": purgeRead.readToken,
    },
    body: JSON.stringify({ confirm: "purge" }),
  });
  const delayedProjectPurgeJson = await parseJsonResponse(delayedProjectPurge);
  recordCheck(
    "project purge with receipt is delayed by default",
    delayedProjectPurge.status === 409 &&
      delayedProjectPurgeJson.recoverable === true &&
      typeof delayedProjectPurgeJson.purgeAfter === "string" &&
      delayedProjectPurgeJson.mutation?.accepted === false &&
      delayedProjectPurgeJson.mutation?.expectedReadToken === purgeRead.readToken,
    JSON.stringify(delayedProjectPurgeJson),
    { mutation: delayedProjectPurgeJson.mutation },
  );

  const acceptedProjectPurge = await request(`/api/v1/projects/${encodeURIComponent(purgeProject.id)}/purge`, {
    method: "DELETE",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": purgeRead.readToken,
      "x-clash-force": "true",
    },
    body: JSON.stringify({ confirm: "purge" }),
  });
  const acceptedProjectPurgeJson = await parseJsonResponse(acceptedProjectPurge);
  recordCheck(
    "project purge with deleted-project receipt and force is accepted",
    acceptedProjectPurge.status === 200 &&
      acceptedProjectPurgeJson.purged === true &&
      acceptedProjectPurgeJson.id === purgeProject.id &&
      acceptedProjectPurgeJson.replicaDeleted === true &&
      acceptedProjectPurgeJson.removed?.projects === 1 &&
      acceptedProjectPurgeJson.removed?.sessions === 1 &&
      acceptedProjectPurgeJson.mutation?.accepted === true &&
      acceptedProjectPurgeJson.mutation?.forced === true &&
      acceptedProjectPurgeJson.mutation?.expectedReadToken === purgeRead.readToken &&
      acceptedProjectPurgeJson.mutation?.beforeReadToken === baseReadToken(purgeRead.readToken),
    JSON.stringify(acceptedProjectPurgeJson),
    { mutation: acceptedProjectPurgeJson.mutation },
  );

  const purgedProjectGet = await request(`/api/v1/projects/${encodeURIComponent(purgeProject.id)}?includeDeleted=true`);
  recordCheck(
    "project purge removes deleted recovery point",
    purgedProjectGet.status === 404 &&
      sqliteCount("select count(*) as count from project where id = ?", [purgeProject.id]) === 0 &&
      sqliteCount("select count(*) as count from runtime_session where project_id = ?", [purgeProject.id]) === 0 &&
      (await pathIsMissing(purgeReplicaRoot)),
    `status=${purgedProjectGet.status} projectRows=${sqliteCount("select count(*) as count from project where id = ?", [purgeProject.id])} sessionRows=${sqliteCount("select count(*) as count from runtime_session where project_id = ?", [purgeProject.id])} replicaRoot=${purgeReplicaRoot}`,
  );

  const purgeAuditResponse = await request(`/api/v1/mutation-audit?operation=project_purge&entityId=${encodeURIComponent(purgeProject.id)}`);
  const purgeAudit = await parseJsonResponse(purgeAuditResponse);
  const purgeAuditRecord = purgeAudit.records?.[0];
  recordCheck(
    "project purge writes sanitized local mutation audit evidence",
    purgeAuditResponse.status === 200 &&
      purgeAudit.records?.length === 1 &&
      purgeAuditRecord.operation === "project_purge" &&
      purgeAuditRecord.entity?.id === purgeProject.id &&
      purgeAuditRecord.forced === true &&
      purgeAuditRecord.accepted === true &&
      purgeAuditRecord.actorClientType === "agent" &&
      purgeAuditRecord.reason === "project purge" &&
      !JSON.stringify(purgeAuditRecord.mutation ?? {}).includes("receipt") &&
      purgeAuditRecord.mutation?.expectedReadToken == null &&
      purgeAuditRecord.mutation?.beforeReadToken == null,
    JSON.stringify(purgeAudit),
  );

  const sessionProjectResponse = await request("/api/v1/projects", {
    method: "POST",
    body: JSON.stringify({ name: "Session Receipt Smoke" }),
  });
  const sessionProject = await parseJsonResponse(sessionProjectResponse);
  recordCheck(
    "session receipt project create accepted",
    sessionProjectResponse.status === 201 && typeof sessionProject.id === "string",
    `status=${sessionProjectResponse.status} id=${sessionProject.id ?? ""}`,
    { mutation: sessionProject.mutation },
  );
  const sessionResponse = await request("/api/v1/sessions", {
    method: "POST",
    body: JSON.stringify({ projectId: sessionProject.id, title: "Receipt guarded session" }),
  });
  const sessionCreated = await parseJsonResponse(sessionResponse);
  recordCheck(
    "session create accepted",
    sessionResponse.status === 200 && typeof sessionCreated.threadId === "string",
    `status=${sessionResponse.status} threadId=${sessionCreated.threadId ?? ""}`,
    { mutation: sessionCreated.mutation },
  );
  const sessionsResponse = await request(`/api/v1/sessions?projectId=${encodeURIComponent(sessionProject.id)}`);
  const sessions = await parseJsonResponse(sessionsResponse);
  const session = sessions.sessions?.find((candidate) => candidate.threadId === sessionCreated.threadId);
  recordCheck(
    "session list returns receipt read token",
    hasReceipt(session?.readToken, "session"),
    session?.readToken ?? JSON.stringify(sessions),
  );

  const missingSessionDelete = await request(`/api/v1/sessions?threadId=${encodeURIComponent(sessionCreated.threadId)}`, {
    method: "DELETE",
    headers: { "x-clash-client-type": "agent" },
  });
  const missingSessionDeleteJson = await parseJsonResponse(missingSessionDelete);
  recordCheck(
    "session delete without prior read is rejected",
    missingSessionDelete.status === 409 &&
      /Missing session delete read proof for agent/.test(missingSessionDeleteJson.error ?? ""),
    JSON.stringify(missingSessionDeleteJson),
    { mutation: missingSessionDeleteJson.mutation },
  );

  const bareSessionDelete = await request(`/api/v1/sessions?threadId=${encodeURIComponent(sessionCreated.threadId)}`, {
    method: "DELETE",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": baseReadToken(session.readToken),
    },
  });
  const bareSessionDeleteJson = await parseJsonResponse(bareSessionDelete);
  recordCheck(
    "session delete with bare CAS token is rejected",
    bareSessionDelete.status === 409 &&
      /Missing session delete read receipt for agent/.test(bareSessionDeleteJson.error ?? ""),
    JSON.stringify(bareSessionDeleteJson),
    { mutation: bareSessionDeleteJson.mutation },
  );

  const acceptedSessionDelete = await request(`/api/v1/sessions?threadId=${encodeURIComponent(sessionCreated.threadId)}`, {
    method: "DELETE",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": session.readToken,
    },
  });
  const acceptedSessionDeleteJson = await parseJsonResponse(acceptedSessionDelete);
	  recordCheck(
	    "session delete with receipt read token is accepted",
	    acceptedSessionDelete.status === 200 && acceptedSessionDeleteJson.mutation?.accepted === true,
	    JSON.stringify(acceptedSessionDeleteJson),
	    { mutation: acceptedSessionDeleteJson.mutation },
	  );

  const sessionDeleteAuditResponse = await request(`/api/v1/mutation-audit?operation=session_delete&entityId=${encodeURIComponent(sessionCreated.threadId)}`);
  const sessionDeleteAudit = await parseJsonResponse(sessionDeleteAuditResponse);
  const sessionDeleteAuditRecord = sessionDeleteAudit.records?.[0];
  recordCheck(
    "session delete writes sanitized local mutation audit evidence",
    sessionDeleteAuditResponse.status === 200 &&
      sessionDeleteAudit.records?.length === 1 &&
      sessionDeleteAuditRecord.operation === "session_delete" &&
      sessionDeleteAuditRecord.entity?.id === sessionCreated.threadId &&
      sessionDeleteAuditRecord.forced === false &&
      sessionDeleteAuditRecord.accepted === true &&
      sessionDeleteAuditRecord.actorClientType === "agent" &&
      sessionDeleteAuditRecord.reason === "session delete" &&
      !JSON.stringify(sessionDeleteAuditRecord.mutation ?? {}).includes("receipt") &&
      sessionDeleteAuditRecord.mutation?.expectedReadToken == null &&
      sessionDeleteAuditRecord.mutation?.beforeReadToken == null,
    JSON.stringify(sessionDeleteAudit),
  );

	  const runtimeSessionResponse = await request("/api/v1/runtimes/desktop-local/sessions", {
	    method: "POST",
	    body: JSON.stringify({
	      agent_id: "codex-acp",
	      project_id: sessionProject.id,
	      permission_mode: "full-access",
	    }),
	  });
	  const runtimeSession = await parseJsonResponse(runtimeSessionResponse);
	  recordCheck(
	    "runtime session create accepted for attach receipt smoke",
	    runtimeSessionResponse.status === 200 &&
	      runtimeSession.session_id === "local-session-existing" &&
	      runtimeSession.mutation?.accepted === true,
	    JSON.stringify(runtimeSession),
	    { mutation: runtimeSession.mutation },
	  );

	  const runtimeSessionsResponse = await request(`/api/v1/sessions?projectId=${encodeURIComponent(sessionProject.id)}`);
	  const runtimeSessions = await parseJsonResponse(runtimeSessionsResponse);
	  const runtimeHistory = runtimeSessions.sessions?.find((candidate) => candidate.threadId === runtimeSession.session_id);
	  recordCheck(
	    "runtime session list returns attach receipt read token",
	    hasReceipt(runtimeHistory?.readToken, "session"),
	    runtimeHistory?.readToken ?? JSON.stringify(runtimeSessions),
	  );

	  const missingRuntimeAttach = await request(`/api/v1/local-sessions/${encodeURIComponent(runtimeSession.session_id)}/_attach`, {
	    method: "POST",
	    headers: { "x-clash-client-type": "agent" },
	    body: JSON.stringify({}),
	  });
	  const missingRuntimeAttachJson = await parseJsonResponse(missingRuntimeAttach);
	  recordCheck(
	    "runtime session attach without prior read is rejected",
	    missingRuntimeAttach.status === 409 &&
	      /Missing runtime session attach read proof for agent/.test(missingRuntimeAttachJson.error ?? ""),
	    JSON.stringify(missingRuntimeAttachJson),
	    { mutation: missingRuntimeAttachJson.mutation },
	  );

	  const bareRuntimeAttach = await request(`/api/v1/local-sessions/${encodeURIComponent(runtimeSession.session_id)}/_attach`, {
	    method: "POST",
	    headers: {
	      "x-clash-client-type": "agent",
	      "x-clash-if-match": baseReadToken(runtimeHistory.readToken),
	    },
	    body: JSON.stringify({}),
	  });
	  const bareRuntimeAttachJson = await parseJsonResponse(bareRuntimeAttach);
	  recordCheck(
	    "runtime session attach with bare CAS token is rejected",
	    bareRuntimeAttach.status === 409 &&
	      /Missing runtime session attach read receipt for agent/.test(bareRuntimeAttachJson.error ?? ""),
	    JSON.stringify(bareRuntimeAttachJson),
	    { mutation: bareRuntimeAttachJson.mutation },
	  );

	  const acceptedRuntimeAttach = await request(`/api/v1/local-sessions/${encodeURIComponent(runtimeSession.session_id)}/_attach`, {
	    method: "POST",
	    headers: {
	      "x-clash-client-type": "agent",
	      "x-clash-if-match": runtimeHistory.readToken,
	    },
	    body: JSON.stringify({}),
	  });
	  const acceptedRuntimeAttachJson = await parseJsonResponse(acceptedRuntimeAttach);
	  recordCheck(
	    "runtime session attach with receipt read token is accepted",
	    acceptedRuntimeAttach.status === 200 &&
	      acceptedRuntimeAttachJson.mutation?.accepted === true &&
	      acceptedRuntimeAttachJson.mutation?.expectedReadToken === runtimeHistory.readToken &&
	      acceptedRuntimeAttachJson.mutation?.beforeReadToken === baseReadToken(runtimeHistory.readToken) &&
	      hasReceipt(acceptedRuntimeAttachJson.mutation?.afterReadToken, "session"),
	    JSON.stringify(acceptedRuntimeAttachJson),
	    { mutation: acceptedRuntimeAttachJson.mutation },
	  );

	  const firstRoomMessageResponse = await request(`/api/v1/projects/${encodeURIComponent(sessionProject.id)}/room/messages`, {
	    method: "POST",
	    body: JSON.stringify({
	      id: "room-message-replay-smoke",
	      text: "first local room message",
	    }),
	  });
	  const firstRoomMessage = await parseJsonResponse(firstRoomMessageResponse);
	  recordCheck(
	    "local room message create accepts first client id",
	    firstRoomMessageResponse.status === 200 &&
	      firstRoomMessage.id === "room-message-replay-smoke" &&
	      firstRoomMessage.text === "first local room message" &&
	      firstRoomMessage.mutation?.accepted === true,
	    JSON.stringify(firstRoomMessage),
	    { mutation: firstRoomMessage.mutation },
	  );

	  const conflictingRoomMessageResponse = await request(`/api/v1/projects/${encodeURIComponent(sessionProject.id)}/room/messages`, {
	    method: "POST",
	    body: JSON.stringify({
	      id: "room-message-replay-smoke",
	      text: "second conflicting local room message",
	    }),
	  });
	  const conflictingRoomMessage = await parseJsonResponse(conflictingRoomMessageResponse);
	  recordCheck(
	    "local room message id replay with different content is rejected",
	    conflictingRoomMessageResponse.status === 409 &&
	      /room message id already exists with different content/.test(conflictingRoomMessage.error ?? "") &&
	      conflictingRoomMessage.mutation?.accepted === false,
	    JSON.stringify(conflictingRoomMessage),
	    { mutation: conflictingRoomMessage.mutation },
	  );

	  const roomMessagesResponse = await request(`/api/v1/projects/${encodeURIComponent(sessionProject.id)}/room/messages`);
	  const roomMessages = await parseJsonResponse(roomMessagesResponse);
	  recordCheck(
	    "local room message conflict preserves original content",
	    roomMessagesResponse.status === 200 &&
	      roomMessages.messages?.some((message) =>
	        message.id === "room-message-replay-smoke" &&
	        message.text === "first local room message"
	      ) &&
	      !roomMessages.messages?.some((message) =>
	        message.id === "room-message-replay-smoke" &&
	        message.text === "second conflicting local room message"
	      ),
	    JSON.stringify(roomMessages),
	  );

	  const report = {
	    schemaVersion: 1,
	    status: "pass",
	    summary: "Local sync/audio/runtime/provider config, derived agent read views, provider model test actions, local audio transcription actions, asset metadata/ref/GC, asset reference metadata refresh, project restore/purge, local session agent writes/attach, and local room id replays require host-side read/idempotency proofs, read-only metadata views, or host mutation records.",
    run: {
      artifactRoot,
      dataDir,
      startedAt,
      finishedAt: now(),
    },
    asset: {
      assetId,
      projectId,
      currentReadToken: currentAsset.readToken,
      gcReadToken: freshGcDryRun.readToken,
      gcDeletedAssetIds: acceptedGcDelete.deletedAssets.map((asset) => asset.id),
    },
    sync: {
      readToken: acceptedSyncUpdateJson.readToken,
      mode: acceptedSyncUpdateJson.mode,
      remoteLoroUrl: acceptedSyncUpdateJson.remote_loro?.url,
    },
    audio: {
      readToken: acceptedAudioUpdateJson.readToken,
      installReadToken: acceptedAudioInstallJson.readToken,
      asrEnabled: acceptedAudioUpdateJson.asr?.enabled,
      asrModel: acceptedAudioUpdateJson.asr?.model,
      asrInstallAvailable: acceptedAudioInstallJson.asr?.setup?.available,
      transcriptionText: audioTranscriptionJson.text,
      transcriptionMutation: audioTranscriptionJson.mutation,
    },
    localRuntimeConfig: {
      harnessReadToken: acceptedHarnessUpdateJson.readToken,
      harnessActionReadToken: acceptedHarnessInstallJson.readToken,
      enabledHarnessIds: acceptedHarnessUpdateJson.harnesses
        ?.filter((row) => row.enabled === true)
        .map((row) => row.id),
      agentServersReadToken: acceptedAgentServersUpdateJson.readToken,
      agentServerNames: Object.keys(acceptedAgentServersUpdateJson.agent_servers ?? {}),
    },
    providerAccounts: {
      collectionReadToken: acceptedProviderUpdateJson.readToken,
      deletedProviderId: "replicate-primary",
      remainingProviderIds: providerIdsAfterDelete,
    },
	    providerOAuth: {
	      providerId: "dreamina",
	      accountId: "jimeng-smoke",
	      pendingReadToken: pendingOAuth.readToken,
	      completedReadToken: oauthComplete.readToken,
	      authorizedReadToken: authorizedOAuth.readToken,
	    },
	    session: {
	      projectId: sessionProject.id,
	      threadId: sessionCreated.threadId,
	      readToken: session.readToken,
	      runtimeAttachSessionId: runtimeSession.session_id,
	      runtimeAttachReadToken: runtimeHistory.readToken,
	    },
	    room: {
	      projectId: sessionProject.id,
	      messageId: firstRoomMessage.id,
	    },
    projectRestore: {
      projectId: restoreProject.id,
      deletedReadToken: deletedProjectRead.readToken,
      restoredReadToken: acceptedProjectRestoreJson.readToken,
    },
    projectPurge: {
      projectId: purgeProject.id,
      deletedReadToken: purgeRead.readToken,
      purgeAfter: delayedProjectPurgeJson.purgeAfter,
      removed: acceptedProjectPurgeJson.removed,
      replicaRoot: purgeReplicaRoot,
    },
    checks,
    booleans: {
      agentsReadDerivedMembersReturned: checks.some((check) => check.name === "agents read returns derived built-in members" && check.status === "pass"),
      agentsReadOnlyNoMemberPersisted: checks.some((check) => check.name === "agents read does not persist derived built-in members" && check.status === "pass"),
      assetGetReceiptReturned: checks.some((check) => check.name === "asset get returns receipt read token" && check.status === "pass"),
      coverMissingReadRejected: checks.some((check) => check.name === "asset cover update without prior read is rejected" && check.status === "pass"),
      coverBareCasRejected: checks.some((check) => check.name === "asset cover update with bare CAS token is rejected" && check.status === "pass"),
      coverReceiptAccepted: checks.some((check) => check.name === "asset cover update with receipt read token is accepted" && check.status === "pass"),
      coverStaleReceiptRejected: checks.some((check) => check.name === "asset cover update with stale receipt is rejected" && check.status === "pass"),
      assetRefGetReceiptReturned: checks.some((check) => check.name === "asset ref get returns receipt read token" && check.status === "pass"),
	      assetRefMissingReadRejected: checks.some((check) => check.name === "asset ref delete without prior read is rejected" && check.status === "pass"),
	      assetRefBareCasRejected: checks.some((check) => check.name === "asset ref delete with bare CAS token is rejected" && check.status === "pass"),
	      assetRefReceiptAccepted: checks.some((check) => check.name === "asset ref delete with receipt read token is accepted" && check.status === "pass"),
	      assetReferenceRefreshMutationRecorded: checks.some((check) => check.name === "asset reference refresh returns host mutation record" && check.status === "pass"),
	      assetGcDryRunReceiptReturned: checks.some((check) => check.name === "asset GC dry-run returns receipt read token" && check.status === "pass"),
      assetGcMissingDryRunRejected: checks.some((check) => check.name === "asset GC delete without prior dry-run is rejected" && check.status === "pass"),
      assetGcBareCasRejected: checks.some((check) => check.name === "asset GC delete with bare dry-run CAS token is rejected" && check.status === "pass"),
      assetGcStaleReceiptRejected: checks.some((check) => check.name === "asset GC delete with stale dry-run receipt is rejected" && check.status === "pass"),
      assetGcFreshPlanReturned: checks.some((check) => check.name === "asset GC fresh dry-run sees current orphan plan" && check.status === "pass"),
      assetGcReceiptAccepted: checks.some((check) => check.name === "asset GC delete with dry-run receipt is accepted" && check.status === "pass"),
      assetGcAuditRecorded: checks.some((check) => check.name === "asset GC delete writes sanitized local mutation audit evidence" && check.status === "pass"),
      canvasEdgeListReceiptReturned: checks.some((check) => check.name === "canvas edge list returns graph and edge receipt read tokens" && check.status === "pass"),
      canvasEdgeDeleteReceiptAccepted: checks.some((check) => check.name === "canvas edge delete with receipt is accepted" && check.status === "pass"),
      canvasEdgeDeleteAuditRecorded: checks.some((check) => check.name === "canvas edge delete writes sanitized local mutation audit evidence" && check.status === "pass"),
      projectRestoreDeletedGetHidden: checks.some((check) => check.name === "deleted project is hidden from normal project get" && check.status === "pass"),
      projectRestoreGetReceiptReturned: checks.some((check) => check.name === "deleted project get returns restore receipt" && check.status === "pass"),
      projectRestoreMissingReadRejected: checks.some((check) => check.name === "project restore without prior deleted read is rejected" && check.status === "pass"),
      projectRestoreBareCasRejected: checks.some((check) => check.name === "project restore with bare CAS token is rejected" && check.status === "pass"),
      projectRestoreStaleReceiptRejected: checks.some((check) => check.name === "project restore with stale active receipt is rejected" && check.status === "pass"),
      projectRestoreReceiptAccepted: checks.some((check) => check.name === "project restore with deleted-project receipt is accepted" && check.status === "pass"),
      projectRestoreAuditRecorded: checks.some((check) => check.name === "project restore writes sanitized local mutation audit evidence" && check.status === "pass"),
      projectPurgeGetReceiptReturned: checks.some((check) => check.name === "project purge deleted get returns purge receipt" && check.status === "pass"),
      projectPurgeMissingReadRejected: checks.some((check) => check.name === "project purge without prior deleted read is rejected" && check.status === "pass"),
      projectPurgeDelayedByDefault: checks.some((check) => check.name === "project purge with receipt is delayed by default" && check.status === "pass"),
      projectPurgeForceAccepted: checks.some((check) => check.name === "project purge with deleted-project receipt and force is accepted" && check.status === "pass"),
      projectPurgeRecoveryPointRemoved: checks.some((check) => check.name === "project purge removes deleted recovery point" && check.status === "pass"),
      projectPurgeAuditRecorded: checks.some((check) => check.name === "project purge writes sanitized local mutation audit evidence" && check.status === "pass"),
      syncConfigGetReceiptReturned: checks.some((check) => check.name === "sync config get returns receipt read token" && check.status === "pass"),
      syncConfigMissingReadRejected: checks.some((check) => check.name === "sync config update without prior read is rejected" && check.status === "pass"),
      syncConfigBareCasRejected: checks.some((check) => check.name === "sync config update with bare CAS token is rejected" && check.status === "pass"),
      syncConfigStaleReceiptRejected: checks.some((check) => check.name === "sync config update with stale receipt is rejected" && check.status === "pass"),
      syncConfigReceiptAccepted: checks.some((check) => check.name === "sync config update with receipt read token is accepted" && check.status === "pass"),
      audioConfigGetReceiptReturned: checks.some((check) => check.name === "audio config get returns receipt read token" && check.status === "pass"),
      audioConfigMissingReadRejected: checks.some((check) => check.name === "audio config update without prior read is rejected" && check.status === "pass"),
      audioConfigBareCasRejected: checks.some((check) => check.name === "audio config update with bare CAS token is rejected" && check.status === "pass"),
      audioConfigStaleReceiptRejected: checks.some((check) => check.name === "audio config update with stale receipt is rejected" && check.status === "pass"),
      audioConfigReceiptAccepted: checks.some((check) => check.name === "audio config update with receipt read token is accepted" && check.status === "pass"),
      audioInstallMissingReadRejected: checks.some((check) => check.name === "audio install without prior read is rejected" && check.status === "pass"),
      audioInstallBareCasRejected: checks.some((check) => check.name === "audio install with bare CAS token is rejected" && check.status === "pass"),
      audioInstallReceiptAccepted: checks.some((check) => check.name === "audio install with receipt read token is accepted" && check.status === "pass"),
      audioInstallStaleReceiptRejected: checks.some((check) => check.name === "audio install with stale receipt is rejected" && check.status === "pass"),
      audioTranscriptionMutationRecorded: checks.some((check) => check.name === "audio transcription action returns host mutation record" && check.status === "pass"),
      localHarnessGetReceiptReturned: checks.some((check) => check.name === "local harnesses get returns receipt read token" && check.status === "pass"),
      localHarnessMissingReadRejected: checks.some((check) => check.name === "local harness enablement update without prior read is rejected" && check.status === "pass"),
      localHarnessBareCasRejected: checks.some((check) => check.name === "local harness enablement update with bare CAS token is rejected" && check.status === "pass"),
      localHarnessStaleReceiptRejected: checks.some((check) => check.name === "local harness enablement update with stale receipt is rejected" && check.status === "pass"),
      localHarnessReceiptAccepted: checks.some((check) => check.name === "local harness enablement update with receipt read token is accepted" && check.status === "pass"),
      localHarnessInstallMissingReadRejected: checks.some((check) => check.name === "local harness install without prior read is rejected" && check.status === "pass"),
      localHarnessInstallBareCasRejected: checks.some((check) => check.name === "local harness install with bare CAS token is rejected" && check.status === "pass"),
      localHarnessInstallReceiptAccepted: checks.some((check) => check.name === "local harness install with receipt read token is accepted" && check.status === "pass"),
      localHarnessUninstallStaleReceiptRejected: checks.some((check) => check.name === "local harness uninstall with stale receipt is rejected" && check.status === "pass"),
      localAgentServersGetReceiptReturned: checks.some((check) => check.name === "local agent servers get returns receipt read token" && check.status === "pass"),
      localAgentServersMissingReadRejected: checks.some((check) => check.name === "local agent servers update without prior read is rejected" && check.status === "pass"),
      localAgentServersBareCasRejected: checks.some((check) => check.name === "local agent servers update with bare CAS token is rejected" && check.status === "pass"),
      localAgentServersStaleReceiptRejected: checks.some((check) => check.name === "local agent servers update with stale receipt is rejected" && check.status === "pass"),
      localAgentServersReceiptAccepted: checks.some((check) => check.name === "local agent servers update with receipt read token is accepted" && check.status === "pass"),
      providerAccountsGetReceiptReturned: checks.some((check) => check.name === "provider accounts get returns collection receipt read token" && check.status === "pass"),
      providerAccountGetReceiptReturned: checks.some((check) => check.name === "provider account get returns account receipt read token" && check.status === "pass"),
      providerAccountsMissingReadRejected: checks.some((check) => check.name === "provider accounts update without prior read is rejected" && check.status === "pass"),
      providerAccountsBareCasRejected: checks.some((check) => check.name === "provider accounts update with bare CAS token is rejected" && check.status === "pass"),
      providerAccountsReceiptAccepted: checks.some((check) => check.name === "provider accounts update with receipt read token is accepted" && check.status === "pass"),
      providerModelTestMutationRecorded: checks.some((check) => check.name === "provider model test action returns host mutation record" && check.status === "pass"),
      providerAccountDeleteMissingReadRejected: checks.some((check) => check.name === "provider account delete without prior read is rejected" && check.status === "pass"),
      providerAccountDeleteStaleReceiptRejected: checks.some((check) => check.name === "provider account delete with stale receipt is rejected" && check.status === "pass"),
      providerAccountDeleteBareCasRejected: checks.some((check) => check.name === "provider account delete with bare CAS token is rejected" && check.status === "pass"),
      providerAccountDeleteReceiptAccepted: checks.some((check) => check.name === "provider account delete with receipt read token is accepted" && check.status === "pass"),
      providerAccountDeletePersisted: checks.some((check) => check.name === "provider account delete persists in host state" && check.status === "pass"),
      providerOAuthGetReceiptReturned: checks.some((check) => check.name === "provider OAuth get returns receipt read token" && check.status === "pass"),
      providerOAuthStartMissingReadRejected: checks.some((check) => check.name === "provider OAuth start without prior read is rejected" && check.status === "pass"),
      providerOAuthStartBareCasRejected: checks.some((check) => check.name === "provider OAuth start with bare CAS token is rejected" && check.status === "pass"),
      providerOAuthStartReceiptAccepted: checks.some((check) => check.name === "provider OAuth start with receipt read token is accepted" && check.status === "pass"),
      providerOAuthStartStaleReceiptRejected: checks.some((check) => check.name === "provider OAuth start with stale receipt is rejected" && check.status === "pass"),
      providerOAuthStartDeletedRowStaleReceiptRejected: checks.some((check) => check.name === "provider OAuth start with deleted-row stale receipt is rejected" && check.status === "pass"),
      providerOAuthDeleteMissingReadRejected: checks.some((check) => check.name === "provider OAuth delete without prior read is rejected" && check.status === "pass"),
      providerOAuthDeleteBareCasRejected: checks.some((check) => check.name === "provider OAuth delete with bare CAS token is rejected" && check.status === "pass"),
      providerOAuthCompleteMissingReadRejected: checks.some((check) => check.name === "provider OAuth complete without prior read is rejected" && check.status === "pass"),
      providerOAuthCompleteBareCasRejected: checks.some((check) => check.name === "provider OAuth complete with bare CAS token is rejected" && check.status === "pass"),
      providerOAuthCompleteReceiptAccepted: checks.some((check) => check.name === "provider OAuth complete with receipt read token is accepted" && check.status === "pass"),
      providerOAuthCompleteStaleReceiptRejected: checks.some((check) => check.name === "provider OAuth complete with stale receipt is rejected" && check.status === "pass"),
      providerOAuthDeleteStaleReceiptRejected: checks.some((check) => check.name === "provider OAuth delete with stale receipt is rejected" && check.status === "pass"),
      providerOAuthAuthorizedFreshReceiptReturned: checks.some((check) => check.name === "provider OAuth authorized get returns fresh receipt read token" && check.status === "pass"),
      providerOAuthDeleteReceiptAccepted: checks.some((check) => check.name === "provider OAuth delete with receipt read token is accepted" && check.status === "pass"),
      providerOAuthDeletePersisted: checks.some((check) => check.name === "provider OAuth delete persists in host state" && check.status === "pass"),
      assetImportImmutableCreateAccepted: checks.some((check) => check.name === "asset import accepts new immutable local blob" && check.status === "pass"),
      assetImportImmutableConflictRejected: checks.some((check) => check.name === "asset import rejects existing asset id with different immutable content" && check.status === "pass"),
      customActionCheckpointCreateAccepted: checks.some((check) => check.name === "custom action upload accepts first checkpoint output" && check.status === "pass"),
      customActionCheckpointOverwriteRejected: checks.some((check) => check.name === "custom action upload rejects checkpoint overwrite" && check.status === "pass"),
      customActionCheckpointFilePreserved: checks.some((check) => check.name === "custom action checkpoint file remains first output after rejected overwrite" && check.status === "pass"),
      sessionListReceiptReturned: checks.some((check) => check.name === "session list returns receipt read token" && check.status === "pass"),
	      sessionDeleteMissingReadRejected: checks.some((check) => check.name === "session delete without prior read is rejected" && check.status === "pass"),
	      sessionDeleteBareCasRejected: checks.some((check) => check.name === "session delete with bare CAS token is rejected" && check.status === "pass"),
	      sessionDeleteReceiptAccepted: checks.some((check) => check.name === "session delete with receipt read token is accepted" && check.status === "pass"),
	      sessionDeleteAuditRecorded: checks.some((check) => check.name === "session delete writes sanitized local mutation audit evidence" && check.status === "pass"),
	      runtimeSessionAttachCreateAccepted: checks.some((check) => check.name === "runtime session create accepted for attach receipt smoke" && check.status === "pass"),
	      runtimeSessionAttachReadReceiptReturned: checks.some((check) => check.name === "runtime session list returns attach receipt read token" && check.status === "pass"),
	      runtimeSessionAttachMissingReadRejected: checks.some((check) => check.name === "runtime session attach without prior read is rejected" && check.status === "pass"),
	      runtimeSessionAttachBareCasRejected: checks.some((check) => check.name === "runtime session attach with bare CAS token is rejected" && check.status === "pass"),
	      runtimeSessionAttachReceiptAccepted: checks.some((check) => check.name === "runtime session attach with receipt read token is accepted" && check.status === "pass"),
	      localRoomMessageCreateAccepted: checks.some((check) => check.name === "local room message create accepts first client id" && check.status === "pass"),
	      localRoomMessageConflictRejected: checks.some((check) => check.name === "local room message id replay with different content is rejected" && check.status === "pass"),
	      localRoomMessageOriginalPreserved: checks.some((check) => check.name === "local room message conflict preserves original content" && check.status === "pass"),
	    },
	  };

  await writeJson(reportPath, report);
  console.log("[agent-first-asset-receipts] report", reportPath);
  console.log(JSON.stringify({ status: "pass", reportPath, checks: checks.length }));
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  await writeJson(reportPath, {
    schemaVersion: 1,
    status: "fail",
    summary: message,
    checks,
  });
  console.error(message);
  process.exit(1);
});
