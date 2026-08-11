import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getLocalAudioModelStatus,
  mutateLocalAudioModel,
  modelsCommand,
  providerCredentialsFromOptions,
  providerPayloadFromOptions,
  providerWriteHeaders,
  publicLocalAudioModelResult,
  publicProviderAccountsResult,
} from "./models";

const modelsSource = readFileSync(fileURLToPath(new URL("./models.ts", import.meta.url)), "utf8");

function commandBlock(source: string, command: string, nextCommand?: string): string {
  const start = source.indexOf(`.command("${command}")`);
  assert.notEqual(start, -1, `${command} command not found`);
  const end = nextCommand ? source.indexOf(`.command("${nextCommand}")`, start + 1) : -1;
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

test("builds a provider account payload from CLI options", () => {
  assert.deepEqual(providerPayloadFromOptions("official", {
    upstream: "openai",
    region: "global",
    weight: "80",
    priority: "2",
  }), {
    providerId: "official",
    upstreamId: "openai",
    region: "global",
    enabled: true,
    weight: 80,
    priority: 2,
  });
});
test("can disable a provider account from CLI options", () => {
  assert.deepEqual(providerPayloadFromOptions("fal", {
    disable: true,
  }), {
    providerId: "fal",
    enabled: false,
  });
});

test("loads a service-account key from a JSON file without putting the secret on argv", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clash-provider-credentials-"));
  const credentialPath = join(directory, "service-account.json");
  const serviceAccount = {
    type: "service_account",
    project_id: "demo-project",
    client_email: "svc@demo-project.iam.gserviceaccount.com",
    private_key: "private-key-value",
  };
  await writeFile(credentialPath, JSON.stringify(serviceAccount), "utf8");

  try {
    assert.deepEqual(
      await providerCredentialsFromOptions({ serviceAccountKeyFile: credentialPath }),
      { serviceAccountKey: JSON.stringify(serviceAccount) },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("provider account writes use implicit cwd observation CAS", () => {
  const providersSource = commandBlock(modelsSource, "providers", "provider");
  const providerSetSource = commandBlock(modelsSource, "set");

  assert.match(providersSource, /recordAgentObservation/);
  assert.match(providersSource, /publicProviderAccountsResult/);
  assert.doesNotMatch(providersSource, /Read token:/);
  assert.doesNotMatch(providerSetSource, /\.option\("--if-match/);
  assert.doesNotMatch(providerSetSource, /\.option\("--force"/);
  assert.match(providerSetSource, /providerWriteHeaders\(\{/);
  assert.match(providerSetSource, /observedVersion/);
  assert.doesNotMatch(providerSetSource, /force: options\.force === true/);
});

test("provider JSON output hides internal read receipts", () => {
  assert.deepEqual(publicProviderAccountsResult([
    {
      providerId: "fal",
      enabled: true,
      readToken: "provider-account-v1:secret:receipt:secret",
    },
  ] as Array<any>), [
    {
      providerId: "fal",
      enabled: true,
    },
  ]);
});

test("provider write headers carry an internal observed version", () => {
  assert.deepEqual(
    providerWriteHeaders(
      { observedVersion: " provider-accounts-v1:abc " },
      { CLASH_AGENT_MEMBER_ID: "agent-1" },
    ),
    {
      "x-clash-client-type": "agent",
      "x-clash-observed-version": "provider-accounts-v1:abc",
    },
  );
});

test("models local progressively discloses status, install, and remove without mutation bypasses", () => {
  assert.match(modelsCommand.description(), /local audio runtimes/i);
  const local = modelsCommand.commands.find(
    (command) => command.name() === "local",
  );
  assert.ok(local, "models local command not found");
  assert.match(local.description(), /downloadable local ASR and TTS/i);
  assert.deepEqual(
    local.commands.map((command) => command.name()),
    ["catalog", "status", "install", "remove"],
  );

  for (const command of local.commands) {
    const help = command.helpInformation();
    assert.match(help, /--capability <text-to-speech\|speech-to-text>/);
    assert.match(help, /--json/);
    assert.doesNotMatch(help, /--force|--if-match|--read-token/);
  }
  for (const name of ["status", "install", "remove"]) {
    const command = local.commands.find((candidate) => candidate.name() === name);
    assert.ok(command);
    // The model id is optional: the configured model is the default answer.
    assert.match(command.helpInformation(), /--model <id>/);
    assert.ok(
      command.options.every((option) => option.long !== "--model" || !option.mandatory),
      `${name} must not force a model id`,
    );
  }
});

test("local model status records the audio observation and hides its receipt", async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = [];
  const observations: Array<Record<string, unknown>> = [];
  const result = await getLocalAudioModelStatus(
    {
      capability: "text-to-speech",
      model: "mlx-community/Kokoro-82M-4bit",
    },
    {
      apiJson: async (path, options) => {
        calls.push({ path, options });
        return {
          capability: "text-to-speech",
          model: "mlx-community/Kokoro-82M-4bit",
          available: false,
          readiness: "not-installed",
          message: "model is not downloaded",
          readToken: "local-config-v1:audio:receipt:secret",
        };
      },
      recordObservation: async (observation) => {
        observations.push(observation);
      },
      requireObservation: async () => undefined,
      env: { CLASH_AGENT_MEMBER_ID: "agent-1" },
    },
  );

  assert.deepEqual(calls, [
    {
      path: "/api/v1/local/audio/models/status?capability=text-to-speech&model=mlx-community%2FKokoro-82M-4bit",
      options: undefined,
    },
  ]);
  assert.deepEqual(observations, [
    {
      entityKind: "local-config",
      entityId: "audio",
      revision: "local-config-v1:audio:receipt:secret",
    },
  ]);
  assert.deepEqual(result, {
    capability: "text-to-speech",
    model: "mlx-community/Kokoro-82M-4bit",
    available: false,
    readiness: "not-installed",
    message: "model is not downloaded",
  });
});

test("local model lifecycle rejects capability aliases instead of guessing", async () => {
  let requested = false;
  await assert.rejects(
    getLocalAudioModelStatus(
      {
        capability: "tts" as "text-to-speech",
        model: "zh_CN-huayan-medium",
      },
      {
        apiJson: async () => {
          requested = true;
          return {};
        },
        recordObservation: async () => undefined,
        requireObservation: async () => undefined,
        env: {},
      },
    ),
    /capability must be speech-to-text or text-to-speech/,
  );
  assert.equal(requested, false);
});

test("local model install and remove require the recorded audio observation and rotate it", async () => {
  for (const operation of ["install", "remove"] as const) {
    const calls: Array<{ path: string; options?: RequestInit }> = [];
    const required: Array<Record<string, unknown>> = [];
    const recorded: Array<Record<string, unknown>> = [];
    const result = await mutateLocalAudioModel(
      operation,
      {
        capability: "speech-to-text",
        model: "iic/SenseVoiceSmall",
      },
      {
        apiJson: async (path, options) => {
          calls.push({ path, options });
          return {
            asr: {
              model: "iic/SenseVoiceSmall",
              ready: operation === "install",
            },
            tts: { model: "zh_CN-huayan-medium", ready: false },
            readToken: `local-config-v2:audio:receipt:${operation}`,
            mutation: {
              operation: `local_audio_model_${operation}`,
              expectedReadToken: "local-config-v1:audio:receipt:before",
              afterReadToken: `local-config-v2:audio:receipt:${operation}`,
              accepted: true,
            },
          };
        },
        recordObservation: async (observation) => {
          recorded.push(observation);
        },
        requireObservation: async (observation) => {
          required.push(observation);
          return "local-config-v1:audio:receipt:before";
        },
        env: { CLASH_AGENT_MEMBER_ID: "agent-1" },
      },
    );

    assert.deepEqual(required, [
      { entityKind: "local-config", entityId: "audio" },
    ]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.path, `/api/v1/local/audio/${operation}`);
    assert.deepEqual(calls[0]?.options, {
      method: "POST",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": "local-config-v1:audio:receipt:before",
      },
      body: JSON.stringify({
        capability: "speech-to-text",
        model: "iic/SenseVoiceSmall",
      }),
    });
    assert.deepEqual(recorded, [
      {
        entityKind: "local-config",
        entityId: "audio",
        revision: `local-config-v2:audio:receipt:${operation}`,
      },
    ]);
    assert.deepEqual(result, {
      asr: { model: "iic/SenseVoiceSmall", ready: operation === "install" },
      tts: { model: "zh_CN-huayan-medium", ready: false },
      mutation: {
        operation: `local_audio_model_${operation}`,
        accepted: true,
      },
    });
  }
});

test("local model public JSON removes internal receipts", () => {
  assert.deepEqual(
    publicLocalAudioModelResult({
      capability: "text-to-speech",
      model: "zh_CN-huayan-medium",
      available: true,
      readiness: "ready",
      readToken: "local-config-v1:audio:receipt:secret",
      mutation: {
        expectedReadToken: "before",
        afterReadToken: "after",
        accepted: true,
      },
    }),
    {
      capability: "text-to-speech",
      model: "zh_CN-huayan-medium",
      available: true,
      readiness: "ready",
      mutation: { accepted: true },
    },
  );
});
