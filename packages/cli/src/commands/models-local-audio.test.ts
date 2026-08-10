import test from "node:test";
import assert from "node:assert/strict";

import {
  getLocalAudioModelStatus,
  listLocalAudioModelCatalog,
  mutateLocalAudioModel,
  resolveConfiguredLocalAudioModel,
  type LocalAudioModelCommandDependencies,
} from "./models";

function stubDependencies(
  responses: Record<string, Record<string, unknown>>,
): LocalAudioModelCommandDependencies & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async apiJson(path) {
      calls.push(path);
      const key = Object.keys(responses).find((candidate) => path.startsWith(candidate));
      if (!key) throw new Error(`unexpected request: ${path}`);
      return responses[key];
    },
    async recordObservation() {},
    async requireObservation() {
      return "observed-1";
    },
    env: {},
  };
}

const audioConfig = {
  asr: {
    capability: "speech-to-text",
    enabled: true,
    provider: "builtin-funasr",
    model: "iic/SenseVoiceSmall",
    ready: false,
    setup: { provider: "funasr", status: "needs-install", available: false, commands: [] },
  },
  tts: {
    capability: "text-to-speech",
    enabled: false,
    provider: "builtin-piper",
    model: "piper/en_US-lessac-medium",
    ready: false,
    setup: { provider: "piper", status: "needs-install", available: false, commands: [] },
  },
};

test("answers which local ASR is configured without the caller knowing a model id", async () => {
  const dependencies = stubDependencies({ "/api/v1/local/audio": audioConfig });

  const resolved = await resolveConfiguredLocalAudioModel("speech-to-text", dependencies);

  assert.equal(resolved.model, "iic/SenseVoiceSmall");
  assert.equal(resolved.ready, false);
  assert.equal(resolved.setupStatus, "needs-install");
  assert.match(resolved.nextStep ?? "", /clash models local install/);
  assert.match(resolved.nextStep ?? "", /speech-to-text/);
});

test("reads status for the configured model when no model is given", async () => {
  const dependencies = stubDependencies({
    "/api/v1/local/audio/models/status": {
      capability: "speech-to-text",
      model: "iic/SenseVoiceSmall",
      readiness: "needs-install",
    },
    "/api/v1/local/audio": audioConfig,
  });

  const result = await getLocalAudioModelStatus({ capability: "speech-to-text" }, dependencies);

  assert.equal(result.model, "iic/SenseVoiceSmall");
  assert.ok(
    dependencies.calls.some((path) => path.includes("model=iic%2FSenseVoiceSmall")),
    `status was queried for the configured model, got ${dependencies.calls.join(", ")}`,
  );
});

test("installs the configured model when no model is given", async () => {
  const dependencies = stubDependencies({
    "/api/v1/local/audio/install": { installed: true, model: "iic/SenseVoiceSmall" },
    "/api/v1/local/audio": audioConfig,
  });

  const result = await mutateLocalAudioModel("install", { capability: "speech-to-text" }, dependencies);

  assert.equal(result.model, "iic/SenseVoiceSmall");
});

test("still honours an explicit model id over the configured default", async () => {
  const dependencies = stubDependencies({
    "/api/v1/local/audio/models/status": {
      capability: "speech-to-text",
      model: "iic/paraformer-zh",
      readiness: "ready",
    },
  });

  await getLocalAudioModelStatus(
    { capability: "speech-to-text", model: "iic/paraformer-zh" },
    dependencies,
  );

  assert.equal(
    dependencies.calls.some((path) => path.includes("/api/v1/local/audio?")),
    false,
    "an explicit model needs no config round trip",
  );
});

test("reports a ready ASR without pushing an install step", async () => {
  const dependencies = stubDependencies({
    "/api/v1/local/audio": {
      ...audioConfig,
      asr: { ...audioConfig.asr, ready: true, setup: { ...audioConfig.asr.setup, status: "ready", available: true } },
    },
  });

  const resolved = await resolveConfiguredLocalAudioModel("speech-to-text", dependencies);

  assert.equal(resolved.ready, true);
  assert.equal(resolved.nextStep, undefined);
});

test("lists shipped local ASR cards with provider info, offline", () => {
  const cards = listLocalAudioModelCatalog("speech-to-text");
  const ids = cards.map((card) => card.cardId);

  assert.ok(ids.includes("whisper-small-asr"), `whisper is listed, got ${ids.join(", ")}`);
  assert.ok(ids.includes("sensevoice-small-asr"));
  const whisper = cards.find((card) => card.cardId === "whisper-small-asr");
  assert.equal(whisper?.provider, "OpenAI");
  assert.equal(whisper?.model, "mlx-community/whisper-small-mlx");
});

test("accepts a catalog card id where a runtime model id is expected", async () => {
  const dependencies = stubDependencies({
    "/api/v1/local/audio/install": { installed: true },
  });

  await mutateLocalAudioModel(
    "install",
    { capability: "speech-to-text", model: "whisper-small-asr" },
    dependencies,
  );

  assert.equal(
    dependencies.calls.some((path) => path.includes("/api/v1/local/audio?")),
    false,
    "a card id resolves offline, with no config round trip",
  );
});
