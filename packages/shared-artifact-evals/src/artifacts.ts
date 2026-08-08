import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { ArtifactSubmissionSchema } from "./schemas";
import type {
  ArtifactDescriptor,
  ArtifactEvidence,
  ArtifactSubmission,
} from "./types";

export type LoadedArtifact = {
  descriptor: ArtifactDescriptor;
  absolutePath?: string;
  content?: Buffer;
  evidence?: ArtifactEvidence;
  error?: string;
};

export type LoadedSubmission = {
  workspace: string;
  submission?: ArtifactSubmission;
  artifacts: LoadedArtifact[];
  error?: string;
};

const MAX_STRUCTURED_ARTIFACT_BYTES = 8 * 1024 * 1024;
const IN_MEMORY_ARTIFACT_KINDS = new Set<ArtifactDescriptor["kind"]>([
  "director-stage",
  "timeline",
  "remotion-component",
]);

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", rejectPromise);
    stream.once("end", resolvePromise);
  });
  return hash.digest("hex");
}

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (
    pathFromRoot !== ".."
    && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot)
  );
}

function validateRelativeArtifactPath(path: string): string | null {
  if (path.includes("\0")) return "Artifact path must not contain null bytes";
  if (isAbsolute(path) || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path)) {
    return "Artifact path must stay inside the evaluation workspace";
  }
  const segments = path.split(/[\\/]+/);
  if (segments.includes("..")) {
    return "Artifact path must stay inside the evaluation workspace";
  }
  return null;
}

async function resolveRegularFileInsideWorkspace(
  workspace: string,
  relativePath: string,
): Promise<string> {
  const invalidPath = validateRelativeArtifactPath(relativePath);
  if (invalidPath) throw new Error(invalidPath);

  const candidate = resolve(workspace, relativePath);
  if (!isInside(workspace, candidate)) {
    throw new Error("Artifact path must stay inside the evaluation workspace");
  }

  const relativeCandidate = relative(workspace, candidate);
  let cursor = workspace;
  for (const segment of relativeCandidate.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    let info;
    try {
      info = await lstat(cursor);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") throw new Error(`Artifact file does not exist: ${relativePath}`);
      throw error;
    }
    if (info.isSymbolicLink()) {
      throw new Error(`Artifact path must not contain symlink components: ${relativePath}`);
    }
  }

  const canonicalCandidate = await realpath(candidate);
  if (!isInside(workspace, canonicalCandidate)) {
    throw new Error("Artifact path must resolve inside the evaluation workspace");
  }
  const info = await stat(canonicalCandidate);
  if (!info.isFile()) throw new Error(`Artifact must be a regular file: ${relativePath}`);
  return canonicalCandidate;
}

async function loadArtifact(
  workspace: string,
  descriptor: ArtifactDescriptor,
): Promise<LoadedArtifact> {
  try {
    const absolutePath = await resolveRegularFileInsideWorkspace(workspace, descriptor.path);
    const fileInfo = await stat(absolutePath);
    const evidence = {
      ...descriptor,
      bytes: fileInfo.size,
      sha256: await hashFile(absolutePath),
    };
    if (
      IN_MEMORY_ARTIFACT_KINDS.has(descriptor.kind)
      && fileInfo.size > MAX_STRUCTURED_ARTIFACT_BYTES
    ) {
      return {
        descriptor,
        absolutePath,
        evidence,
        error: `Structured artifact '${descriptor.id}' exceeds ${MAX_STRUCTURED_ARTIFACT_BYTES} bytes`,
      };
    }
    const content = IN_MEMORY_ARTIFACT_KINDS.has(descriptor.kind)
      ? await readFile(absolutePath)
      : undefined;
    return {
      descriptor,
      absolutePath,
      ...(content ? { content } : {}),
      evidence,
    };
  } catch (error) {
    return {
      descriptor,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatValidationError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "submission"}: ${issue.message}`)
    .join("; ");
}

export async function loadSubmission(workspacePath: string): Promise<LoadedSubmission> {
  let workspace: string;
  try {
    workspace = await realpath(workspacePath);
    const workspaceInfo = await stat(workspace);
    if (!workspaceInfo.isDirectory()) {
      return { workspace, artifacts: [], error: "Evaluation workspace must be a directory" };
    }
  } catch (error) {
    return {
      workspace: resolve(workspacePath),
      artifacts: [],
      error: `Unable to open evaluation workspace: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let submissionBytes: Buffer;
  try {
    const submissionPath = await resolveRegularFileInsideWorkspace(workspace, "submission.json");
    submissionBytes = await readFile(submissionPath);
  } catch (error) {
    return {
      workspace,
      artifacts: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  let rawSubmission: unknown;
  try {
    rawSubmission = JSON.parse(submissionBytes.toString("utf8"));
  } catch (error) {
    return {
      workspace,
      artifacts: [],
      error: `Invalid submission.json: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const parsed = ArtifactSubmissionSchema.safeParse(rawSubmission);
  if (!parsed.success) {
    return {
      workspace,
      artifacts: [],
      error: `Invalid submission.json: ${formatValidationError(parsed.error)}`,
    };
  }

  const artifacts: LoadedArtifact[] = [];
  for (const descriptor of parsed.data.artifacts) {
    artifacts.push(await loadArtifact(workspace, descriptor));
  }
  return { workspace, submission: parsed.data, artifacts };
}
