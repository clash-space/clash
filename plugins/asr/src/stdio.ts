import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assemblePluginModule,
  defineActionExecutor,
  servePluginStdio,
  type ExecutorContext,
  type ExecutorStep,
} from "@clash/action-sdk";
import {
  ExecutablePluginInvocationSchema,
  ExecutableSpeechTranscriptionReferenceSchema,
  ExecutableSpeechTranscriptionResultSchema,
  type ExecutablePluginInvocation,
  type ExecutableSpeechTranscriptionReference,
} from "@clash/shared-types/executable-plugin";

export const ASR_ACTION_ID = "transcribe";

function sourceReference(
  invocation: ExecutablePluginInvocation,
): ExecutableSpeechTranscriptionReference {
  if (invocation.input.references.length !== 1) {
    throw new Error(
      "Speech transcription requires exactly one audio or video source reference.",
    );
  }
  const parsed = ExecutableSpeechTranscriptionReferenceSchema.safeParse(
    invocation.input.references[0],
  );
  if (!parsed.success || parsed.data.slot !== "source") {
    throw new Error(
      "Speech transcription requires exactly one audio or video source reference.",
    );
  }
  return parsed.data;
}

function modelId(invocation: ExecutablePluginInvocation): string {
  const value = invocation.input.values.modelId;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Speech transcription requires a non-empty modelId.");
  }
  return value.trim();
}

function language(invocation: ExecutablePluginInvocation): string | undefined {
  const value = invocation.input.values.language;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      "Speech transcription language must be a non-empty string.",
    );
  }
  return value.trim();
}

async function transcriptionStep(
  input: unknown,
  context: ExecutorContext,
): Promise<ExecutorStep> {
  const invocation = ExecutablePluginInvocationSchema.parse(input);
  const reference = sourceReference(invocation);
  const selectedLanguage = language(invocation);
  const result = ExecutableSpeechTranscriptionResultSchema.parse(
    await context.hostTools.speechTranscribe({
      reference,
      modelId: modelId(invocation),
      ...(selectedLanguage ? { language: selectedLanguage } : {}),
      ...(invocation.operation === "poll"
        ? { poll: invocation.pollState! }
        : {}),
    }),
  );
  if (result.status === "accepted") {
    return {
      status: "accepted",
      pollState: result.poll,
      ...(result.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: result.retryAfterMs }),
    };
  }
  return {
    status: "completed",
    outputs: [
      await context.document({
        slot: "transcript",
        documentKind: "media.transcript",
        schemaVersion: 1,
        body: result.transcript,
      }),
    ],
  };
}

export const CONTRIBUTIONS = {
  [ASR_ACTION_ID]: defineActionExecutor({
    submit: transcriptionStep,
    poll: transcriptionStep,
  }),
};

export const plugin = assemblePluginModule({
  manifestDir: join(fileURLToPath(new URL(".", import.meta.url)), ".."),
  contributes: CONTRIBUTIONS,
});

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  void servePluginStdio(plugin).done;
}
