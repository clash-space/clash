import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { z } from "zod";

import type {
  BenchmarkAttemptManifest,
  BenchmarkAttemptManifestReceipt,
} from "./attempt-manifest";
import {
  parseAggregateRecord,
  parseEvaluationRecord,
  parseRewardRecord,
  type BenchmarkEvaluationAggregateRecord,
  type BenchmarkEvaluationRecord,
  type BenchmarkRewardRecord,
  type EvaluationRecordReceipt,
} from "./evaluation-records";

export type BenchmarkResultRecordReference = Readonly<{
  path: string;
  sha256: string;
  digest: string;
}>;

export type BenchmarkResultBundle = Readonly<{
  schemaVersion: 1;
  kind: "clash.benchmark.result-bundle";
  attempt: BenchmarkResultRecordReference;
  evaluations: readonly BenchmarkResultRecordReference[];
  aggregate?: BenchmarkResultRecordReference;
  reward?: BenchmarkResultRecordReference;
  integrity: Readonly<{
    algorithm: "sha256";
    scope: "canonical-json-without-integrity";
    resultBundleDigest: string;
  }>;
}>;

export type BenchmarkAttemptRecordEvidence = Readonly<{
  record: BenchmarkAttemptManifest;
  receipt: BenchmarkAttemptManifestReceipt;
}>;

export type WriteBenchmarkResultBundleInput = Readonly<{
  root: string;
  attempt: BenchmarkAttemptRecordEvidence;
  evaluations: readonly EvaluationRecordReceipt<BenchmarkEvaluationRecord>[];
  aggregate?: EvaluationRecordReceipt<BenchmarkEvaluationAggregateRecord>;
  reward?: EvaluationRecordReceipt<BenchmarkRewardRecord>;
}>;

export type BenchmarkResultBundleReceipt = Readonly<{
  record: BenchmarkResultBundle;
  path: "result-bundle.json";
  bytes: number;
  sha256: string;
  resultBundleDigest: string;
}>;

const RESULT_BUNDLE_PATH = "result-bundle.json" as const;
const SHA256 = /^[a-f0-9]{64}$/u;

const DigestSchema = z.string().regex(SHA256);
const SafeRelativePathSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine(
    (path) => {
      const segments = path.split("/");
      return (
        !isAbsolute(path) &&
        !/^[A-Za-z]:/u.test(path) &&
        !path.includes("\\") &&
        !path.includes("\0") &&
        segments.every(
          (segment) =>
            segment.length > 0 && segment !== "." && segment !== "..",
        )
      );
    },
    { message: "must be a safe relative path" },
  );
const RecordReferenceSchema = z
  .object({
    path: SafeRelativePathSchema,
    sha256: DigestSchema,
    digest: DigestSchema,
  })
  .strict();
const ResultBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("clash.benchmark.result-bundle"),
    attempt: RecordReferenceSchema,
    evaluations: z.array(RecordReferenceSchema).max(100_000),
    aggregate: RecordReferenceSchema.optional(),
    reward: RecordReferenceSchema.optional(),
    integrity: z
      .object({
        algorithm: z.literal("sha256"),
        scope: z.literal("canonical-json-without-integrity"),
        resultBundleDigest: DigestSchema,
      })
      .strict(),
  })
  .strict();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonicalize(value), null, 2)}\n`);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function decodeJsonInput(value: unknown): unknown {
  if (typeof value !== "string" && !ArrayBuffer.isView(value)) return value;
  try {
    const text =
      typeof value === "string"
        ? value
        : Buffer.from(
            value.buffer,
            value.byteOffset,
            value.byteLength,
          ).toString("utf8");
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error("Result Bundle must contain JSON", { cause: error });
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function isNodeError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function assertCanonicalEvaluations(
  evaluations: readonly BenchmarkResultRecordReference[],
): void {
  const digests = new Set<string>();
  const paths = new Set<string>();
  for (let index = 0; index < evaluations.length; index += 1) {
    const reference = evaluations[index]!;
    if (digests.has(reference.digest)) {
      throw new Error("Result Bundle Evaluation digests must be unique");
    }
    if (paths.has(reference.path)) {
      throw new Error("Result Bundle Evaluation paths must be unique");
    }
    digests.add(reference.digest);
    paths.add(reference.path);
    if (
      index > 0 &&
      compareText(evaluations[index - 1]!.digest, reference.digest) >= 0
    ) {
      throw new Error(
        "Result Bundle Evaluations must be in canonical digest order",
      );
    }
  }
}

function unsignedBundle(record: BenchmarkResultBundle) {
  return {
    schemaVersion: record.schemaVersion,
    kind: record.kind,
    attempt: record.attempt,
    evaluations: record.evaluations,
    ...(record.aggregate ? { aggregate: record.aggregate } : {}),
    ...(record.reward ? { reward: record.reward } : {}),
  };
}

export function parseBenchmarkResultBundle(
  value: unknown,
): BenchmarkResultBundle {
  const record = ResultBundleSchema.parse(
    decodeJsonInput(value),
  ) as BenchmarkResultBundle;
  assertCanonicalEvaluations(record.evaluations);
  if (record.reward && !record.aggregate) {
    throw new Error("Result Bundle Reward requires an Aggregate");
  }
  if (
    record.integrity.resultBundleDigest !==
    sha256(canonicalJson(unsignedBundle(record)))
  ) {
    throw new Error("Result Bundle digest does not match its content");
  }
  return deepFreeze(record);
}

async function checkedRoot(rootPath: string): Promise<string> {
  const info = await lstat(rootPath);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("Result Bundle root must be a real directory");
  }
  return realpath(rootPath);
}

async function inspectSingleFile(input: {
  root: string;
  path: string;
  label: string;
  expectedBytes?: Uint8Array;
}): Promise<Buffer> {
  const path = SafeRelativePathSchema.parse(input.path);
  const segments = path.split("/");
  let cursor = input.root;
  for (const segment of segments.slice(0, -1)) {
    cursor = join(cursor, segment);
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`${input.label} path must not traverse a link`);
    }
  }
  const absolutePath = join(input.root, ...segments);
  let handle;
  try {
    handle = await open(
      absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
  } catch (error) {
    if (isNodeError(error, "ELOOP")) {
      throw new Error(`${input.label} must not be a symbolic link`);
    }
    throw error;
  }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1) {
      throw new Error(`${input.label} must be one regular unlinked file`);
    }
    const bytes = await handle.readFile();
    const [after, pathInfo] = await Promise.all([
      handle.stat(),
      lstat(absolutePath),
    ]);
    if (
      !after.isFile() ||
      after.nlink !== 1 ||
      pathInfo.isSymbolicLink() ||
      !pathInfo.isFile() ||
      pathInfo.nlink !== 1 ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.dev !== pathInfo.dev ||
      before.ino !== pathInfo.ino ||
      (input.expectedBytes !== undefined &&
        !bytes.equals(Buffer.from(input.expectedBytes)))
    ) {
      throw new Error(`${input.label} changed or became linked while read`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function verifyReceipt(input: {
  root: string;
  label: string;
  expectedPath: string;
  path: string;
  bytes: number;
  sha256: string;
  record: unknown;
  digest: string;
}): Promise<BenchmarkResultRecordReference> {
  const path = SafeRelativePathSchema.parse(input.path);
  if (path !== input.expectedPath) {
    throw new Error(`${input.label} receipt path is not canonical`);
  }
  const recordBytes = canonicalJson(input.record);
  const recordSha256 = sha256(recordBytes);
  if (input.bytes !== recordBytes.byteLength || input.sha256 !== recordSha256) {
    throw new Error(`${input.label} receipt does not match its record bytes`);
  }
  const diskBytes = await inspectSingleFile({
    root: input.root,
    path,
    label: input.label,
    expectedBytes: recordBytes,
  });
  if (sha256(diskBytes) !== input.sha256) {
    throw new Error(`${input.label} sha256 does not match its receipt`);
  }
  return deepFreeze({ path, sha256: input.sha256, digest: input.digest });
}

async function verifyAttemptEvidence(
  root: string,
  evidence: BenchmarkAttemptRecordEvidence,
): Promise<BenchmarkResultRecordReference> {
  const record = evidence.record;
  if (
    record.schemaVersion !== 1 ||
    record.kind !== "clash.benchmark.attempt" ||
    record.integrity.algorithm !== "sha256" ||
    record.integrity.scope !== "canonical-json-without-integrity" ||
    !SHA256.test(record.integrity.attemptDigest)
  ) {
    throw new Error("Attempt record has an unsupported integrity contract");
  }
  const { integrity: _integrity, ...unsigned } = record;
  const attemptDigest = sha256(canonicalJson(unsigned));
  if (
    attemptDigest !== record.integrity.attemptDigest ||
    attemptDigest !== evidence.receipt.attemptDigest
  ) {
    throw new Error("Attempt digest does not match its immutable record");
  }
  return verifyReceipt({
    root,
    label: "Attempt record",
    expectedPath: RESULT_BUNDLE_PATH.replace("result-bundle", "attempt"),
    path: evidence.receipt.path,
    bytes: evidence.receipt.bytes,
    sha256: evidence.receipt.sha256,
    record,
    digest: attemptDigest,
  });
}

async function verifyEvaluationEvidence(
  root: string,
  receipt: EvaluationRecordReceipt<BenchmarkEvaluationRecord>,
  attemptDigest: string,
): Promise<{
  record: BenchmarkEvaluationRecord;
  reference: BenchmarkResultRecordReference;
}> {
  const record = parseEvaluationRecord(receipt.record);
  if (record.attemptDigest !== attemptDigest) {
    throw new Error(
      "All Result Bundle records must belong to the same Attempt",
    );
  }
  return {
    record,
    reference: await verifyReceipt({
      root,
      label: "Evaluation record",
      expectedPath: `evaluations/sha256/${record.digest}.json`,
      path: receipt.path,
      bytes: receipt.bytes,
      sha256: receipt.sha256,
      record,
      digest: record.digest,
    }),
  };
}

async function verifyAggregateEvidence(input: {
  root: string;
  receipt: EvaluationRecordReceipt<BenchmarkEvaluationAggregateRecord>;
  evaluations: readonly BenchmarkEvaluationRecord[];
  attemptDigest: string;
}): Promise<{
  record: BenchmarkEvaluationAggregateRecord;
  reference: BenchmarkResultRecordReference;
}> {
  const record = parseAggregateRecord(input.receipt.record, input.evaluations);
  if (record.attemptDigest !== input.attemptDigest) {
    throw new Error(
      "All Result Bundle records must belong to the same Attempt",
    );
  }
  return {
    record,
    reference: await verifyReceipt({
      root: input.root,
      label: "Evaluation Aggregate record",
      expectedPath: `aggregates/sha256/${record.digest}.json`,
      path: input.receipt.path,
      bytes: input.receipt.bytes,
      sha256: input.receipt.sha256,
      record,
      digest: record.digest,
    }),
  };
}

async function verifyRewardEvidence(input: {
  root: string;
  receipt: EvaluationRecordReceipt<BenchmarkRewardRecord>;
  aggregate: BenchmarkEvaluationAggregateRecord;
  attemptDigest: string;
}): Promise<BenchmarkResultRecordReference> {
  const record = parseRewardRecord(input.receipt.record, input.aggregate);
  if (record.attemptDigest !== input.attemptDigest) {
    throw new Error(
      "All Result Bundle records must belong to the same Attempt",
    );
  }
  return verifyReceipt({
    root: input.root,
    label: "Reward record",
    expectedPath: `rewards/sha256/${record.digest}.json`,
    path: input.receipt.path,
    bytes: input.receipt.bytes,
    sha256: input.receipt.sha256,
    record,
    digest: record.digest,
  });
}

async function assertReplaceableCurrentIndex(root: string): Promise<void> {
  const path = join(root, RESULT_BUNDLE_PATH);
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) {
      throw new Error(
        "Result Bundle current index must be one regular unlinked file",
      );
    }
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicReplace(root: string, bytes: Buffer): Promise<void> {
  await assertReplaceableCurrentIndex(root);
  const temporaryPath = join(root, `.${randomUUID()}.result-bundle.tmp`);
  let temporaryExists = false;
  try {
    const temporary = await open(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    temporaryExists = true;
    try {
      await temporary.writeFile(bytes);
      await temporary.sync();
    } finally {
      await temporary.close();
    }
    await assertReplaceableCurrentIndex(root);
    await rename(temporaryPath, join(root, RESULT_BUNDLE_PATH));
    temporaryExists = false;
    await syncDirectory(root);
  } finally {
    if (temporaryExists) {
      await unlink(temporaryPath).catch((error: unknown) => {
        if (!isNodeError(error, "ENOENT")) throw error;
      });
    }
  }
  await inspectSingleFile({
    root,
    path: RESULT_BUNDLE_PATH,
    label: "Result Bundle current index",
    expectedBytes: bytes,
  });
}

export async function writeBenchmarkResultBundle(
  input: WriteBenchmarkResultBundleInput,
): Promise<BenchmarkResultBundleReceipt> {
  const root = await checkedRoot(input.root);
  const attempt = await verifyAttemptEvidence(root, input.attempt);
  const evaluationEvidence = await Promise.all(
    input.evaluations.map((receipt) =>
      verifyEvaluationEvidence(root, receipt, attempt.digest),
    ),
  );
  const evaluationRecords = evaluationEvidence.map(({ record }) => record);
  const evaluations = evaluationEvidence
    .map(({ reference }) => reference)
    .sort((left, right) => compareText(left.digest, right.digest));
  assertCanonicalEvaluations(evaluations);

  const aggregate = input.aggregate
    ? await verifyAggregateEvidence({
        root,
        receipt: input.aggregate,
        evaluations: evaluationRecords,
        attemptDigest: attempt.digest,
      })
    : undefined;
  if (input.reward && !aggregate) {
    throw new Error("Result Bundle Reward requires an Aggregate");
  }
  const reward = input.reward
    ? await verifyRewardEvidence({
        root,
        receipt: input.reward,
        aggregate: aggregate!.record,
        attemptDigest: attempt.digest,
      })
    : undefined;

  const unsigned = {
    schemaVersion: 1 as const,
    kind: "clash.benchmark.result-bundle" as const,
    attempt,
    evaluations,
    ...(aggregate ? { aggregate: aggregate.reference } : {}),
    ...(reward ? { reward } : {}),
  };
  const record = parseBenchmarkResultBundle({
    ...unsigned,
    integrity: {
      algorithm: "sha256",
      scope: "canonical-json-without-integrity",
      resultBundleDigest: sha256(canonicalJson(unsigned)),
    },
  });
  const bytes = canonicalJson(record);
  await atomicReplace(root, bytes);
  return deepFreeze({
    record,
    path: RESULT_BUNDLE_PATH,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    resultBundleDigest: record.integrity.resultBundleDigest,
  });
}
