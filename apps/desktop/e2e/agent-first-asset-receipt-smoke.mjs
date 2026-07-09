import { mkdir, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

function mutationAuditRecordsHaveNoReadTokens(records = []) {
  return records.every((record) =>
    record.mutation?.expectedReadToken == null &&
    record.mutation?.beforeReadToken == null &&
    record.mutation?.afterReadToken == null
  );
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

function isSameOrInside(childPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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
  const { createLocalSyncConfigStore } = await import("../../local-api/src/sync-config.ts");
  const { FileReplicaStore } = await import("../../local-api/src/loro/file-replica-store.ts");
  const { LocalLoroRoom } = await import("../../local-api/src/sync.ts");
  const localApiRequire = createRequire(path.join(repoRoot, "apps/local-api/package.json"));
  const { LoroDoc } = await import(pathToFileURL(localApiRequire.resolve("loro-crdt")).href);
  const {
    deleteAssetProjectRef,
    fetchAssetProjectRef,
    fetchAssetRecord,
    updateAssetCover,
    runAssetGarbageCollection,
  } = await import("../../../packages/cli/src/commands/assets.ts");

  let enabledHarnessIds = ["codex-acp"];
  let geminiInstalled = false;
  let geminiInstalledVersion = "1.1.0";
  let geminiAuthConfigured = false;
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
      installedVersion: geminiInstalled ? geminiInstalledVersion : undefined,
      latestVersion: "1.2.0",
      ...(geminiAuthConfigured
        ? { auth: { status: "configured", message: "Gemini auth configured" } }
        : {}),
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
        geminiInstalledVersion = "1.1.0";
        return { harnesses: harnessRows() };
      },
      async uninstallHarness() {
        geminiInstalled = false;
        geminiAuthConfigured = false;
        return { harnesses: harnessRows() };
      },
      async upgradeHarness() {
        geminiInstalled = true;
        geminiInstalledVersion = "1.2.0";
        return { harnesses: harnessRows() };
      },
      async authenticateHarness() {
        geminiAuthConfigured = true;
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
  const syncConfigAuditResponse = await request("/api/v1/mutation-audit?operation=local_sync_config_update&entityId=sync");
  const syncConfigAudit = await parseJsonResponse(syncConfigAuditResponse);
  const syncConfigAuditAgentRecord = syncConfigAudit.records?.find((record) => record.actorClientType === "agent");
  recordCheck(
    "sync config update writes sanitized local mutation audit evidence",
    syncConfigAuditResponse.status === 200 &&
      syncConfigAudit.records?.length === 2 &&
      syncConfigAuditAgentRecord?.operation === "local_sync_config_update" &&
      syncConfigAuditAgentRecord.entity?.id === "sync" &&
      syncConfigAuditAgentRecord.accepted === true &&
      syncConfigAuditAgentRecord.actorClientType === "agent" &&
      syncConfigAuditAgentRecord.reason === "local sync config update" &&
      !JSON.stringify(syncConfigAudit.records ?? []).includes("receipt") &&
      syncConfigAudit.records.every((record) =>
        record.mutation?.expectedReadToken == null &&
        record.mutation?.beforeReadToken == null &&
        record.mutation?.afterReadToken == null
      ),
    JSON.stringify({
      syncConfigAudit,
      acceptedMutation: {
        operation: acceptedSyncUpdateJson.mutation?.operation,
        accepted: acceptedSyncUpdateJson.mutation?.accepted,
        resultEntityId: acceptedSyncUpdateJson.mutation?.resultEntityId,
      },
    }),
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
  const audioConfigAuditResponse = await request("/api/v1/mutation-audit?operation=local_audio_config_update&entityId=audio");
  const audioConfigAudit = await parseJsonResponse(audioConfigAuditResponse);
  const audioConfigAuditAgentRecord = audioConfigAudit.records?.find((record) => record.actorClientType === "agent");
  recordCheck(
    "audio config update writes sanitized local mutation audit evidence",
    audioConfigAuditResponse.status === 200 &&
      audioConfigAudit.records?.length === 2 &&
      audioConfigAuditAgentRecord?.operation === "local_audio_config_update" &&
      audioConfigAuditAgentRecord.entity?.id === "audio" &&
      audioConfigAuditAgentRecord.accepted === true &&
      audioConfigAuditAgentRecord.actorClientType === "agent" &&
      audioConfigAuditAgentRecord.reason === "local audio config update" &&
      !JSON.stringify(audioConfigAudit.records ?? []).includes("receipt") &&
      audioConfigAudit.records.every((record) =>
        record.mutation?.expectedReadToken == null &&
        record.mutation?.beforeReadToken == null &&
        record.mutation?.afterReadToken == null
      ),
    JSON.stringify({
      audioConfigAudit,
      acceptedMutation: {
        operation: acceptedAudioUpdateJson.mutation?.operation,
        accepted: acceptedAudioUpdateJson.mutation?.accepted,
        resultEntityId: acceptedAudioUpdateJson.mutation?.resultEntityId,
      },
    }),
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
  const audioInstallAuditResponse = await request("/api/v1/mutation-audit?operation=local_audio_model_install&entityId=audio");
  const audioInstallAudit = await parseJsonResponse(audioInstallAuditResponse);
  const audioInstallAuditRecord = audioInstallAudit.records?.[0];
  recordCheck(
    "audio install writes sanitized local mutation audit evidence",
    audioInstallAuditResponse.status === 200 &&
      audioInstallAudit.records?.length === 1 &&
      audioInstallAuditRecord.operation === "local_audio_model_install" &&
      audioInstallAuditRecord.entity?.id === "audio" &&
      audioInstallAuditRecord.accepted === true &&
      audioInstallAuditRecord.actorClientType === "agent" &&
      audioInstallAuditRecord.reason === "local audio model install" &&
      !JSON.stringify(audioInstallAudit.records ?? []).includes("receipt") &&
      audioInstallAuditRecord.mutation?.expectedReadToken == null &&
      audioInstallAuditRecord.mutation?.beforeReadToken == null &&
      audioInstallAuditRecord.mutation?.afterReadToken == null,
    JSON.stringify({
      audioInstallAudit,
      acceptedMutation: {
        operation: acceptedAudioInstallJson.mutation?.operation,
        accepted: acceptedAudioInstallJson.mutation?.accepted,
        resultEntityId: acceptedAudioInstallJson.mutation?.resultEntityId,
      },
    }),
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
  const harnessEnablementAuditResponse = await request("/api/v1/mutation-audit?operation=local_harness_enablement_update&entityId=enabled");
  const harnessEnablementAudit = await parseJsonResponse(harnessEnablementAuditResponse);
  const harnessEnablementAuditAgentRecord = harnessEnablementAudit.records?.find((record) => record.actorClientType === "agent");
  recordCheck(
    "local harness enablement update writes sanitized local mutation audit evidence",
    harnessEnablementAuditResponse.status === 200 &&
      harnessEnablementAudit.records?.length === 2 &&
      harnessEnablementAuditAgentRecord?.operation === "local_harness_enablement_update" &&
      harnessEnablementAuditAgentRecord.entity?.id === "enabled" &&
      harnessEnablementAuditAgentRecord.accepted === true &&
      harnessEnablementAuditAgentRecord.actorClientType === "agent" &&
      harnessEnablementAuditAgentRecord.reason === "local harness enablement update" &&
      !JSON.stringify(harnessEnablementAudit.records ?? []).includes("receipt") &&
      harnessEnablementAudit.records.every((record) =>
        record.mutation?.expectedReadToken == null &&
        record.mutation?.beforeReadToken == null &&
        record.mutation?.afterReadToken == null
      ),
    JSON.stringify({
      harnessEnablementAudit,
      acceptedMutation: {
        operation: acceptedHarnessUpdateJson.mutation?.operation,
        accepted: acceptedHarnessUpdateJson.mutation?.accepted,
        resultEntityId: acceptedHarnessUpdateJson.mutation?.resultEntityId,
      },
    }),
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
  const harnessInstallAuditResponse = await request("/api/v1/mutation-audit?operation=local_harness_install&entityId=gemini");
  const harnessInstallAudit = await parseJsonResponse(harnessInstallAuditResponse);
  const harnessInstallAuditRecord = harnessInstallAudit.records?.[0];
  recordCheck(
    "local harness install writes sanitized local mutation audit evidence",
    harnessInstallAuditResponse.status === 200 &&
      harnessInstallAudit.records?.length === 1 &&
      harnessInstallAuditRecord.operation === "local_harness_install" &&
      harnessInstallAuditRecord.entity?.id === "gemini" &&
      harnessInstallAuditRecord.accepted === true &&
      harnessInstallAuditRecord.actorClientType === "agent" &&
      harnessInstallAuditRecord.reason === "local harness install" &&
      !JSON.stringify(harnessInstallAudit.records ?? []).includes("receipt") &&
      harnessInstallAuditRecord.mutation?.expectedReadToken == null &&
      harnessInstallAuditRecord.mutation?.beforeReadToken == null &&
      harnessInstallAuditRecord.mutation?.afterReadToken == null,
    JSON.stringify({
      harnessInstallAudit,
      acceptedMutation: {
        operation: acceptedHarnessInstallJson.mutation?.operation,
        accepted: acceptedHarnessInstallJson.mutation?.accepted,
        resultEntityId: acceptedHarnessInstallJson.mutation?.resultEntityId,
      },
    }),
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

  const acceptedHarnessUpgrade = await request("/api/v1/local/harnesses/gemini/upgrade", {
    method: "POST",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": acceptedHarnessInstallJson.readToken,
    },
  });
  const acceptedHarnessUpgradeJson = await parseJsonResponse(acceptedHarnessUpgrade);
  recordCheck(
    "local harness upgrade with receipt read token is accepted",
    acceptedHarnessUpgrade.status === 200 &&
      acceptedHarnessUpgradeJson.mutation?.accepted === true &&
      hasReceipt(acceptedHarnessUpgradeJson.readToken, "local-config") &&
      acceptedHarnessUpgradeJson.readToken !== acceptedHarnessInstallJson.readToken &&
      acceptedHarnessUpgradeJson.harnesses?.find((row) => row.id === "gemini")?.installedVersion === "1.2.0",
    JSON.stringify(acceptedHarnessUpgradeJson),
    { mutation: acceptedHarnessUpgradeJson.mutation },
  );
  const harnessUpgradeAuditResponse = await request("/api/v1/mutation-audit?operation=local_harness_upgrade&entityId=gemini");
  const harnessUpgradeAudit = await parseJsonResponse(harnessUpgradeAuditResponse);
  const harnessUpgradeAuditRecord = harnessUpgradeAudit.records?.[0];
  recordCheck(
    "local harness upgrade writes sanitized local mutation audit evidence",
    harnessUpgradeAuditResponse.status === 200 &&
      harnessUpgradeAudit.records?.length === 1 &&
      harnessUpgradeAuditRecord.operation === "local_harness_upgrade" &&
      harnessUpgradeAuditRecord.entity?.id === "gemini" &&
      harnessUpgradeAuditRecord.accepted === true &&
      harnessUpgradeAuditRecord.actorClientType === "agent" &&
      harnessUpgradeAuditRecord.reason === "local harness upgrade" &&
      mutationAuditRecordsHaveNoReadTokens(harnessUpgradeAudit.records),
    JSON.stringify(harnessUpgradeAudit),
    { mutation: acceptedHarnessUpgradeJson.mutation },
  );

  const acceptedHarnessAuth = await request("/api/v1/local/harnesses/gemini/authenticate", {
    method: "POST",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": acceptedHarnessUpgradeJson.readToken,
    },
    body: JSON.stringify({ method_id: "api-key" }),
  });
  const acceptedHarnessAuthJson = await parseJsonResponse(acceptedHarnessAuth);
  recordCheck(
    "local harness authenticate with receipt read token is accepted",
    acceptedHarnessAuth.status === 200 &&
      acceptedHarnessAuthJson.mutation?.accepted === true &&
      hasReceipt(acceptedHarnessAuthJson.readToken, "local-config") &&
      acceptedHarnessAuthJson.harnesses?.find((row) => row.id === "gemini")?.auth?.status === "configured",
    JSON.stringify(acceptedHarnessAuthJson),
    { mutation: acceptedHarnessAuthJson.mutation },
  );
  const harnessAuthAuditResponse = await request("/api/v1/mutation-audit?operation=local_harness_authenticate&entityId=gemini");
  const harnessAuthAudit = await parseJsonResponse(harnessAuthAuditResponse);
  const harnessAuthAuditRecord = harnessAuthAudit.records?.[0];
  recordCheck(
    "local harness authenticate writes sanitized local mutation audit evidence",
    harnessAuthAuditResponse.status === 200 &&
      harnessAuthAudit.records?.length === 1 &&
      harnessAuthAuditRecord.operation === "local_harness_authenticate" &&
      harnessAuthAuditRecord.entity?.id === "gemini" &&
      harnessAuthAuditRecord.accepted === true &&
      harnessAuthAuditRecord.actorClientType === "agent" &&
      harnessAuthAuditRecord.reason === "local harness authenticate" &&
      mutationAuditRecordsHaveNoReadTokens(harnessAuthAudit.records),
    JSON.stringify(harnessAuthAudit),
    { mutation: acceptedHarnessAuthJson.mutation },
  );

  const acceptedHarnessUninstall = await request("/api/v1/local/harnesses/gemini/install", {
    method: "DELETE",
    headers: {
      "x-clash-client-type": "agent",
      "x-clash-if-match": acceptedHarnessAuthJson.readToken,
    },
  });
  const acceptedHarnessUninstallJson = await parseJsonResponse(acceptedHarnessUninstall);
  recordCheck(
    "local harness uninstall with receipt read token is accepted",
    acceptedHarnessUninstall.status === 200 &&
      acceptedHarnessUninstallJson.mutation?.accepted === true &&
      hasReceipt(acceptedHarnessUninstallJson.readToken, "local-config") &&
      acceptedHarnessUninstallJson.readToken !== acceptedHarnessAuthJson.readToken &&
      acceptedHarnessUninstallJson.harnesses?.find((row) => row.id === "gemini")?.installed === false,
    JSON.stringify(acceptedHarnessUninstallJson),
    { mutation: acceptedHarnessUninstallJson.mutation },
  );
  const harnessUninstallAuditResponse = await request("/api/v1/mutation-audit?operation=local_harness_uninstall&entityId=gemini");
  const harnessUninstallAudit = await parseJsonResponse(harnessUninstallAuditResponse);
  const harnessUninstallAuditRecord = harnessUninstallAudit.records?.[0];
  recordCheck(
    "local harness uninstall writes sanitized local mutation audit evidence",
    harnessUninstallAuditResponse.status === 200 &&
      harnessUninstallAudit.records?.length === 1 &&
      harnessUninstallAuditRecord.operation === "local_harness_uninstall" &&
      harnessUninstallAuditRecord.entity?.id === "gemini" &&
      harnessUninstallAuditRecord.accepted === true &&
      harnessUninstallAuditRecord.actorClientType === "agent" &&
      harnessUninstallAuditRecord.reason === "local harness uninstall" &&
      mutationAuditRecordsHaveNoReadTokens(harnessUninstallAudit.records),
    JSON.stringify(harnessUninstallAudit),
    { mutation: acceptedHarnessUninstallJson.mutation },
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
  const agentServersAuditResponse = await request("/api/v1/mutation-audit?operation=local_agent_servers_update&entityId=agent-servers");
  const agentServersAudit = await parseJsonResponse(agentServersAuditResponse);
  const agentServersAuditAgentRecord = agentServersAudit.records?.find((record) => record.actorClientType === "agent");
  recordCheck(
    "local agent servers update writes sanitized local mutation audit evidence",
    agentServersAuditResponse.status === 200 &&
      agentServersAudit.records?.length === 2 &&
      agentServersAuditAgentRecord?.operation === "local_agent_servers_update" &&
      agentServersAuditAgentRecord.entity?.id === "agent-servers" &&
      agentServersAuditAgentRecord.accepted === true &&
      agentServersAuditAgentRecord.actorClientType === "agent" &&
      agentServersAuditAgentRecord.reason === "local agent servers update" &&
      !JSON.stringify(agentServersAudit.records ?? []).includes("receipt") &&
      agentServersAudit.records.every((record) =>
        record.mutation?.expectedReadToken == null &&
        record.mutation?.beforeReadToken == null &&
        record.mutation?.afterReadToken == null
      ),
    JSON.stringify({
      agentServersAudit,
      acceptedMutation: {
        operation: acceptedAgentServersUpdateJson.mutation?.operation,
        accepted: acceptedAgentServersUpdateJson.mutation?.accepted,
        resultEntityId: acceptedAgentServersUpdateJson.mutation?.resultEntityId,
      },
    }),
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
  const providerAccountsUpdateAuditResponse = await request("/api/v1/mutation-audit?operation=provider_accounts_update&entityId=asset-receipt-smoke-user");
  const providerAccountsUpdateAudit = await parseJsonResponse(providerAccountsUpdateAuditResponse);
  const providerAccountsUpdateAuditAgentRecord = providerAccountsUpdateAudit.records?.find((record) => record.actorClientType === "agent");
  recordCheck(
    "provider accounts update writes sanitized local mutation audit evidence",
    providerAccountsUpdateAuditResponse.status === 200 &&
      providerAccountsUpdateAudit.records?.length === 2 &&
      providerAccountsUpdateAuditAgentRecord?.operation === "provider_accounts_update" &&
      providerAccountsUpdateAuditAgentRecord.entity?.id === "asset-receipt-smoke-user" &&
      providerAccountsUpdateAuditAgentRecord.accepted === true &&
      providerAccountsUpdateAuditAgentRecord.actorClientType === "agent" &&
      providerAccountsUpdateAuditAgentRecord.reason === "provider accounts update" &&
      providerAccountsUpdateAudit.records.every((record) =>
        record.mutation?.expectedReadToken == null &&
        record.mutation?.beforeReadToken == null &&
        record.mutation?.afterReadToken == null
      ),
    JSON.stringify(providerAccountsUpdateAudit),
    { mutation: acceptedProviderUpdateJson.mutation },
  );

  const providerModelTestResponse = await request("/api/v1/model-providers/test", {
    method: "POST",
    headers: { "x-clash-client-type": "agent" },
    body: JSON.stringify({
      provider: { id: "replicate-primary", providerId: "replicate", upstreamId: "replicate", enabled: true },
      modelId: "nano-banana-2",
    }),
  });
  const providerModelTestJson = await parseJsonResponse(providerModelTestResponse);
  const providerModelTestAuditResponse = await request("/api/v1/mutation-audit?operation=provider_model_test&entityId=replicate%3Anano-banana-2");
  const providerModelTestAudit = await parseJsonResponse(providerModelTestAuditResponse);
  const providerModelTestAuditRecord = providerModelTestAudit.records?.find((record) => record.actorClientType === "agent");
  recordCheck(
    "provider model test action writes sanitized local mutation audit evidence",
    providerModelTestResponse.status === 200 &&
      providerModelTestJson.ok === true &&
      providerModelTestJson.mutation?.operation === "provider_model_test" &&
      providerModelTestJson.mutation?.accepted === true &&
      providerModelTestAuditResponse.status === 200 &&
      providerModelTestAuditRecord?.operation === "provider_model_test" &&
      providerModelTestAuditRecord.entity?.id === "replicate:nano-banana-2" &&
      providerModelTestAuditRecord.accepted === true &&
      providerModelTestAuditRecord.actorClientType === "agent" &&
      providerModelTestAuditRecord.reason === "provider model test" &&
      providerModelTestAuditRecord.mutation?.expectedReadToken == null &&
      providerModelTestAuditRecord.mutation?.beforeReadToken == null &&
      providerModelTestAuditRecord.mutation?.afterReadToken == null,
    JSON.stringify({ response: providerModelTestJson, audit: providerModelTestAudit }),
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
  const providerAccountDeleteAuditResponse = await request("/api/v1/mutation-audit?operation=provider_account_delete&entityId=replicate-primary");
  const providerAccountDeleteAudit = await parseJsonResponse(providerAccountDeleteAuditResponse);
  const providerAccountDeleteAuditRecord = providerAccountDeleteAudit.records?.[0];
  recordCheck(
    "provider account delete writes sanitized local mutation audit evidence",
    providerAccountDeleteAuditResponse.status === 200 &&
      providerAccountDeleteAudit.records?.length === 1 &&
      providerAccountDeleteAuditRecord.operation === "provider_account_delete" &&
      providerAccountDeleteAuditRecord.entity?.id === "replicate-primary" &&
      providerAccountDeleteAuditRecord.accepted === true &&
      providerAccountDeleteAuditRecord.actorClientType === "agent" &&
      providerAccountDeleteAuditRecord.reason === "provider account delete" &&
      providerAccountDeleteAuditRecord.mutation?.expectedReadToken == null &&
      providerAccountDeleteAuditRecord.mutation?.beforeReadToken == null &&
      providerAccountDeleteAuditRecord.mutation?.afterReadToken == null,
    JSON.stringify(providerAccountDeleteAudit),
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
  const providerOAuthStartAuditResponse = await request("/api/v1/mutation-audit?operation=provider_oauth_start&entityId=dreamina%3Ajimeng-smoke");
  const providerOAuthStartAudit = await parseJsonResponse(providerOAuthStartAuditResponse);
  const providerOAuthStartAuditAgentRecord = providerOAuthStartAudit.records?.find((record) => record.actorClientType === "agent");
  recordCheck(
    "provider OAuth start writes sanitized local mutation audit evidence",
    providerOAuthStartAuditResponse.status === 200 &&
      providerOAuthStartAudit.records?.length === 2 &&
      providerOAuthStartAuditAgentRecord?.operation === "provider_oauth_start" &&
      providerOAuthStartAuditAgentRecord.entity?.id === "dreamina:jimeng-smoke" &&
      providerOAuthStartAuditAgentRecord.accepted === true &&
      providerOAuthStartAuditAgentRecord.actorClientType === "agent" &&
      providerOAuthStartAuditAgentRecord.reason === "provider OAuth start" &&
      providerOAuthStartAudit.records.every((record) =>
        record.mutation?.expectedReadToken == null &&
        record.mutation?.beforeReadToken == null &&
        record.mutation?.afterReadToken == null
      ),
    JSON.stringify(providerOAuthStartAudit),
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
  const providerOAuthCompleteAuditResponse = await request("/api/v1/mutation-audit?operation=provider_oauth_complete&entityId=dreamina%3Ajimeng-smoke");
  const providerOAuthCompleteAudit = await parseJsonResponse(providerOAuthCompleteAuditResponse);
  const providerOAuthCompleteAuditRecord = providerOAuthCompleteAudit.records?.[0];
  recordCheck(
    "provider OAuth complete writes sanitized local mutation audit evidence",
    providerOAuthCompleteAuditResponse.status === 200 &&
      providerOAuthCompleteAudit.records?.length === 1 &&
      providerOAuthCompleteAuditRecord.operation === "provider_oauth_complete" &&
      providerOAuthCompleteAuditRecord.entity?.id === "dreamina:jimeng-smoke" &&
      providerOAuthCompleteAuditRecord.accepted === true &&
      providerOAuthCompleteAuditRecord.actorClientType === "agent" &&
      providerOAuthCompleteAuditRecord.reason === "provider OAuth complete" &&
      providerOAuthCompleteAuditRecord.mutation?.expectedReadToken == null &&
      providerOAuthCompleteAuditRecord.mutation?.beforeReadToken == null &&
      providerOAuthCompleteAuditRecord.mutation?.afterReadToken == null,
    JSON.stringify(providerOAuthCompleteAudit),
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
  const providerOAuthDeleteAuditResponse = await request("/api/v1/mutation-audit?operation=provider_oauth_delete&entityId=dreamina%3Ajimeng-smoke");
  const providerOAuthDeleteAudit = await parseJsonResponse(providerOAuthDeleteAuditResponse);
  const providerOAuthDeleteAuditRecord = providerOAuthDeleteAudit.records?.[0];
  recordCheck(
    "provider OAuth delete writes sanitized local mutation audit evidence",
    providerOAuthDeleteAuditResponse.status === 200 &&
      providerOAuthDeleteAudit.records?.length === 1 &&
      providerOAuthDeleteAuditRecord.operation === "provider_oauth_delete" &&
      providerOAuthDeleteAuditRecord.entity?.id === "dreamina:jimeng-smoke" &&
      providerOAuthDeleteAuditRecord.accepted === true &&
      providerOAuthDeleteAuditRecord.actorClientType === "agent" &&
      providerOAuthDeleteAuditRecord.reason === "provider OAuth delete" &&
      providerOAuthDeleteAuditRecord.mutation?.expectedReadToken == null &&
      providerOAuthDeleteAuditRecord.mutation?.beforeReadToken == null &&
      providerOAuthDeleteAuditRecord.mutation?.afterReadToken == null,
    JSON.stringify(providerOAuthDeleteAudit),
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
    headers: { "x-clash-client-type": "agent" },
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

  const assetImportAuditResponse = await request(`/api/v1/mutation-audit?operation=asset_import&entityId=${encodeURIComponent(importedAssetId)}`);
  const assetImportAudit = await parseJsonResponse(assetImportAuditResponse);
  const assetImportAuditRecord = assetImportAudit.records?.[0];
  recordCheck(
    "asset import writes sanitized local mutation audit evidence",
    assetImportAuditResponse.status === 200 &&
      assetImportAudit.records?.length === 1 &&
      assetImportAuditRecord.operation === "asset_import" &&
      assetImportAuditRecord.entity?.id === importedAssetId &&
      assetImportAuditRecord.accepted === true &&
      assetImportAuditRecord.actorClientType === "agent" &&
      assetImportAuditRecord.reason === "asset import" &&
      !JSON.stringify(assetImportAuditRecord.mutation ?? {}).includes("receipt") &&
      assetImportAuditRecord.mutation?.expectedReadToken == null &&
      assetImportAuditRecord.mutation?.beforeReadToken == null &&
      assetImportAuditRecord.mutation?.afterReadToken == null,
    JSON.stringify(assetImportAudit),
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
    headers: { "x-clash-client-type": "agent" },
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

  const customActionAuditResponse = await request("/api/v1/mutation-audit?operation=custom_action_upload&entityId=custom-checkpoint-smoke");
  const customActionAudit = await parseJsonResponse(customActionAuditResponse);
  const customActionAuditRecord = customActionAudit.records?.[0];
  recordCheck(
    "custom action upload writes sanitized local mutation audit evidence",
    customActionAuditResponse.status === 200 &&
      customActionAudit.records?.length === 1 &&
      customActionAuditRecord.operation === "custom_action_upload" &&
      customActionAuditRecord.entity?.id === "custom-checkpoint-smoke" &&
      customActionAuditRecord.accepted === true &&
      customActionAuditRecord.actorClientType === "agent" &&
      customActionAuditRecord.reason === "custom action upload" &&
      !JSON.stringify(customActionAuditRecord.mutation ?? {}).includes("receipt") &&
      customActionAuditRecord.mutation?.expectedReadToken == null &&
      customActionAuditRecord.mutation?.beforeReadToken == null &&
      customActionAuditRecord.mutation?.afterReadToken == null,
    JSON.stringify(customActionAudit),
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

  const assetBlobUploadForm = new FormData();
  assetBlobUploadForm.append("file", new File(["agent-blob-upload"], "agent note.txt", { type: "text/plain" }));
  const assetBlobUploadResponse = await request("/upload", {
    method: "POST",
    headers: { "x-clash-client-type": "agent" },
    body: assetBlobUploadForm,
  });
  const assetBlobUpload = await parseJsonResponse(assetBlobUploadResponse);
  const assetBlobStorageKey = assetBlobUpload.storageKey;
  const assetBlobReadResponse = typeof assetBlobStorageKey === "string"
    ? await request(`/assets/${assetBlobStorageKey}`)
    : null;
  recordCheck(
    "asset blob upload accepts agent local file",
    assetBlobUploadResponse.status === 200 &&
      typeof assetBlobStorageKey === "string" &&
      /^uploads\/.+-agent_note\.txt$/.test(assetBlobStorageKey) &&
      assetBlobUpload.mutation?.accepted === true &&
      assetBlobUpload.mutation?.operation === "asset_blob_upload" &&
      assetBlobReadResponse?.status === 200 &&
      await assetBlobReadResponse.text() === "agent-blob-upload",
    JSON.stringify(assetBlobUpload),
    { mutation: assetBlobUpload.mutation },
  );

  const assetBlobUploadAuditResponse = typeof assetBlobStorageKey === "string"
    ? await request(`/api/v1/mutation-audit?operation=asset_blob_upload&entityId=${encodeURIComponent(assetBlobStorageKey)}`)
    : null;
  const assetBlobUploadAudit = assetBlobUploadAuditResponse
    ? await parseJsonResponse(assetBlobUploadAuditResponse)
    : { records: [] };
  const assetBlobUploadAuditRecord = assetBlobUploadAudit.records?.[0];
  recordCheck(
    "asset blob upload writes sanitized local mutation audit evidence",
    assetBlobUploadAuditResponse?.status === 200 &&
      assetBlobUploadAudit.records?.length === 1 &&
      assetBlobUploadAuditRecord.operation === "asset_blob_upload" &&
      assetBlobUploadAuditRecord.entity?.kind === "asset-blob" &&
      assetBlobUploadAuditRecord.entity?.id === assetBlobStorageKey &&
      assetBlobUploadAuditRecord.accepted === true &&
      assetBlobUploadAuditRecord.actorClientType === "agent" &&
      assetBlobUploadAuditRecord.reason === "asset blob upload" &&
      !JSON.stringify(assetBlobUploadAuditRecord.mutation ?? {}).includes("receipt") &&
      assetBlobUploadAuditRecord.mutation?.expectedReadToken == null &&
      assetBlobUploadAuditRecord.mutation?.beforeReadToken == null &&
      assetBlobUploadAuditRecord.mutation?.afterReadToken == null,
    JSON.stringify(assetBlobUploadAudit),
  );

  const escapedUploadTarget = path.join(artifactRoot, "outside-upload-target");
  const symlinkedUploadParent = path.join(dataDir, "assets", "uploads");
  await mkdir(escapedUploadTarget, { recursive: true });
  await mkdir(path.dirname(symlinkedUploadParent), { recursive: true });
  await rm(symlinkedUploadParent, { recursive: true, force: true });
  await symlink(escapedUploadTarget, symlinkedUploadParent);
  try {
    const symlinkUploadForm = new FormData();
    symlinkUploadForm.append("file", new File(["escape"], "escape.txt", { type: "text/plain" }));
    const symlinkUploadResponse = await request("/upload", {
      method: "POST",
      body: symlinkUploadForm,
    });
    const symlinkUpload = await parseJsonResponse(symlinkUploadResponse);
    recordCheck(
      "asset upload rejects symlinked parent outside local asset storage",
      symlinkUploadResponse.status === 400 &&
        symlinkUpload.error === "Asset path escapes local asset storage" &&
        symlinkUpload.mutation?.accepted === false &&
        (await readdir(escapedUploadTarget)).length === 0,
      JSON.stringify(symlinkUpload),
      { mutation: symlinkUpload.mutation },
    );

    await writeFile(path.join(escapedUploadTarget, "outside.txt"), "outside", "utf8");
    const symlinkReadResponse = await request("/assets/uploads/outside.txt");
    recordCheck(
      "asset reads reject symlinked parent outside local asset storage",
      symlinkReadResponse.status === 404 && await symlinkReadResponse.text() !== "outside",
      `status=${symlinkReadResponse.status}`,
    );
  } finally {
    await rm(symlinkedUploadParent, { force: true });
    await rm(escapedUploadTarget, { recursive: true, force: true });
  }

  const rootSymlinkDataDir = path.join(artifactRoot, "local-api-root-symlink-data");
  const escapedAssetRootTarget = path.join(artifactRoot, "outside-asset-root-target");
  const symlinkedAssetRoot = path.join(rootSymlinkDataDir, "assets");
  await mkdir(rootSymlinkDataDir, { recursive: true });
  await mkdir(escapedAssetRootTarget, { recursive: true });
  await symlink(escapedAssetRootTarget, symlinkedAssetRoot);
  try {
    const rootSymlinkApp = createLocalApiApp({
      dataDir: rootSymlinkDataDir,
      userId: "asset-receipt-root-symlink-user",
    });
    const rootSymlinkRequest = appRequest(rootSymlinkApp);
    const rootSymlinkForm = new FormData();
    rootSymlinkForm.append("file", new File(["root-escape"], "root escape.txt", { type: "text/plain" }));
    const rootSymlinkUploadResponse = await rootSymlinkRequest("/upload", {
      method: "POST",
      body: rootSymlinkForm,
    });
    const rootSymlinkUpload = await parseJsonResponse(rootSymlinkUploadResponse);
    recordCheck(
      "asset upload rejects symlinked root outside local asset storage",
      rootSymlinkUploadResponse.status === 400 &&
        rootSymlinkUpload.error === "Asset path escapes local asset storage" &&
        rootSymlinkUpload.mutation?.accepted === false &&
        (await readdir(escapedAssetRootTarget)).length === 0,
      JSON.stringify(rootSymlinkUpload),
      { mutation: rootSymlinkUpload.mutation },
    );

    await mkdir(path.join(escapedAssetRootTarget, "uploads"), { recursive: true });
    await writeFile(path.join(escapedAssetRootTarget, "uploads", "outside.txt"), "outside", "utf8");
    const rootSymlinkReadResponse = await rootSymlinkRequest("/assets/uploads/outside.txt");
    recordCheck(
      "asset reads reject symlinked root outside local asset storage",
      rootSymlinkReadResponse.status === 404 && await rootSymlinkReadResponse.text() !== "outside",
      `status=${rootSymlinkReadResponse.status}`,
    );
  } finally {
    await rm(symlinkedAssetRoot, { force: true });
    await rm(escapedAssetRootTarget, { recursive: true, force: true });
    await rm(rootSymlinkDataDir, { recursive: true, force: true });
  }

  const escapedGeneratedTarget = path.join(artifactRoot, "outside-generated-target");
  const symlinkedGeneratedParent = path.join(dataDir, "assets", "generated");
  await mkdir(escapedGeneratedTarget, { recursive: true });
  await mkdir(path.dirname(symlinkedGeneratedParent), { recursive: true });
  await symlink(escapedGeneratedTarget, symlinkedGeneratedParent);
  try {
    const workflowProjectId = "project-workflow-generated-symlink";
    const workflowRoom = await LocalLoroRoom.open({ dataDir, projectId: workflowProjectId });
    const workflowPeer = workflowRoom.addPeer(() => {});
    const workflowDoc = new LoroDoc();
    workflowDoc.getMap("nodes").set("workflow-symlink-image", {
      id: "workflow-symlink-image",
      type: "image",
      position: { x: 0, y: 0 },
      data: {
        status: "pending",
        actionType: "image-gen",
        prompt: "workflow generated asset must not escape",
        modelId: "gemini-3.1-flash-image",
      },
    });
    await workflowRoom.receive(workflowPeer, workflowDoc.export({ mode: "snapshot" }));
    const workflowFinal = new LoroDoc();
    workflowFinal.import(workflowRoom.snapshot());
    const workflowNode = workflowFinal.getMap("nodes").get("workflow-symlink-image");
    const workflowData = workflowNode?.data ?? {};
    const escapedGeneratedEntries = await readdir(escapedGeneratedTarget);
    recordCheck(
      "workflow generated asset writes reject symlinked parent outside local asset storage",
      workflowData.status === "failed" &&
        workflowData.assetId == null &&
        workflowData.error === "Asset path escapes local asset storage" &&
        escapedGeneratedEntries.length === 0 &&
        sqliteCount("select count(*) as count from assets where project_id = ?", [workflowProjectId]) === 0,
      JSON.stringify({ workflowData, escapedGeneratedEntries }),
    );
  } finally {
    await rm(symlinkedGeneratedParent, { force: true });
    await rm(escapedGeneratedTarget, { recursive: true, force: true });
  }

  const workflowAuditProjectId = "project-workflow-generated-audit";
  const workflowAuditRoom = await LocalLoroRoom.open({ dataDir, projectId: workflowAuditProjectId });
  const workflowAuditPeer = workflowAuditRoom.addPeer(() => {});
  const workflowAuditDoc = new LoroDoc();
  workflowAuditDoc.getMap("nodes").set("workflow-audit-image", {
    id: "workflow-audit-image",
    type: "image",
    position: { x: 0, y: 0 },
    data: {
      status: "pending",
      actionType: "image-gen",
      prompt: "agent workflow generated asset audit",
      modelId: "gemini-3.1-flash-image",
      actorType: "agent",
      actorAgentId: "asset-receipt-agent",
    },
  });
  await workflowAuditRoom.receive(workflowAuditPeer, workflowAuditDoc.export({ mode: "snapshot" }));
  const workflowAuditFinal = new LoroDoc();
  workflowAuditFinal.import(workflowAuditRoom.snapshot());
  const workflowAuditNode = workflowAuditFinal.getMap("nodes").get("workflow-audit-image");
  const workflowAuditData = workflowAuditNode?.data ?? {};
  const workflowGeneratedAssetId = workflowAuditData.assetId;
  const workflowGeneratedAssetResponse = typeof workflowGeneratedAssetId === "string"
    ? await request(`/api/v1/assets/${workflowGeneratedAssetId}`)
    : null;
  const workflowGeneratedAsset = workflowGeneratedAssetResponse
    ? await parseJsonResponse(workflowGeneratedAssetResponse)
    : {};
  recordCheck(
    "workflow generated asset accepts agent local generation",
    workflowAuditData.status === "completed" &&
      typeof workflowGeneratedAssetId === "string" &&
      workflowGeneratedAssetResponse?.status === 200 &&
      workflowGeneratedAsset.id === workflowGeneratedAssetId &&
      workflowGeneratedAsset.projectId === workflowAuditProjectId,
    JSON.stringify({ workflowAuditData, workflowGeneratedAsset }),
  );

  const workflowGeneratedAuditResponse = typeof workflowGeneratedAssetId === "string"
    ? await request(`/api/v1/mutation-audit?operation=asset_generate&entityId=${encodeURIComponent(workflowGeneratedAssetId)}`)
    : null;
  const workflowGeneratedAudit = workflowGeneratedAuditResponse
    ? await parseJsonResponse(workflowGeneratedAuditResponse)
    : { records: [] };
  const workflowGeneratedAuditRecord = workflowGeneratedAudit.records?.[0];
  recordCheck(
    "workflow generated asset writes sanitized local mutation audit evidence",
    workflowGeneratedAuditResponse?.status === 200 &&
      workflowGeneratedAudit.records?.length === 1 &&
      workflowGeneratedAuditRecord.operation === "asset_generate" &&
      workflowGeneratedAuditRecord.entity?.kind === "asset" &&
      workflowGeneratedAuditRecord.entity?.id === workflowGeneratedAssetId &&
      workflowGeneratedAuditRecord.accepted === true &&
      workflowGeneratedAuditRecord.actorClientType === "agent" &&
      workflowGeneratedAuditRecord.reason === "workflow generated asset" &&
      !JSON.stringify(workflowGeneratedAuditRecord.mutation ?? {}).includes("receipt") &&
      workflowGeneratedAuditRecord.mutation?.expectedReadToken == null &&
      workflowGeneratedAuditRecord.mutation?.beforeReadToken == null &&
      workflowGeneratedAuditRecord.mutation?.afterReadToken == null,
    JSON.stringify(workflowGeneratedAudit),
  );

  const workflowTextProjectId = "project-workflow-generated-text";
  const workflowTextRoom = await LocalLoroRoom.open({ dataDir, projectId: workflowTextProjectId });
  const workflowTextPeer = workflowTextRoom.addPeer(() => {});
  const workflowTextDoc = new LoroDoc();
  workflowTextDoc.getMap("nodes").set("workflow-text-node", {
    id: "workflow-text-node",
    type: "text",
    position: { x: 0, y: 0 },
    data: {
      status: "pending",
      actionType: "text-gen",
      prompt: "agent workflow generated text revision",
      modelId: "gpt-5.4",
      actorType: "agent",
      actorUserId: "asset-receipt-user",
      actorAgentId: "asset-receipt-agent",
    },
  });
  await workflowTextRoom.receive(workflowTextPeer, workflowTextDoc.export({ mode: "snapshot" }));
  const workflowTextFinal = new LoroDoc();
  workflowTextFinal.import(workflowTextRoom.snapshot());
  const workflowTextNode = workflowTextFinal.getMap("nodes").get("workflow-text-node");
  const workflowTextData = workflowTextNode?.data ?? {};
  const workflowTextRevisionResponse = await request(
    `/api/v1/projects/${encodeURIComponent(workflowTextProjectId)}/text-revisions?nodeId=workflow-text-node`,
  );
  const workflowTextRevisions = await parseJsonResponse(workflowTextRevisionResponse);
  const workflowTextRevision = workflowTextRevisions.revisions?.[0];
  const workflowTextContentResponse = workflowTextRevision?.content?.url
    ? await request(workflowTextRevision.content.url)
    : null;
  const workflowTextContent = workflowTextContentResponse
    ? await workflowTextContentResponse.text()
    : "";
  recordCheck(
    "workflow generated text indexes host text revision",
    workflowTextData.status === "completed" &&
      typeof workflowTextData.content === "string" &&
      workflowTextData.content.includes("agent workflow generated text revision") &&
      workflowTextData.assetId == null &&
      workflowTextRevisionResponse.status === 200 &&
      workflowTextRevisions.revisions?.length === 1 &&
      workflowTextRevision.kind === "clash.text.revision" &&
      workflowTextRevision.projectId === workflowTextProjectId &&
      workflowTextRevision.nodeId === "workflow-text-node" &&
      workflowTextRevision.sourceFilePath === "workflow/workflow-text-node.md" &&
      workflowTextRevision.content?.stored === true &&
      workflowTextRevision.content?.storage?.registry === "text_revisions" &&
      workflowTextRevision.content?.storage?.mediaAsset === false &&
      workflowTextRevision.content?.storage?.agentWritable === false &&
      workflowTextRevision.actor?.actorType === "agent" &&
      workflowTextRevision.actor?.actorAgentId === "asset-receipt-agent" &&
      sqliteCount("select count(*) as count from assets where project_id = ?", [workflowTextProjectId]) === 0,
    JSON.stringify({ workflowTextData, workflowTextRevisions }),
  );
  recordCheck(
    "workflow generated text content endpoint returns revision body",
    workflowTextContentResponse?.status === 200 &&
      workflowTextContent === workflowTextData.content &&
      workflowTextContentResponse.headers.get("x-clash-content-hash") === workflowTextRevision?.contentHash,
    JSON.stringify({ status: workflowTextContentResponse?.status, workflowTextContent }),
  );

  const workflowTextAuditResponse = workflowTextRevision?.revisionId
    ? await request(`/api/v1/mutation-audit?operation=text_generate&entityId=${encodeURIComponent(workflowTextRevision.revisionId)}`)
    : null;
  const workflowTextAudit = workflowTextAuditResponse
    ? await parseJsonResponse(workflowTextAuditResponse)
    : { records: [] };
  const workflowTextAuditRecord = workflowTextAudit.records?.[0];
  recordCheck(
    "workflow generated text writes sanitized local mutation audit evidence",
    workflowTextAuditResponse?.status === 200 &&
      workflowTextAudit.records?.length === 1 &&
      workflowTextAuditRecord.operation === "text_generate" &&
      workflowTextAuditRecord.entity?.kind === "text-revision" &&
      workflowTextAuditRecord.entity?.id === workflowTextRevision?.revisionId &&
      workflowTextAuditRecord.accepted === true &&
      workflowTextAuditRecord.actorClientType === "agent" &&
      workflowTextAuditRecord.reason === "workflow generated text" &&
      !JSON.stringify(workflowTextAuditRecord.mutation ?? {}).includes("receipt") &&
      workflowTextAuditRecord.mutation?.expectedReadToken == null &&
      workflowTextAuditRecord.mutation?.beforeReadToken == null &&
      workflowTextAuditRecord.mutation?.afterReadToken == null,
    JSON.stringify(workflowTextAudit),
  );

  const assetRowsBeforeInvalidCreate = sqliteCount("select count(*) as count from assets");
  const invalidAssetCreateResponse = await request("/api/v1/assets", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      kind: "image",
      srcR2Key: "../outside-asset.png",
    }),
  });
  const invalidAssetCreate = await parseJsonResponse(invalidAssetCreateResponse);
  recordCheck(
    "asset create rejects storage keys outside local asset storage",
    invalidAssetCreateResponse.status === 400 &&
      invalidAssetCreate.error === "Invalid asset storage key" &&
      invalidAssetCreate.mutation?.accepted === false &&
      sqliteCount("select count(*) as count from assets") === assetRowsBeforeInvalidCreate,
    JSON.stringify(invalidAssetCreate),
    { mutation: invalidAssetCreate.mutation },
  );

  const createdResponse = await request("/api/v1/assets", {
    method: "POST",
    headers: { "x-clash-client-type": "agent" },
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

  const assetCreateAuditResponse = await request(`/api/v1/mutation-audit?operation=asset_create&entityId=${encodeURIComponent(assetId)}`);
  const assetCreateAudit = await parseJsonResponse(assetCreateAuditResponse);
  const assetCreateAuditRecord = assetCreateAudit.records?.[0];
  recordCheck(
    "asset create writes sanitized local mutation audit evidence",
    assetCreateAuditResponse.status === 200 &&
      assetCreateAudit.records?.length === 1 &&
      assetCreateAuditRecord.operation === "asset_create" &&
      assetCreateAuditRecord.entity?.id === assetId &&
      assetCreateAuditRecord.accepted === true &&
      assetCreateAuditRecord.actorClientType === "agent" &&
      assetCreateAuditRecord.reason === "asset create" &&
      !JSON.stringify(assetCreateAuditRecord.mutation ?? {}).includes("receipt") &&
      assetCreateAuditRecord.mutation?.expectedReadToken == null &&
      assetCreateAuditRecord.mutation?.beforeReadToken == null &&
      assetCreateAuditRecord.mutation?.afterReadToken == null,
    JSON.stringify(assetCreateAudit),
  );

  const initialAsset = await fetchAssetRecord({ assetId, request });
  recordCheck(
    "asset get returns receipt read token",
    hasReceipt(initialAsset.readToken, "asset"),
    initialAsset.readToken,
  );

  const invalidAssetCoverResponse = await request(`/api/v1/assets/${encodeURIComponent(assetId)}/cover`, {
    method: "PATCH",
    body: JSON.stringify({ coverR2Key: "../outside-cover.png" }),
  });
  const invalidAssetCover = await parseJsonResponse(invalidAssetCoverResponse);
  const assetAfterInvalidCover = await fetchAssetRecord({ assetId, request });
  recordCheck(
    "asset cover update rejects storage keys outside local asset storage",
    invalidAssetCoverResponse.status === 400 &&
      invalidAssetCover.error === "Invalid asset storage key" &&
      invalidAssetCover.mutation?.accepted === false &&
      assetAfterInvalidCover.coverR2Key == null,
    JSON.stringify(invalidAssetCover),
    { mutation: invalidAssetCover.mutation },
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

  const assetCoverAuditResponse = await request(`/api/v1/mutation-audit?operation=asset_cover_update&entityId=${encodeURIComponent(assetId)}`);
  const assetCoverAudit = await parseJsonResponse(assetCoverAuditResponse);
  const assetCoverAuditRecord = assetCoverAudit.records?.[0];
  recordCheck(
    "asset cover update writes sanitized local mutation audit evidence",
    assetCoverAuditResponse.status === 200 &&
      assetCoverAudit.records?.length === 1 &&
      assetCoverAuditRecord.operation === "asset_cover_update" &&
      assetCoverAuditRecord.entity?.id === assetId &&
      assetCoverAuditRecord.accepted === true &&
      assetCoverAuditRecord.actorClientType === "agent" &&
      assetCoverAuditRecord.reason === "asset cover update" &&
      !JSON.stringify(assetCoverAuditRecord.mutation ?? {}).includes("receipt") &&
      assetCoverAuditRecord.mutation?.expectedReadToken == null &&
      assetCoverAuditRecord.mutation?.beforeReadToken == null &&
      assetCoverAuditRecord.mutation?.afterReadToken == null,
    JSON.stringify(assetCoverAudit),
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

	  const assetRefDeleteAuditResponse = await request(`/api/v1/mutation-audit?operation=asset_ref_delete&entityId=${encodeURIComponent(`${assetId}:${projectId}`)}`);
	  const assetRefDeleteAudit = await parseJsonResponse(assetRefDeleteAuditResponse);
	  const assetRefDeleteAuditRecord = assetRefDeleteAudit.records?.[0];
	  recordCheck(
	    "asset ref delete writes sanitized local mutation audit evidence",
	    assetRefDeleteAuditResponse.status === 200 &&
	      assetRefDeleteAudit.records?.length === 1 &&
	      assetRefDeleteAuditRecord.operation === "asset_ref_delete" &&
	      assetRefDeleteAuditRecord.entity?.id === `${assetId}:${projectId}` &&
	      assetRefDeleteAuditRecord.accepted === true &&
	      assetRefDeleteAuditRecord.actorClientType === "agent" &&
	      assetRefDeleteAuditRecord.reason === "asset ref delete" &&
	      assetRefDeleteAuditRecord.mutation?.expectedReadToken == null &&
	      assetRefDeleteAuditRecord.mutation?.beforeReadToken == null &&
	      assetRefDeleteAuditRecord.mutation?.afterReadToken == null,
	    JSON.stringify(assetRefDeleteAudit),
	  );

	  const refreshedAssetReferencesResponse = await request(`/api/v1/assets/${encodeURIComponent(assetId)}/references/refresh`, {
	    method: "POST",
      headers: { "x-clash-client-type": "agent" },
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

    const assetReferenceRefreshAuditResponse = await request(`/api/v1/mutation-audit?operation=asset_references_refresh&entityId=${encodeURIComponent(assetId)}`);
    const assetReferenceRefreshAudit = await parseJsonResponse(assetReferenceRefreshAuditResponse);
    const assetReferenceRefreshAuditRecord = assetReferenceRefreshAudit.records?.[0];
    recordCheck(
      "asset reference refresh writes sanitized local mutation audit evidence",
      assetReferenceRefreshAuditResponse.status === 200 &&
        assetReferenceRefreshAudit.records?.length === 1 &&
        assetReferenceRefreshAuditRecord.operation === "asset_references_refresh" &&
        assetReferenceRefreshAuditRecord.entity?.id === assetId &&
        assetReferenceRefreshAuditRecord.accepted === true &&
        assetReferenceRefreshAuditRecord.actorClientType === "agent" &&
        assetReferenceRefreshAuditRecord.reason === "asset reference refresh" &&
        !JSON.stringify(assetReferenceRefreshAuditRecord.mutation ?? {}).includes("receipt") &&
        assetReferenceRefreshAuditRecord.mutation?.expectedReadToken == null &&
        assetReferenceRefreshAuditRecord.mutation?.beforeReadToken == null &&
        assetReferenceRefreshAuditRecord.mutation?.afterReadToken == null,
      JSON.stringify(assetReferenceRefreshAudit),
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

  const nodeAuditProjectId = "project-node-audit-smoke";
  await new FileReplicaStore(path.join(dataDir, "projects")).updateSnapshotAtomic(nodeAuditProjectId, (doc) => {
    doc.getMap("nodes").set("node-script", { type: "text", data: { label: "Script", content: "before" } });
    doc.getMap("nodes").set("node-action", { type: "image_gen", data: { prompt: "use script", status: "completed" } });
    doc.getMap("nodes").set("node-output", { type: "image", data: { assetId: "node-output-asset", status: "completed" } });
    doc.getMap("nodes").set("node-loose", { type: "text", data: { label: "Loose", content: "draft" } });
    doc.getMap("edges").set("node-script-node-action", {
      source: "node-script",
      target: "node-action",
      type: "reference",
    });
    doc.getMap("edges").set("node-action-node-output", {
      source: "node-action",
      target: "node-output",
      type: "materialized",
    });
    return { value: null };
  });

  const scriptReadResponse = await request(`/api/v1/projects/${nodeAuditProjectId}/canvas/nodes/node-script`);
  const scriptRead = await parseJsonResponse(scriptReadResponse);
  recordCheck(
    "canvas node read returns receipt read token",
    scriptReadResponse.status === 200 && hasReceipt(scriptRead.readToken, "node"),
    JSON.stringify(scriptRead),
    { readToken: scriptRead.readToken },
  );

  const referencedNodePatchResponse = await request(`/api/v1/projects/${nodeAuditProjectId}/canvas/nodes/node-script`, {
    method: "PATCH",
    body: JSON.stringify({
      actorClientType: "agent",
      ifMatch: scriptRead.readToken,
      content: "after",
    }),
  });
  const referencedNodePatch = await parseJsonResponse(referencedNodePatchResponse);
  recordCheck(
    "canvas node content update with downstream reference is rejected",
    referencedNodePatchResponse.status === 409 &&
      /Refusing to patch referenced text content/.test(referencedNodePatch.error ?? "") &&
      referencedNodePatch.mutation?.operation === "canvas_update" &&
      referencedNodePatch.mutation?.accepted === false,
    JSON.stringify(referencedNodePatch),
    { mutation: referencedNodePatch.mutation },
  );

  const looseReadResponse = await request(`/api/v1/projects/${nodeAuditProjectId}/canvas/nodes/node-loose`);
  const looseRead = await parseJsonResponse(looseReadResponse);
  recordCheck(
    "canvas node loose read returns receipt read token",
    looseReadResponse.status === 200 && hasReceipt(looseRead.readToken, "node"),
    JSON.stringify(looseRead),
    { readToken: looseRead.readToken },
  );

  const bareNodeUpdateResponse = await request(`/api/v1/projects/${nodeAuditProjectId}/canvas/nodes/node-loose`, {
    method: "PATCH",
    body: JSON.stringify({
      actorClientType: "agent",
      ifMatch: baseReadToken(looseRead.readToken),
      label: "Bare CAS rejected",
    }),
  });
  const bareNodeUpdate = await parseJsonResponse(bareNodeUpdateResponse);
  recordCheck(
    "canvas node update with bare CAS token is rejected",
    bareNodeUpdateResponse.status === 409 &&
      /Missing canvas update read receipt for agent/.test(bareNodeUpdate.error ?? "") &&
      bareNodeUpdate.mutation?.expectedReadToken === baseReadToken(looseRead.readToken),
    JSON.stringify(bareNodeUpdate),
    { mutation: bareNodeUpdate.mutation },
  );

  const nodeUpdateResponse = await request(`/api/v1/projects/${nodeAuditProjectId}/canvas/nodes/node-loose`, {
    method: "PATCH",
    body: JSON.stringify({
      actorClientType: "agent",
      ifMatch: looseRead.readToken,
      label: "Loose v2",
      content: "after",
    }),
  });
  const nodeUpdate = await parseJsonResponse(nodeUpdateResponse);
  recordCheck(
    "canvas node update with receipt is accepted",
    nodeUpdateResponse.status === 200 &&
      hasReceipt(nodeUpdate.readToken, "node") &&
      nodeUpdate.node?.data?.label === "Loose v2" &&
      nodeUpdate.node?.data?.content === "after" &&
      nodeUpdate.mutation?.operation === "canvas_update" &&
      nodeUpdate.mutation?.expectedReadToken === looseRead.readToken &&
      nodeUpdate.mutation?.beforeReadToken === baseReadToken(looseRead.readToken) &&
      nodeUpdate.mutation?.afterReadToken === nodeUpdate.readToken,
    JSON.stringify(nodeUpdate),
    { mutation: nodeUpdate.mutation, readToken: nodeUpdate.readToken },
  );

  const nodeDeleteResponse = await request(`/api/v1/projects/${nodeAuditProjectId}/canvas/nodes/node-loose`, {
    method: "DELETE",
    body: JSON.stringify({
      actorClientType: "agent",
      ifMatch: nodeUpdate.readToken,
    }),
  });
  const nodeDelete = await parseJsonResponse(nodeDeleteResponse);
  recordCheck(
    "canvas node delete with receipt is accepted",
    nodeDeleteResponse.status === 200 &&
      nodeDelete.deleted === true &&
      nodeDelete.mutation?.operation === "canvas_delete" &&
      nodeDelete.mutation?.expectedReadToken === nodeUpdate.readToken &&
      nodeDelete.mutation?.beforeReadToken === baseReadToken(nodeUpdate.readToken) &&
      nodeDelete.mutation?.accepted === true,
    JSON.stringify(nodeDelete),
    { mutation: nodeDelete.mutation },
  );

  const nodeUpdateAuditResponse = await request("/api/v1/mutation-audit?operation=canvas_update&entityId=node-loose");
  const nodeUpdateAudit = await parseJsonResponse(nodeUpdateAuditResponse);
  const nodeUpdateAuditRecord = nodeUpdateAudit.records?.[0];
  recordCheck(
    "canvas node update writes sanitized local mutation audit evidence",
    nodeUpdateAuditResponse.status === 200 &&
      nodeUpdateAudit.records?.length === 1 &&
      nodeUpdateAuditRecord.operation === "canvas_update" &&
      nodeUpdateAuditRecord.entity?.id === "node-loose" &&
      nodeUpdateAuditRecord.accepted === true &&
      nodeUpdateAuditRecord.reason === "canvas node update" &&
      !JSON.stringify(nodeUpdateAuditRecord.mutation ?? {}).includes("receipt") &&
      nodeUpdateAuditRecord.mutation?.expectedReadToken == null &&
      nodeUpdateAuditRecord.mutation?.beforeReadToken == null &&
      nodeUpdateAuditRecord.mutation?.afterReadToken == null,
    JSON.stringify(nodeUpdateAudit),
  );

  const nodeDeleteAuditResponse = await request("/api/v1/mutation-audit?operation=canvas_delete&entityId=node-loose");
  const nodeDeleteAudit = await parseJsonResponse(nodeDeleteAuditResponse);
  const nodeDeleteAuditRecord = nodeDeleteAudit.records?.[0];
  recordCheck(
    "canvas node delete writes sanitized local mutation audit evidence",
    nodeDeleteAuditResponse.status === 200 &&
      nodeDeleteAudit.records?.length === 1 &&
      nodeDeleteAuditRecord.operation === "canvas_delete" &&
      nodeDeleteAuditRecord.entity?.id === "node-loose" &&
      nodeDeleteAuditRecord.accepted === true &&
      nodeDeleteAuditRecord.reason === "canvas node delete" &&
      !JSON.stringify(nodeDeleteAuditRecord.mutation ?? {}).includes("receipt") &&
      nodeDeleteAuditRecord.mutation?.expectedReadToken == null &&
      nodeDeleteAuditRecord.mutation?.beforeReadToken == null &&
      nodeDeleteAuditRecord.mutation?.afterReadToken == null,
    JSON.stringify(nodeDeleteAudit),
  );

  const batchAuditProjectId = "project-batch-audit-smoke";
  await new FileReplicaStore(path.join(dataDir, "projects")).updateSnapshotAtomic(batchAuditProjectId, (doc) => {
    doc.getMap("nodes").set("batch-root", { type: "text", data: { label: "Root" } });
    doc.getMap("nodes").set("batch-child", { type: "image_gen", data: { prompt: "child", status: "completed" } });
    doc.getMap("nodes").set("batch-external", { type: "image", data: { assetId: "batch-output-asset", status: "completed" } });
    doc.getMap("edges").set("batch-root-child", {
      source: "batch-root",
      target: "batch-child",
      type: "reference",
    });
    doc.getMap("edges").set("batch-child-external", {
      source: "batch-child",
      target: "batch-external",
      type: "materialized",
    });
    return { value: null };
  });

  const partialBatchPlanResponse = await request(`/api/v1/projects/${batchAuditProjectId}/canvas/delete-plan`, {
    method: "POST",
    body: JSON.stringify({ nodeIds: ["batch-root", "batch-child"] }),
  });
  const partialBatchPlan = await parseJsonResponse(partialBatchPlanResponse);
  recordCheck(
    "canvas batch delete plan returns graph receipt read token",
    partialBatchPlanResponse.status === 200 &&
      hasReceipt(partialBatchPlan.readToken, "canvas-batch-delete") &&
      partialBatchPlan.nodes?.length === 2 &&
      partialBatchPlan.edges?.length === 2,
    JSON.stringify(partialBatchPlan),
    { readToken: partialBatchPlan.readToken },
  );

  const partialBatchDeleteResponse = await request(`/api/v1/projects/${batchAuditProjectId}/canvas/delete-batch`, {
    method: "POST",
    body: JSON.stringify({
      nodeIds: ["batch-root", "batch-child"],
      actorClientType: "agent",
      ifMatch: partialBatchPlan.readToken,
    }),
  });
  const partialBatchDelete = await parseJsonResponse(partialBatchDeleteResponse);
  recordCheck(
    "canvas batch delete rejects orphaning external references",
    partialBatchDeleteResponse.status === 409 &&
      /Refusing to delete referenced node/.test(partialBatchDelete.error ?? "") &&
      partialBatchDelete.mutation?.operation === "canvas_batch_delete" &&
      partialBatchDelete.mutation?.accepted === false,
    JSON.stringify(partialBatchDelete),
    { mutation: partialBatchDelete.mutation },
  );

  const fullBatchPlanResponse = await request(`/api/v1/projects/${batchAuditProjectId}/canvas/delete-plan`, {
    method: "POST",
    body: JSON.stringify({ nodeIds: ["batch-root", "batch-child", "batch-external"] }),
  });
  const fullBatchPlan = await parseJsonResponse(fullBatchPlanResponse);
  const bareBatchDeleteResponse = await request(`/api/v1/projects/${batchAuditProjectId}/canvas/delete-batch`, {
    method: "POST",
    body: JSON.stringify({
      nodeIds: ["batch-root", "batch-child", "batch-external"],
      actorClientType: "agent",
      ifMatch: baseReadToken(fullBatchPlan.readToken),
    }),
  });
  const bareBatchDelete = await parseJsonResponse(bareBatchDeleteResponse);
  recordCheck(
    "canvas batch delete with bare CAS token is rejected",
    bareBatchDeleteResponse.status === 409 &&
      /Missing canvas batch delete read receipt for agent/.test(bareBatchDelete.error ?? ""),
    JSON.stringify(bareBatchDelete),
    { mutation: bareBatchDelete.mutation },
  );

  const batchDeleteResponse = await request(`/api/v1/projects/${batchAuditProjectId}/canvas/delete-batch`, {
    method: "POST",
    body: JSON.stringify({
      nodeIds: ["batch-root", "batch-child", "batch-external"],
      actorClientType: "agent",
      ifMatch: fullBatchPlan.readToken,
    }),
  });
  const batchDelete = await parseJsonResponse(batchDeleteResponse);
  recordCheck(
    "canvas batch delete with receipt is accepted",
    batchDeleteResponse.status === 200 &&
      batchDelete.deleted === true &&
      batchDelete.mutation?.operation === "canvas_batch_delete" &&
      batchDelete.mutation?.expectedReadToken === fullBatchPlan.readToken &&
      batchDelete.mutation?.beforeReadToken === baseReadToken(fullBatchPlan.readToken) &&
      batchDelete.mutation?.accepted === true,
    JSON.stringify(batchDelete),
    { mutation: batchDelete.mutation },
  );

  const batchDeleteAuditResponse = await request("/api/v1/mutation-audit?operation=canvas_batch_delete&entityId=batch-root,batch-child,batch-external");
  const batchDeleteAudit = await parseJsonResponse(batchDeleteAuditResponse);
  const batchDeleteAuditRecord = batchDeleteAudit.records?.[0];
  recordCheck(
    "canvas batch delete writes sanitized local mutation audit evidence",
    batchDeleteAuditResponse.status === 200 &&
      batchDeleteAudit.records?.length === 1 &&
      batchDeleteAuditRecord.operation === "canvas_batch_delete" &&
      batchDeleteAuditRecord.entity?.id === "batch-root,batch-child,batch-external" &&
      batchDeleteAuditRecord.accepted === true &&
      batchDeleteAuditRecord.reason === "canvas batch delete" &&
      !JSON.stringify(batchDeleteAuditRecord.mutation ?? {}).includes("receipt") &&
      batchDeleteAuditRecord.mutation?.expectedReadToken == null &&
      batchDeleteAuditRecord.mutation?.beforeReadToken == null,
    JSON.stringify(batchDeleteAudit),
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

  const obsoleteProjectEndpointChecks = await Promise.all([
    request("/api/projects", { method: "GET" }),
    request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json", "x-clash-client-type": "agent" },
      body: JSON.stringify({ prompt: "Legacy Project Create Audit Smoke" }),
    }),
    request(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-clash-client-type": "agent" },
      body: JSON.stringify({ name: "Legacy Project Rename Audit Smoke" }),
    }),
    request(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" }),
  ]);
  recordCheck(
    "obsolete local project endpoints are not exposed",
    obsoleteProjectEndpointChecks.every((response) => response.status === 404),
    JSON.stringify(obsoleteProjectEndpointChecks.map((response) => response.status)),
  );

  const restoreProjectResponse = await request("/api/v1/projects", {
    method: "POST",
    headers: { "x-clash-client-type": "agent" },
    body: JSON.stringify({ name: "Project Restore Receipt Smoke" }),
  });
  const restoreProject = await parseJsonResponse(restoreProjectResponse);
  recordCheck(
    "project restore source project create accepted",
    restoreProjectResponse.status === 201 && hasReceipt(restoreProject.readToken, "project"),
    `status=${restoreProjectResponse.status} id=${restoreProject.id ?? ""} readToken=${restoreProject.readToken ?? ""}`,
    { mutation: restoreProject.mutation },
  );
  const projectCreateAuditResponse = await request(`/api/v1/mutation-audit?operation=project_create&entityId=${encodeURIComponent(restoreProject.id)}`);
  const projectCreateAudit = await parseJsonResponse(projectCreateAuditResponse);
  const projectCreateAuditRecord = projectCreateAudit.records?.[0];
  recordCheck(
    "v1 project create writes sanitized local mutation audit evidence",
    restoreProjectResponse.status === 201 &&
      restoreProject.mutation?.accepted === true &&
      projectCreateAuditResponse.status === 200 &&
      projectCreateAudit.records?.length === 1 &&
      projectCreateAuditRecord.operation === "project_create" &&
      projectCreateAuditRecord.entity?.id === restoreProject.id &&
      projectCreateAuditRecord.accepted === true &&
      projectCreateAuditRecord.actorClientType === "agent" &&
      projectCreateAuditRecord.reason === "v1 project create" &&
      !JSON.stringify(projectCreateAuditRecord.mutation ?? {}).includes("receipt") &&
      projectCreateAuditRecord.mutation?.expectedReadToken == null &&
      projectCreateAuditRecord.mutation?.beforeReadToken == null &&
      projectCreateAuditRecord.mutation?.afterReadToken == null,
    JSON.stringify({ restoreProject, projectCreateAudit }),
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

  const restoredProjectStatusResponse = await request(`/api/v1/projects/${encodeURIComponent(restoreProject.id)}/status`);
  const restoredProjectStatus = await parseJsonResponse(restoredProjectStatusResponse);
  recordCheck(
    "restored project status preserves local storage path contract",
    restoredProjectStatusResponse.status === 200 &&
      restoredProjectStatus.projectId === restoreProject.id &&
      restoredProjectStatus.source === "explicit" &&
      restoredProjectStatus.localApiDataDir === path.resolve(dataDir) &&
      restoredProjectStatus.localSqlitePath === path.join(path.resolve(dataDir), "local.sqlite") &&
      restoredProjectStatus.storage?.workspace?.ownsCanonicalSnapshot === false &&
      restoredProjectStatus.storage?.workspace?.ownsCanonicalMetadata === false &&
      restoredProjectStatus.storage?.canonicalReplica?.metadata?.path === restoredProjectStatus.localSqlitePath &&
      restoredProjectStatus.storage?.canonicalReplica?.metadata?.agentWritable === false &&
      restoredProjectStatus.storage?.canonicalReplica?.canvas?.agentWritable === false &&
      isSameOrInside(restoredProjectStatus.roots?.runtime ?? "", restoredProjectStatus.projectWorkspaceRoot ?? "") &&
      restoredProjectStatus.protectedPaths?.includes(restoredProjectStatus.roots?.runtime) === true &&
      restoredProjectStatus.protectedPaths?.includes(restoredProjectStatus.loro?.snapshotPath) === true,
    JSON.stringify(restoredProjectStatus),
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
    headers: { "x-clash-client-type": "agent" },
    body: JSON.stringify({ projectId: sessionProject.id, title: "Receipt guarded session" }),
  });
  const sessionCreated = await parseJsonResponse(sessionResponse);
  recordCheck(
    "session create accepted",
    sessionResponse.status === 200 && typeof sessionCreated.threadId === "string",
    `status=${sessionResponse.status} threadId=${sessionCreated.threadId ?? ""}`,
    { mutation: sessionCreated.mutation },
  );
  const sessionCreateAuditResponse = await request(`/api/v1/mutation-audit?operation=session_create&entityId=${encodeURIComponent(sessionCreated.threadId)}`);
  const sessionCreateAudit = await parseJsonResponse(sessionCreateAuditResponse);
  const sessionCreateAuditRecord = sessionCreateAudit.records?.[0];
  recordCheck(
    "session create writes sanitized local mutation audit evidence",
    sessionResponse.status === 200 &&
      sessionCreated.mutation?.accepted === true &&
      sessionCreateAuditResponse.status === 200 &&
      sessionCreateAudit.records?.length === 1 &&
      sessionCreateAuditRecord.operation === "session_create" &&
      sessionCreateAuditRecord.entity?.id === sessionCreated.threadId &&
      sessionCreateAuditRecord.accepted === true &&
      sessionCreateAuditRecord.actorClientType === "agent" &&
      sessionCreateAuditRecord.reason === "session create" &&
      !JSON.stringify(sessionCreateAuditRecord.mutation ?? {}).includes("receipt") &&
      sessionCreateAuditRecord.mutation?.expectedReadToken == null &&
      sessionCreateAuditRecord.mutation?.beforeReadToken == null &&
      sessionCreateAuditRecord.mutation?.afterReadToken == null,
    JSON.stringify({ sessionCreated, sessionCreateAudit }),
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
	  const runtimeSessionCreateAuditResponse = await request(`/api/v1/mutation-audit?operation=runtime_session_create&entityId=${encodeURIComponent(runtimeSession.session_id)}`);
	  const runtimeSessionCreateAudit = await parseJsonResponse(runtimeSessionCreateAuditResponse);
	  const runtimeSessionCreateAuditRecord = runtimeSessionCreateAudit.records?.[0];
	  recordCheck(
	    "runtime session create writes sanitized local mutation audit evidence",
	    runtimeSessionCreateAuditResponse.status === 200 &&
	      runtimeSessionCreateAudit.records?.length === 1 &&
	      runtimeSessionCreateAuditRecord.operation === "runtime_session_create" &&
	      runtimeSessionCreateAuditRecord.entity?.id === runtimeSession.session_id &&
	      runtimeSessionCreateAuditRecord.accepted === true &&
	      runtimeSessionCreateAuditRecord.actorClientType == null &&
	      runtimeSessionCreateAuditRecord.reason === "runtime session create" &&
	      mutationAuditRecordsHaveNoReadTokens(runtimeSessionCreateAudit.records),
	    JSON.stringify(runtimeSessionCreateAudit),
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
	  const runtimeSessionAttachAuditResponse = await request(`/api/v1/mutation-audit?operation=runtime_session_attach&entityId=${encodeURIComponent(runtimeSession.session_id)}`);
	  const runtimeSessionAttachAudit = await parseJsonResponse(runtimeSessionAttachAuditResponse);
	  const runtimeSessionAttachAuditRecord = runtimeSessionAttachAudit.records?.[0];
	  recordCheck(
	    "runtime session attach writes sanitized local mutation audit evidence",
	    runtimeSessionAttachAuditResponse.status === 200 &&
	      runtimeSessionAttachAudit.records?.length === 1 &&
	      runtimeSessionAttachAuditRecord.operation === "runtime_session_attach" &&
	      runtimeSessionAttachAuditRecord.entity?.id === runtimeSession.session_id &&
	      runtimeSessionAttachAuditRecord.accepted === true &&
	      runtimeSessionAttachAuditRecord.actorClientType === "agent" &&
	      runtimeSessionAttachAuditRecord.reason === "runtime session attach" &&
	      mutationAuditRecordsHaveNoReadTokens(runtimeSessionAttachAudit.records),
	    JSON.stringify(runtimeSessionAttachAudit),
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
	  const localRoomMessageAuditResponse = await request("/api/v1/mutation-audit?operation=room_message_create&entityId=room-message-replay-smoke");
	  const localRoomMessageAudit = await parseJsonResponse(localRoomMessageAuditResponse);
	  const localRoomMessageAuditRecord = localRoomMessageAudit.records?.[0];
	  recordCheck(
	    "local room message create writes sanitized local mutation audit evidence",
	    localRoomMessageAuditResponse.status === 200 &&
	      localRoomMessageAudit.records?.length === 1 &&
	      localRoomMessageAuditRecord.operation === "room_message_create" &&
	      localRoomMessageAuditRecord.entity?.id === "room-message-replay-smoke" &&
	      localRoomMessageAuditRecord.accepted === true &&
	      localRoomMessageAuditRecord.actorClientType == null &&
	      localRoomMessageAuditRecord.reason === "local room message create" &&
	      mutationAuditRecordsHaveNoReadTokens(localRoomMessageAudit.records),
	    JSON.stringify(localRoomMessageAudit),
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

	  const missingProjectRoomSyncResponse = await request("/api/v1/projects/missing-project/room/sync", {
	    method: "POST",
	  });
	  const missingProjectRoomSync = await parseJsonResponse(missingProjectRoomSyncResponse);
	  recordCheck(
	    "room sync checks project existence before remote admission",
	    missingProjectRoomSyncResponse.status === 404 &&
	      missingProjectRoomSync.error === "not found" &&
	      missingProjectRoomSync.mutation?.accepted === false &&
	      missingProjectRoomSync.mutation?.error === "not found",
	    JSON.stringify(missingProjectRoomSync),
	    { mutation: missingProjectRoomSync.mutation },
	  );

	  const localOnlyRoomDataDir = path.join(artifactRoot, "local-only-room-data");
	  await mkdir(localOnlyRoomDataDir, { recursive: true });
	  const localOnlyRoomApp = createLocalApiApp({
	    dataDir: localOnlyRoomDataDir,
	    userId: "asset-receipt-smoke-user",
	  });
	  const localOnlyRoomRequest = appRequest(localOnlyRoomApp);
	  const localOnlyRoomProjectResponse = await localOnlyRoomRequest("/api/v1/projects", {
	    method: "POST",
	    body: JSON.stringify({ name: "Local-only room admission smoke" }),
	  });
	  const localOnlyRoomProject = await parseJsonResponse(localOnlyRoomProjectResponse);
	  const localOnlyRoomSyncResponse = await localOnlyRoomRequest(`/api/v1/projects/${encodeURIComponent(localOnlyRoomProject.id)}/room/sync`, {
	    method: "POST",
	  });
	  const localOnlyRoomSync = await parseJsonResponse(localOnlyRoomSyncResponse);
	  recordCheck(
	    "local-only room sync returns explicit admission gate",
	    localOnlyRoomSyncResponse.status === 409 &&
	      localOnlyRoomSync.error === "remote room sync is not configured" &&
	      localOnlyRoomSync.admission?.allowed === false &&
	      localOnlyRoomSync.admission?.reason === "remote-room-not-configured" &&
	      localOnlyRoomSync.admission?.requirements?.includes("enable-sync") === true &&
	      localOnlyRoomSync.sync?.mode === "local-only" &&
	      localOnlyRoomSync.sync?.remote_room?.status === "disabled" &&
	      localOnlyRoomSync.mutation?.accepted === false,
	    JSON.stringify(localOnlyRoomSync),
	    { mutation: localOnlyRoomSync.mutation },
	  );

	  const acceptedRoomSyncDataDir = path.join(artifactRoot, "accepted-room-sync-data");
	  await mkdir(acceptedRoomSyncDataDir, { recursive: true });
	  const remoteRoomRequests = [];
	  const acceptedRoomSyncConfig = createLocalSyncConfigStore({
	    dataDir: acceptedRoomSyncDataDir,
	    env: {},
	    fetch: async (input, init = {}) => {
	      const headers = new Headers(init.headers);
	      remoteRoomRequests.push({
	        input,
	        method: init.method ?? "GET",
	        authorization: headers.get("authorization"),
	        body: init.body ? String(init.body) : "",
	      });
	      if (!init.method || init.method === "GET") {
	        return new Response(JSON.stringify({
	          messages: [
	            {
	              id: "remote-room-sync-smoke",
	              project_id: "ignored-by-local-api",
	              sender_kind: "user",
	              sender_id: "remote-user",
	              sender_user_id: "remote-user",
	              mentions: [],
	              text: "remote room sync smoke",
	              at: 1_700_000_100,
	            },
	          ],
	        }), { headers: { "content-type": "application/json" } });
	      }
	      if (init.method === "POST") {
	        return new Response(JSON.stringify({ ok: true }), {
	          status: 201,
	          headers: { "content-type": "application/json" },
	        });
	      }
	      return new Response("unexpected room sync method", { status: 500 });
	    },
	  });
	  await acceptedRoomSyncConfig.updateFromRequest({
	    mode: "cloud-sync",
	    remote_loro_url: "https://room-sync.example",
	    remote_loro_token: "room-token",
	    capabilities: { room: true },
	  });
	  const acceptedRoomSyncApp = createLocalApiApp({
	    dataDir: acceptedRoomSyncDataDir,
	    userId: "asset-receipt-smoke-user",
	    syncConfig: acceptedRoomSyncConfig,
	  });
	  const acceptedRoomRequest = appRequest(acceptedRoomSyncApp);
	  const acceptedRoomProjectResponse = await acceptedRoomRequest("/api/v1/projects", {
	    method: "POST",
	    body: JSON.stringify({ name: "Accepted Room Sync Smoke" }),
	  });
	  const acceptedRoomProject = await parseJsonResponse(acceptedRoomProjectResponse);
	  const acceptedLocalRoomMessageResponse = await acceptedRoomRequest(`/api/v1/projects/${encodeURIComponent(acceptedRoomProject.id)}/room/messages`, {
	    method: "POST",
	    body: JSON.stringify({
	      id: "local-room-sync-smoke",
	      text: "local room sync smoke",
	    }),
	  });
	  const acceptedLocalRoomMessage = await parseJsonResponse(acceptedLocalRoomMessageResponse);
	  const acceptedRoomSyncResponse = await acceptedRoomRequest(`/api/v1/projects/${encodeURIComponent(acceptedRoomProject.id)}/room/sync`, {
	    method: "POST",
	  });
	  const acceptedRoomSync = await parseJsonResponse(acceptedRoomSyncResponse);
	  recordCheck(
	    "room sync mirrors local and remote messages through explicit action",
	    acceptedRoomProjectResponse.status === 201 &&
	      acceptedLocalRoomMessageResponse.status === 200 &&
	      acceptedLocalRoomMessage.mutation?.accepted === true &&
	      acceptedRoomSyncResponse.status === 200 &&
	      acceptedRoomSync.mutation?.operation === "room_sync" &&
	      acceptedRoomSync.mutation?.accepted === true &&
	      acceptedRoomSync.plan?.exportedIds?.includes("local-room-sync-smoke") === true &&
	      acceptedRoomSync.plan?.importedIds?.includes("remote-room-sync-smoke") === true &&
	      remoteRoomRequests.some((request) =>
	        request.method === "POST" &&
	        request.authorization === "Bearer room-token" &&
	        request.body.includes("local room sync smoke")
	      ),
	    JSON.stringify({ acceptedRoomSync, remoteRoomRequests }),
	    { mutation: acceptedRoomSync.mutation },
	  );
	  const acceptedRoomSyncAuditResponse = await acceptedRoomRequest(`/api/v1/mutation-audit?operation=room_sync&entityId=${encodeURIComponent(acceptedRoomProject.id)}`);
	  const acceptedRoomSyncAudit = await parseJsonResponse(acceptedRoomSyncAuditResponse);
	  const acceptedRoomSyncAuditRecord = acceptedRoomSyncAudit.records?.[0];
	  recordCheck(
	    "room sync writes sanitized local mutation audit evidence",
	    acceptedRoomSyncAuditResponse.status === 200 &&
	      acceptedRoomSyncAudit.records?.length === 1 &&
	      acceptedRoomSyncAuditRecord.operation === "room_sync" &&
	      acceptedRoomSyncAuditRecord.entity?.id === acceptedRoomProject.id &&
	      acceptedRoomSyncAuditRecord.entity?.kind === "room" &&
	      acceptedRoomSyncAuditRecord.accepted === true &&
	      acceptedRoomSyncAuditRecord.reason === "room sync" &&
	      mutationAuditRecordsHaveNoReadTokens(acceptedRoomSyncAudit.records),
	    JSON.stringify(acceptedRoomSyncAudit),
	    { mutation: acceptedRoomSync.mutation },
	  );

	  const conflictRoomDataDir = path.join(artifactRoot, "conflict-room-sync-data");
	  await mkdir(conflictRoomDataDir, { recursive: true });
	  const conflictRoomSyncConfig = createLocalSyncConfigStore({
	    dataDir: conflictRoomDataDir,
	    env: {},
	    fetch: async (_input, init = {}) => {
	      if (!init.method || init.method === "GET") {
	        return new Response(JSON.stringify({
	          messages: [
	            {
	              id: "room-sync-conflict-smoke",
	              project_id: "ignored-by-local-api",
	              sender_kind: "user",
	              sender_id: "remote-user",
	              sender_user_id: "remote-user",
	              mentions: [],
	              text: "remote room conflict text",
	              at: 1_700_000_300,
	            },
	          ],
	        }), { headers: { "content-type": "application/json" } });
	      }
	      return new Response("unexpected remote conflict write", { status: 500 });
	    },
	  });
	  await conflictRoomSyncConfig.updateFromRequest({
	    mode: "cloud-sync",
	    remote_loro_url: "https://room-sync-conflict.example",
	    remote_loro_token: "room-conflict-token",
	    capabilities: { room: true },
	  });
	  const conflictRoomApp = createLocalApiApp({
	    dataDir: conflictRoomDataDir,
	    userId: "asset-receipt-smoke-user",
	    syncConfig: conflictRoomSyncConfig,
	  });
	  const conflictRoomRequest = appRequest(conflictRoomApp);
	  const conflictRoomProjectResponse = await conflictRoomRequest("/api/v1/projects", {
	    method: "POST",
	    body: JSON.stringify({ name: "Room Sync Conflict Smoke" }),
	  });
	  const conflictRoomProject = await parseJsonResponse(conflictRoomProjectResponse);
	  await conflictRoomRequest(`/api/v1/projects/${encodeURIComponent(conflictRoomProject.id)}/room/messages`, {
	    method: "POST",
	    body: JSON.stringify({
	      id: "room-sync-conflict-smoke",
	      text: "local room conflict text",
	    }),
	  });
	  const conflictedRoomSyncResponse = await conflictRoomRequest(`/api/v1/projects/${encodeURIComponent(conflictRoomProject.id)}/room/sync`, {
	    method: "POST",
	  });
	  const conflictedRoomSync = await parseJsonResponse(conflictedRoomSyncResponse);
	  const roomConflict = conflictedRoomSync.plan?.conflicts?.[0];
	  recordCheck(
	    "room sync conflict exposes local and remote hashes without overwrite",
	    conflictedRoomSyncResponse.status === 409 &&
	      conflictedRoomSync.error === "room sync conflict" &&
	      roomConflict?.id === "room-sync-conflict-smoke" &&
	      roomConflict?.local?.text === "local room conflict text" &&
	      roomConflict?.remote?.text === "remote room conflict text" &&
	      typeof roomConflict?.local?.contentHash === "string" &&
	      typeof roomConflict?.remote?.contentHash === "string" &&
	      conflictedRoomSync.mutation?.operation === "room_sync" &&
	      conflictedRoomSync.mutation?.accepted === false,
	    JSON.stringify(conflictedRoomSync),
	    { mutation: conflictedRoomSync.mutation },
	  );
	  const staleConflictResolutionResponse = await conflictRoomRequest(
	    `/api/v1/projects/${encodeURIComponent(conflictRoomProject.id)}/room/sync/conflicts/room-sync-conflict-smoke/resolve`,
	    {
	      method: "POST",
	      body: JSON.stringify({
	        resolution: "accept-divergence",
	        localContentHash: "stale-local-hash",
	        remoteContentHash: roomConflict?.remote?.contentHash,
	      }),
	    },
	  );
	  const staleConflictResolution = await parseJsonResponse(staleConflictResolutionResponse);
	  recordCheck(
	    "room sync conflict recovery rejects stale hashes",
	    staleConflictResolutionResponse.status === 409 &&
	      staleConflictResolution.error === "stale room sync conflict resolution" &&
	      staleConflictResolution.mutation?.operation === "room_sync_conflict_resolve" &&
	      staleConflictResolution.mutation?.accepted === false,
	    JSON.stringify(staleConflictResolution),
	    { mutation: staleConflictResolution.mutation },
	  );
	  const acceptedConflictResolutionResponse = await conflictRoomRequest(
	    `/api/v1/projects/${encodeURIComponent(conflictRoomProject.id)}/room/sync/conflicts/room-sync-conflict-smoke/resolve`,
	    {
	      method: "POST",
	      body: JSON.stringify({
	        resolution: "accept-divergence",
	        localContentHash: roomConflict?.local?.contentHash,
	        remoteContentHash: roomConflict?.remote?.contentHash,
	      }),
	    },
	  );
	  const acceptedConflictResolution = await parseJsonResponse(acceptedConflictResolutionResponse);
	  recordCheck(
	    "room sync conflict recovery accepts inspected divergence",
	    acceptedConflictResolutionResponse.status === 200 &&
	      acceptedConflictResolution.resolution?.strategy === "accept-divergence" &&
	      acceptedConflictResolution.resolution?.message_id === "room-sync-conflict-smoke" &&
	      acceptedConflictResolution.mutation?.operation === "room_sync_conflict_resolve" &&
	      acceptedConflictResolution.mutation?.accepted === true &&
	      acceptedConflictResolution.mutation?.resultEntityId === "room-sync-conflict-smoke",
	    JSON.stringify(acceptedConflictResolution),
	    { mutation: acceptedConflictResolution.mutation },
	  );
	  const resumedConflictRoomSyncResponse = await conflictRoomRequest(`/api/v1/projects/${encodeURIComponent(conflictRoomProject.id)}/room/sync`, {
	    method: "POST",
	  });
	  const resumedConflictRoomSync = await parseJsonResponse(resumedConflictRoomSyncResponse);
	  const conflictRoomMessagesResponse = await conflictRoomRequest(`/api/v1/projects/${encodeURIComponent(conflictRoomProject.id)}/room/messages`);
	  const conflictRoomMessages = await parseJsonResponse(conflictRoomMessagesResponse);
	  recordCheck(
	    "room sync conflict recovery preserves local divergence",
	    resumedConflictRoomSyncResponse.status === 200 &&
	      resumedConflictRoomSync.plan?.resolvedConflictIds?.includes("room-sync-conflict-smoke") === true &&
	      resumedConflictRoomSync.plan?.conflicts?.length === 0 &&
	      resumedConflictRoomSync.mutation?.operation === "room_sync" &&
	      resumedConflictRoomSync.mutation?.accepted === true &&
	      conflictRoomMessages.messages?.some((message) =>
	        message.id === "room-sync-conflict-smoke" &&
	        message.text === "local room conflict text"
	      ) &&
	      !conflictRoomMessages.messages?.some((message) =>
	        message.id === "room-sync-conflict-smoke" &&
	        message.text === "remote room conflict text"
	      ),
	    JSON.stringify({ resumedConflictRoomSync, conflictRoomMessages }),
	    { mutation: resumedConflictRoomSync.mutation },
	  );
	  const conflictResolutionEntityId = `${conflictRoomProject.id}:room-sync-conflict-smoke`;
	  const conflictResolutionAuditResponse = await conflictRoomRequest(`/api/v1/mutation-audit?operation=room_sync_conflict_resolve&entityId=${encodeURIComponent(conflictResolutionEntityId)}`);
	  const conflictResolutionAudit = await parseJsonResponse(conflictResolutionAuditResponse);
	  const conflictResolutionAuditRecord = conflictResolutionAudit.records?.[0];
	  recordCheck(
	    "room sync conflict recovery writes sanitized audit evidence",
	    conflictResolutionAuditResponse.status === 200 &&
	      conflictResolutionAudit.records?.length === 1 &&
	      conflictResolutionAuditRecord.operation === "room_sync_conflict_resolve" &&
	      conflictResolutionAuditRecord.entity?.id === conflictResolutionEntityId &&
	      conflictResolutionAuditRecord.accepted === true &&
	      conflictResolutionAuditRecord.reason === "room sync conflict accepted as divergence" &&
	      mutationAuditRecordsHaveNoReadTokens(conflictResolutionAudit.records),
	    JSON.stringify(conflictResolutionAudit),
	    { mutation: acceptedConflictResolution.mutation },
	  );

	  const report = {
	    schemaVersion: 1,
	    status: "pass",
	    summary: "Local sync/audio/runtime/provider config, derived agent read views, provider model test actions, local audio transcription actions, asset metadata/ref/GC, asset reference metadata refresh, project delete/restore/purge, local session agent writes/attach, and local room id replays/admission require host-side read/idempotency proofs, read-only metadata views, explicit gates, or host mutation records.",
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
      localOnlyProjectId: localOnlyRoomProject.id,
      localOnlyAdmissionReason: localOnlyRoomSync.admission?.reason,
    },
    projectRestore: {
      projectId: restoreProject.id,
      localObsoleteProjectEndpointStatuses: obsoleteProjectEndpointChecks.map((response) => response.status),
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
      assetCreateAuditRecorded: checks.some((check) => check.name === "asset create writes sanitized local mutation audit evidence" && check.status === "pass"),
      assetGetReceiptReturned: checks.some((check) => check.name === "asset get returns receipt read token" && check.status === "pass"),
      coverMissingReadRejected: checks.some((check) => check.name === "asset cover update without prior read is rejected" && check.status === "pass"),
      coverBareCasRejected: checks.some((check) => check.name === "asset cover update with bare CAS token is rejected" && check.status === "pass"),
      coverReceiptAccepted: checks.some((check) => check.name === "asset cover update with receipt read token is accepted" && check.status === "pass"),
      coverStaleReceiptRejected: checks.some((check) => check.name === "asset cover update with stale receipt is rejected" && check.status === "pass"),
      assetCoverAuditRecorded: checks.some((check) => check.name === "asset cover update writes sanitized local mutation audit evidence" && check.status === "pass"),
      assetRefGetReceiptReturned: checks.some((check) => check.name === "asset ref get returns receipt read token" && check.status === "pass"),
	      assetRefMissingReadRejected: checks.some((check) => check.name === "asset ref delete without prior read is rejected" && check.status === "pass"),
	      assetRefBareCasRejected: checks.some((check) => check.name === "asset ref delete with bare CAS token is rejected" && check.status === "pass"),
	      assetRefReceiptAccepted: checks.some((check) => check.name === "asset ref delete with receipt read token is accepted" && check.status === "pass"),
	      assetRefDeleteAuditRecorded: checks.some((check) => check.name === "asset ref delete writes sanitized local mutation audit evidence" && check.status === "pass"),
	      assetReferenceRefreshMutationRecorded: checks.some((check) => check.name === "asset reference refresh returns host mutation record" && check.status === "pass"),
      assetReferenceRefreshAuditRecorded: checks.some((check) => check.name === "asset reference refresh writes sanitized local mutation audit evidence" && check.status === "pass"),
	      assetGcDryRunReceiptReturned: checks.some((check) => check.name === "asset GC dry-run returns receipt read token" && check.status === "pass"),
      assetGcMissingDryRunRejected: checks.some((check) => check.name === "asset GC delete without prior dry-run is rejected" && check.status === "pass"),
      assetGcBareCasRejected: checks.some((check) => check.name === "asset GC delete with bare dry-run CAS token is rejected" && check.status === "pass"),
      assetGcStaleReceiptRejected: checks.some((check) => check.name === "asset GC delete with stale dry-run receipt is rejected" && check.status === "pass"),
      assetGcFreshPlanReturned: checks.some((check) => check.name === "asset GC fresh dry-run sees current orphan plan" && check.status === "pass"),
      assetGcReceiptAccepted: checks.some((check) => check.name === "asset GC delete with dry-run receipt is accepted" && check.status === "pass"),
      assetGcAuditRecorded: checks.some((check) => check.name === "asset GC delete writes sanitized local mutation audit evidence" && check.status === "pass"),
      canvasNodeReadReceiptReturned: checks.some((check) => check.name === "canvas node read returns receipt read token" && check.status === "pass"),
      canvasNodeReferencedPatchRejected: checks.some((check) => check.name === "canvas node content update with downstream reference is rejected" && check.status === "pass"),
      canvasNodeBareCasRejected: checks.some((check) => check.name === "canvas node update with bare CAS token is rejected" && check.status === "pass"),
      canvasNodeUpdateReceiptAccepted: checks.some((check) => check.name === "canvas node update with receipt is accepted" && check.status === "pass"),
      canvasNodeDeleteReceiptAccepted: checks.some((check) => check.name === "canvas node delete with receipt is accepted" && check.status === "pass"),
      canvasNodeUpdateAuditRecorded: checks.some((check) => check.name === "canvas node update writes sanitized local mutation audit evidence" && check.status === "pass"),
      canvasNodeDeleteAuditRecorded: checks.some((check) => check.name === "canvas node delete writes sanitized local mutation audit evidence" && check.status === "pass"),
      canvasBatchDeletePlanReceiptReturned: checks.some((check) => check.name === "canvas batch delete plan returns graph receipt read token" && check.status === "pass"),
      canvasBatchDeleteOrphanRejected: checks.some((check) => check.name === "canvas batch delete rejects orphaning external references" && check.status === "pass"),
      canvasBatchDeleteBareCasRejected: checks.some((check) => check.name === "canvas batch delete with bare CAS token is rejected" && check.status === "pass"),
      canvasBatchDeleteReceiptAccepted: checks.some((check) => check.name === "canvas batch delete with receipt is accepted" && check.status === "pass"),
      canvasBatchDeleteAuditRecorded: checks.some((check) => check.name === "canvas batch delete writes sanitized local mutation audit evidence" && check.status === "pass"),
      canvasEdgeListReceiptReturned: checks.some((check) => check.name === "canvas edge list returns graph and edge receipt read tokens" && check.status === "pass"),
      canvasEdgeDeleteReceiptAccepted: checks.some((check) => check.name === "canvas edge delete with receipt is accepted" && check.status === "pass"),
      canvasEdgeDeleteAuditRecorded: checks.some((check) => check.name === "canvas edge delete writes sanitized local mutation audit evidence" && check.status === "pass"),
      localObsoleteProjectEndpointsRejected: checks.some((check) => check.name === "obsolete local project endpoints are not exposed" && check.status === "pass"),
      projectCreateAuditRecorded: checks.some((check) => check.name === "v1 project create writes sanitized local mutation audit evidence" && check.status === "pass"),
      projectRestoreDeletedGetHidden: checks.some((check) => check.name === "deleted project is hidden from normal project get" && check.status === "pass"),
      projectRestoreGetReceiptReturned: checks.some((check) => check.name === "deleted project get returns restore receipt" && check.status === "pass"),
      projectRestoreMissingReadRejected: checks.some((check) => check.name === "project restore without prior deleted read is rejected" && check.status === "pass"),
      projectRestoreBareCasRejected: checks.some((check) => check.name === "project restore with bare CAS token is rejected" && check.status === "pass"),
      projectRestoreStaleReceiptRejected: checks.some((check) => check.name === "project restore with stale active receipt is rejected" && check.status === "pass"),
      projectRestoreReceiptAccepted: checks.some((check) => check.name === "project restore with deleted-project receipt is accepted" && check.status === "pass"),
      projectRestoreStatusPathStable: checks.some((check) => check.name === "restored project status preserves local storage path contract" && check.status === "pass"),
      projectRestoreAuditRecorded: checks.some((check) => check.name === "project restore writes sanitized local mutation audit evidence" && check.status === "pass"),
      projectPurgeGetReceiptReturned: checks.some((check) => check.name === "project purge deleted get returns purge receipt" && check.status === "pass"),
      projectPurgeMissingReadRejected: checks.some((check) => check.name === "project purge without prior deleted read is rejected" && check.status === "pass"),
      projectPurgeDelayedByDefault: checks.some((check) => check.name === "project purge with receipt is delayed by default" && check.status === "pass"),
      projectPurgeForceAccepted: checks.some((check) => check.name === "project purge with deleted-project receipt and force is accepted" && check.status === "pass"),
      projectPurgeRecoveryPointRemoved: checks.some((check) => check.name === "project purge removes deleted recovery point" && check.status === "pass"),
      projectPurgeAuditRecorded: checks.some((check) => check.name === "project purge writes sanitized local mutation audit evidence" && check.status === "pass"),
      sessionCreateAuditRecorded: checks.some((check) => check.name === "session create writes sanitized local mutation audit evidence" && check.status === "pass"),
      syncConfigGetReceiptReturned: checks.some((check) => check.name === "sync config get returns receipt read token" && check.status === "pass"),
      syncConfigMissingReadRejected: checks.some((check) => check.name === "sync config update without prior read is rejected" && check.status === "pass"),
      syncConfigBareCasRejected: checks.some((check) => check.name === "sync config update with bare CAS token is rejected" && check.status === "pass"),
      syncConfigStaleReceiptRejected: checks.some((check) => check.name === "sync config update with stale receipt is rejected" && check.status === "pass"),
      syncConfigReceiptAccepted: checks.some((check) => check.name === "sync config update with receipt read token is accepted" && check.status === "pass"),
      syncConfigAuditRecorded: checks.some((check) => check.name === "sync config update writes sanitized local mutation audit evidence" && check.status === "pass"),
      audioConfigGetReceiptReturned: checks.some((check) => check.name === "audio config get returns receipt read token" && check.status === "pass"),
      audioConfigMissingReadRejected: checks.some((check) => check.name === "audio config update without prior read is rejected" && check.status === "pass"),
      audioConfigBareCasRejected: checks.some((check) => check.name === "audio config update with bare CAS token is rejected" && check.status === "pass"),
      audioConfigStaleReceiptRejected: checks.some((check) => check.name === "audio config update with stale receipt is rejected" && check.status === "pass"),
      audioConfigReceiptAccepted: checks.some((check) => check.name === "audio config update with receipt read token is accepted" && check.status === "pass"),
      audioConfigAuditRecorded: checks.some((check) => check.name === "audio config update writes sanitized local mutation audit evidence" && check.status === "pass"),
      audioInstallMissingReadRejected: checks.some((check) => check.name === "audio install without prior read is rejected" && check.status === "pass"),
      audioInstallBareCasRejected: checks.some((check) => check.name === "audio install with bare CAS token is rejected" && check.status === "pass"),
      audioInstallReceiptAccepted: checks.some((check) => check.name === "audio install with receipt read token is accepted" && check.status === "pass"),
      audioInstallStaleReceiptRejected: checks.some((check) => check.name === "audio install with stale receipt is rejected" && check.status === "pass"),
      audioInstallAuditRecorded: checks.some((check) => check.name === "audio install writes sanitized local mutation audit evidence" && check.status === "pass"),
      audioTranscriptionMutationRecorded: checks.some((check) => check.name === "audio transcription action returns host mutation record" && check.status === "pass"),
      localHarnessGetReceiptReturned: checks.some((check) => check.name === "local harnesses get returns receipt read token" && check.status === "pass"),
      localHarnessMissingReadRejected: checks.some((check) => check.name === "local harness enablement update without prior read is rejected" && check.status === "pass"),
      localHarnessBareCasRejected: checks.some((check) => check.name === "local harness enablement update with bare CAS token is rejected" && check.status === "pass"),
      localHarnessStaleReceiptRejected: checks.some((check) => check.name === "local harness enablement update with stale receipt is rejected" && check.status === "pass"),
      localHarnessReceiptAccepted: checks.some((check) => check.name === "local harness enablement update with receipt read token is accepted" && check.status === "pass"),
      localHarnessAuditRecorded: checks.some((check) => check.name === "local harness enablement update writes sanitized local mutation audit evidence" && check.status === "pass"),
      localHarnessInstallMissingReadRejected: checks.some((check) => check.name === "local harness install without prior read is rejected" && check.status === "pass"),
      localHarnessInstallBareCasRejected: checks.some((check) => check.name === "local harness install with bare CAS token is rejected" && check.status === "pass"),
      localHarnessInstallReceiptAccepted: checks.some((check) => check.name === "local harness install with receipt read token is accepted" && check.status === "pass"),
      localHarnessInstallAuditRecorded: checks.some((check) => check.name === "local harness install writes sanitized local mutation audit evidence" && check.status === "pass"),
      localHarnessUninstallStaleReceiptRejected: checks.some((check) => check.name === "local harness uninstall with stale receipt is rejected" && check.status === "pass"),
      localHarnessUpgradeReceiptAccepted: checks.some((check) => check.name === "local harness upgrade with receipt read token is accepted" && check.status === "pass"),
      localHarnessUpgradeAuditRecorded: checks.some((check) => check.name === "local harness upgrade writes sanitized local mutation audit evidence" && check.status === "pass"),
      localHarnessAuthenticateReceiptAccepted: checks.some((check) => check.name === "local harness authenticate with receipt read token is accepted" && check.status === "pass"),
      localHarnessAuthenticateAuditRecorded: checks.some((check) => check.name === "local harness authenticate writes sanitized local mutation audit evidence" && check.status === "pass"),
      localHarnessUninstallReceiptAccepted: checks.some((check) => check.name === "local harness uninstall with receipt read token is accepted" && check.status === "pass"),
      localHarnessUninstallAuditRecorded: checks.some((check) => check.name === "local harness uninstall writes sanitized local mutation audit evidence" && check.status === "pass"),
      localAgentServersGetReceiptReturned: checks.some((check) => check.name === "local agent servers get returns receipt read token" && check.status === "pass"),
      localAgentServersMissingReadRejected: checks.some((check) => check.name === "local agent servers update without prior read is rejected" && check.status === "pass"),
      localAgentServersBareCasRejected: checks.some((check) => check.name === "local agent servers update with bare CAS token is rejected" && check.status === "pass"),
      localAgentServersStaleReceiptRejected: checks.some((check) => check.name === "local agent servers update with stale receipt is rejected" && check.status === "pass"),
      localAgentServersReceiptAccepted: checks.some((check) => check.name === "local agent servers update with receipt read token is accepted" && check.status === "pass"),
      localAgentServersAuditRecorded: checks.some((check) => check.name === "local agent servers update writes sanitized local mutation audit evidence" && check.status === "pass"),
      providerAccountsGetReceiptReturned: checks.some((check) => check.name === "provider accounts get returns collection receipt read token" && check.status === "pass"),
      providerAccountGetReceiptReturned: checks.some((check) => check.name === "provider account get returns account receipt read token" && check.status === "pass"),
      providerAccountsMissingReadRejected: checks.some((check) => check.name === "provider accounts update without prior read is rejected" && check.status === "pass"),
      providerAccountsBareCasRejected: checks.some((check) => check.name === "provider accounts update with bare CAS token is rejected" && check.status === "pass"),
      providerAccountsReceiptAccepted: checks.some((check) => check.name === "provider accounts update with receipt read token is accepted" && check.status === "pass"),
      providerAccountsUpdateAuditRecorded: checks.some((check) => check.name === "provider accounts update writes sanitized local mutation audit evidence" && check.status === "pass"),
      providerModelTestMutationRecorded: checks.some((check) => check.name === "provider model test action writes sanitized local mutation audit evidence" && check.status === "pass"),
      providerAccountDeleteMissingReadRejected: checks.some((check) => check.name === "provider account delete without prior read is rejected" && check.status === "pass"),
      providerAccountDeleteStaleReceiptRejected: checks.some((check) => check.name === "provider account delete with stale receipt is rejected" && check.status === "pass"),
      providerAccountDeleteBareCasRejected: checks.some((check) => check.name === "provider account delete with bare CAS token is rejected" && check.status === "pass"),
      providerAccountDeleteReceiptAccepted: checks.some((check) => check.name === "provider account delete with receipt read token is accepted" && check.status === "pass"),
      providerAccountDeleteAuditRecorded: checks.some((check) => check.name === "provider account delete writes sanitized local mutation audit evidence" && check.status === "pass"),
      providerAccountDeletePersisted: checks.some((check) => check.name === "provider account delete persists in host state" && check.status === "pass"),
      providerOAuthGetReceiptReturned: checks.some((check) => check.name === "provider OAuth get returns receipt read token" && check.status === "pass"),
      providerOAuthStartMissingReadRejected: checks.some((check) => check.name === "provider OAuth start without prior read is rejected" && check.status === "pass"),
      providerOAuthStartBareCasRejected: checks.some((check) => check.name === "provider OAuth start with bare CAS token is rejected" && check.status === "pass"),
      providerOAuthStartReceiptAccepted: checks.some((check) => check.name === "provider OAuth start with receipt read token is accepted" && check.status === "pass"),
      providerOAuthStartAuditRecorded: checks.some((check) => check.name === "provider OAuth start writes sanitized local mutation audit evidence" && check.status === "pass"),
      providerOAuthStartStaleReceiptRejected: checks.some((check) => check.name === "provider OAuth start with stale receipt is rejected" && check.status === "pass"),
      providerOAuthStartDeletedRowStaleReceiptRejected: checks.some((check) => check.name === "provider OAuth start with deleted-row stale receipt is rejected" && check.status === "pass"),
      providerOAuthDeleteMissingReadRejected: checks.some((check) => check.name === "provider OAuth delete without prior read is rejected" && check.status === "pass"),
      providerOAuthDeleteBareCasRejected: checks.some((check) => check.name === "provider OAuth delete with bare CAS token is rejected" && check.status === "pass"),
      providerOAuthCompleteMissingReadRejected: checks.some((check) => check.name === "provider OAuth complete without prior read is rejected" && check.status === "pass"),
      providerOAuthCompleteBareCasRejected: checks.some((check) => check.name === "provider OAuth complete with bare CAS token is rejected" && check.status === "pass"),
      providerOAuthCompleteReceiptAccepted: checks.some((check) => check.name === "provider OAuth complete with receipt read token is accepted" && check.status === "pass"),
      providerOAuthCompleteAuditRecorded: checks.some((check) => check.name === "provider OAuth complete writes sanitized local mutation audit evidence" && check.status === "pass"),
      providerOAuthCompleteStaleReceiptRejected: checks.some((check) => check.name === "provider OAuth complete with stale receipt is rejected" && check.status === "pass"),
      providerOAuthDeleteStaleReceiptRejected: checks.some((check) => check.name === "provider OAuth delete with stale receipt is rejected" && check.status === "pass"),
      providerOAuthAuthorizedFreshReceiptReturned: checks.some((check) => check.name === "provider OAuth authorized get returns fresh receipt read token" && check.status === "pass"),
      providerOAuthDeleteReceiptAccepted: checks.some((check) => check.name === "provider OAuth delete with receipt read token is accepted" && check.status === "pass"),
      providerOAuthDeleteAuditRecorded: checks.some((check) => check.name === "provider OAuth delete writes sanitized local mutation audit evidence" && check.status === "pass"),
      providerOAuthDeletePersisted: checks.some((check) => check.name === "provider OAuth delete persists in host state" && check.status === "pass"),
      assetImportImmutableCreateAccepted: checks.some((check) => check.name === "asset import accepts new immutable local blob" && check.status === "pass"),
      assetImportAuditRecorded: checks.some((check) => check.name === "asset import writes sanitized local mutation audit evidence" && check.status === "pass"),
      assetImportImmutableConflictRejected: checks.some((check) => check.name === "asset import rejects existing asset id with different immutable content" && check.status === "pass"),
      customActionCheckpointCreateAccepted: checks.some((check) => check.name === "custom action upload accepts first checkpoint output" && check.status === "pass"),
      customActionCheckpointAuditRecorded: checks.some((check) => check.name === "custom action upload writes sanitized local mutation audit evidence" && check.status === "pass"),
      customActionCheckpointOverwriteRejected: checks.some((check) => check.name === "custom action upload rejects checkpoint overwrite" && check.status === "pass"),
      customActionCheckpointFilePreserved: checks.some((check) => check.name === "custom action checkpoint file remains first output after rejected overwrite" && check.status === "pass"),
      assetBlobUploadAccepted: checks.some((check) => check.name === "asset blob upload accepts agent local file" && check.status === "pass"),
      assetBlobUploadAuditRecorded: checks.some((check) => check.name === "asset blob upload writes sanitized local mutation audit evidence" && check.status === "pass"),
      assetUploadSymlinkParentRejected: checks.some((check) => check.name === "asset upload rejects symlinked parent outside local asset storage" && check.status === "pass"),
      assetUploadSymlinkRootRejected: checks.some((check) => check.name === "asset upload rejects symlinked root outside local asset storage" && check.status === "pass"),
      assetReadSymlinkParentRejected: checks.some((check) => check.name === "asset reads reject symlinked parent outside local asset storage" && check.status === "pass"),
      assetReadSymlinkRootRejected: checks.some((check) => check.name === "asset reads reject symlinked root outside local asset storage" && check.status === "pass"),
      workflowGeneratedAssetSymlinkParentRejected: checks.some((check) => check.name === "workflow generated asset writes reject symlinked parent outside local asset storage" && check.status === "pass"),
      workflowGeneratedAssetAccepted: checks.some((check) => check.name === "workflow generated asset accepts agent local generation" && check.status === "pass"),
      workflowGeneratedAssetAuditRecorded: checks.some((check) => check.name === "workflow generated asset writes sanitized local mutation audit evidence" && check.status === "pass"),
      workflowGeneratedTextRevisionIndexed: checks.some((check) => check.name === "workflow generated text indexes host text revision" && check.status === "pass"),
      workflowGeneratedTextContentReturned: checks.some((check) => check.name === "workflow generated text content endpoint returns revision body" && check.status === "pass"),
      workflowGeneratedTextAuditRecorded: checks.some((check) => check.name === "workflow generated text writes sanitized local mutation audit evidence" && check.status === "pass"),
      assetCreateInvalidStorageKeyRejected: checks.some((check) => check.name === "asset create rejects storage keys outside local asset storage" && check.status === "pass"),
      assetCoverInvalidStorageKeyRejected: checks.some((check) => check.name === "asset cover update rejects storage keys outside local asset storage" && check.status === "pass"),
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
	      runtimeSessionCreateAuditRecorded: checks.some((check) => check.name === "runtime session create writes sanitized local mutation audit evidence" && check.status === "pass"),
	      runtimeSessionAttachAuditRecorded: checks.some((check) => check.name === "runtime session attach writes sanitized local mutation audit evidence" && check.status === "pass"),
	      localRoomMessageCreateAccepted: checks.some((check) => check.name === "local room message create accepts first client id" && check.status === "pass"),
	      localRoomMessageCreateAuditRecorded: checks.some((check) => check.name === "local room message create writes sanitized local mutation audit evidence" && check.status === "pass"),
	      localRoomMessageConflictRejected: checks.some((check) => check.name === "local room message id replay with different content is rejected" && check.status === "pass"),
	      localRoomMessageOriginalPreserved: checks.some((check) => check.name === "local room message conflict preserves original content" && check.status === "pass"),
	      roomSyncMissingProjectFirst: checks.some((check) => check.name === "room sync checks project existence before remote admission" && check.status === "pass"),
	      roomSyncLocalOnlyAdmissionReturned: checks.some((check) => check.name === "local-only room sync returns explicit admission gate" && check.status === "pass"),
	      roomSyncExplicitMirrorAccepted: checks.some((check) => check.name === "room sync mirrors local and remote messages through explicit action" && check.status === "pass"),
	      roomSyncAuditRecorded: checks.some((check) => check.name === "room sync writes sanitized local mutation audit evidence" && check.status === "pass"),
	      roomSyncConflictExposed: checks.some((check) => check.name === "room sync conflict exposes local and remote hashes without overwrite" && check.status === "pass"),
	      roomSyncConflictStaleResolveRejected: checks.some((check) => check.name === "room sync conflict recovery rejects stale hashes" && check.status === "pass"),
	      roomSyncConflictDivergenceAccepted: checks.some((check) => check.name === "room sync conflict recovery accepts inspected divergence" && check.status === "pass"),
	      roomSyncConflictLocalDivergencePreserved: checks.some((check) => check.name === "room sync conflict recovery preserves local divergence" && check.status === "pass"),
	      roomSyncConflictResolutionAuditRecorded: checks.some((check) => check.name === "room sync conflict recovery writes sanitized audit evidence" && check.status === "pass"),
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
