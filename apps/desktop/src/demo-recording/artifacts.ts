import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface DemoArtifactChapter {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
}

export interface DemoArtifactFileInput {
  path: string;
  mediaType: string;
}

export interface DemoArtifactFile extends DemoArtifactFileInput {
  bytes: number;
  sha256: string;
}

export interface DemoArtifactManifest {
  schemaVersion: 1;
  suiteId: string;
  caseId: string;
  caseKind: "agent" | "feature";
  title: string;
  status: "pass" | "fail";
  startedAt: string;
  completedAt: string;
  chapters: DemoArtifactChapter[];
  files: DemoArtifactFile[];
}

export interface WriteArtifactManifestOptions {
  artifactDir: string;
  suiteId: string;
  caseId: string;
  caseKind: "agent" | "feature";
  status: "pass" | "fail";
  title: string;
  startedAt: string;
  completedAt: string;
  chapters: DemoArtifactChapter[];
  files: DemoArtifactFileInput[];
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function resolveArtifactFile(artifactDir: string, declaredPath: string): Promise<string> {
  if (isAbsolute(declaredPath) || declaredPath.trim().length === 0) {
    throw new Error("artifact file must stay inside the artifact directory");
  }
  const absolutePath = resolve(artifactDir, declaredPath);
  if (absolutePath === resolve(artifactDir, "manifest.json")) {
    throw new Error("manifest.json cannot include itself as an artifact file");
  }
  const relativePath = relative(resolve(artifactDir), absolutePath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("artifact file must stay inside the artifact directory");
  }
  const fileInfo = await lstat(absolutePath);
  if (fileInfo.isSymbolicLink()) {
    throw new Error(`artifact file cannot be a symbolic link: ${declaredPath}`);
  }
  const [realArtifactDir, realArtifactFile] = await Promise.all([
    realpath(artifactDir),
    realpath(absolutePath),
  ]);
  const realRelativePath = relative(realArtifactDir, realArtifactFile);
  if (
    realRelativePath === ".." ||
    realRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(realRelativePath)
  ) {
    throw new Error("artifact file must stay inside the artifact directory");
  }
  return absolutePath;
}

export async function writeArtifactManifest(
  options: WriteArtifactManifestOptions,
): Promise<DemoArtifactManifest> {
  const files = await Promise.all(
    options.files.map(async (file): Promise<DemoArtifactFile> => {
      const absolutePath = await resolveArtifactFile(options.artifactDir, file.path);
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) throw new Error(`artifact is not a file: ${file.path}`);
      return {
        path: file.path.replaceAll("\\", "/"),
        mediaType: file.mediaType,
        bytes: fileStat.size,
        sha256: await sha256File(absolutePath),
      };
    }),
  );

  const manifest: DemoArtifactManifest = {
    schemaVersion: 1,
    suiteId: options.suiteId,
    caseId: options.caseId,
    caseKind: options.caseKind,
    title: options.title,
    status: options.status,
    startedAt: options.startedAt,
    completedAt: options.completedAt,
    chapters: options.chapters,
    files,
  };
  const manifestPath = resolve(options.artifactDir, "manifest.json");
  const temporaryPath = `${manifestPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rename(temporaryPath, manifestPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return manifest;
}
