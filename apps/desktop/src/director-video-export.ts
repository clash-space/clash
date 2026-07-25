export type DesktopDirectorVideoExportRequest = {
  stageName: string;
  cameraName: string;
  bytes: ArrayBuffer;
};

function safePart(value: string): string {
  return value.trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function safeDirectorVideoExportName(stageName: string, cameraName: string): string {
  const stem = [safePart(stageName), safePart(cameraName)].filter(Boolean).join("-");
  return `${stem || "director-camera"}.webm`;
}

export function directorVideoBytes(bytes: ArrayBuffer): Uint8Array {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) {
    throw new Error("Director camera video export requires non-empty WebM bytes.");
  }
  return new Uint8Array(bytes);
}
