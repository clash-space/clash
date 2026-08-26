import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

function assertInside(root: string, candidate: string, detail: string): void {
  const nested = relative(root, candidate);
  if (nested === ".." || nested.startsWith(`..${sep}`) || isAbsolute(nested)) {
    throw new Error(`Content file must stay inside the workspace (${detail})`);
  }
}

export async function resolveWorkspaceTextInput(input: {
  workspaceRoot: string;
  inline?: string;
  filePath?: string;
}): Promise<string | undefined> {
  if (input.inline !== undefined && input.filePath !== undefined) {
    throw new Error("Inline content and content file are mutually exclusive");
  }
  if (input.inline !== undefined) return input.inline;
  if (input.filePath === undefined) return undefined;
  if (!input.filePath) throw new Error("Content file path is required");

  const workspaceRoot = resolve(input.workspaceRoot);
  const candidate = resolve(workspaceRoot, input.filePath);
  assertInside(workspaceRoot, candidate, "path traversal is not allowed");

  const [realWorkspaceRoot, realCandidate] = await Promise.all([
    realpath(workspaceRoot),
    realpath(candidate),
  ]);
  assertInside(
    realWorkspaceRoot,
    realCandidate,
    "symlinks must not escape the workspace",
  );
  if (!(await stat(realCandidate)).isFile()) {
    throw new Error("Content file must be a regular file");
  }

  const bytes = await readFile(realCandidate);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      bytes,
    );
  } catch {
    throw new Error("Content file must contain valid UTF-8");
  }
}
