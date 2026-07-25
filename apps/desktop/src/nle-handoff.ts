import { execFile } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type DesktopNleTarget = 'premiere-pro' | 'final-cut-pro' | 'davinci-resolve';

export type DesktopNleAvailability = {
  target: DesktopNleTarget;
  applicationName: string;
  installed: boolean;
  applicationPath?: string;
};

const NLE_TARGETS: DesktopNleTarget[] = [
  'premiere-pro',
  'final-cut-pro',
  'davinci-resolve',
];

export type DesktopNleHandoffRequest = {
  target: DesktopNleTarget;
  timelineName: string;
  revisionId: string;
  extension: 'otio' | 'fcpxml' | 'xml';
  content: string;
  assets: Array<{ token: string; source: string; filename: string }>;
};

export function nleApplicationName(target: DesktopNleTarget): string {
  if (target === 'premiere-pro') return 'Adobe Premiere Pro';
  if (target === 'final-cut-pro') return 'Final Cut Pro';
  return 'DaVinci Resolve';
}

export function isNleApplicationBundle(target: DesktopNleTarget, filename: string): boolean {
  if (target === 'premiere-pro') return /^Adobe Premiere Pro(?:\s+.+)?\.app$/i.test(filename);
  if (target === 'final-cut-pro') return /^Final Cut Pro\.app$/i.test(filename);
  return /^DaVinci Resolve\.app$/i.test(filename);
}

async function scanApplicationDirectory(
  directory: string,
  target: DesktopNleTarget,
  depth: number,
): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && isNleApplicationBundle(target, entry.name)) {
      return join(directory, entry.name);
    }
  }
  if (depth <= 0) return null;

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.endsWith('.app')) continue;
    const nested = await scanApplicationDirectory(join(directory, entry.name), target, depth - 1);
    if (nested) return nested;
  }
  return null;
}

export async function locateNleApplication(target: DesktopNleTarget): Promise<string | null> {
  for (const root of ['/Applications', join(homedir(), 'Applications'), '/System/Applications']) {
    const path = await scanApplicationDirectory(root, target, 1);
    if (path) return path;
  }
  return null;
}

export async function detectNleAvailability(
  probe: (target: DesktopNleTarget) => Promise<string | null> = locateNleApplication,
): Promise<DesktopNleAvailability[]> {
  return Promise.all(NLE_TARGETS.map(async (target) => {
    const applicationName = nleApplicationName(target);
    const applicationPath = await probe(target);
    return applicationPath
      ? { target, applicationName, installed: true, applicationPath }
      : { target, applicationName, installed: false };
  }));
}

export function safeHandoffName(name: string, revisionId: string): string {
  return `${name.trim()}-${revisionId}`
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

export function materializedAssetPath(mediaDir: string, source: string, filename: string): string {
  if (source.startsWith('file://')) return fileURLToPath(source);
  if (isAbsolute(source)) return source;
  return join(mediaDir, filename);
}

export function replaceAssetTokens(content: string, assets: Array<{ token: string; path: string }>): string {
  return assets.reduce(
    (next, asset) => next.replaceAll(asset.token, pathToFileURL(asset.path).href),
    content,
  );
}

function isRemoteSource(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

export async function materializeNleHandoff(
  rootDir: string,
  request: DesktopNleHandoffRequest,
  fetchAsset: (source: string) => Promise<ArrayBuffer> = async (source) => {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Could not download handoff media (${response.status})`);
    return response.arrayBuffer();
  },
): Promise<string> {
  const handoffName = safeHandoffName(request.timelineName, request.revisionId);
  const handoffDir = join(rootDir, handoffName);
  const mediaDir = join(handoffDir, 'media');
  await mkdir(mediaDir, { recursive: true });

  const materialized: Array<{ token: string; path: string }> = [];
  for (const [index, asset] of request.assets.entries()) {
    const uniqueFilename = `${String(index + 1).padStart(3, '0')}-${asset.filename}`;
    const path = materializedAssetPath(mediaDir, asset.source, uniqueFilename);
    if (isRemoteSource(asset.source)) {
      await writeFile(path, Buffer.from(await fetchAsset(asset.source)));
    }
    materialized.push({ token: asset.token, path });
  }

  const documentPath = join(handoffDir, `${handoffName}.${request.extension}`);
  await writeFile(documentPath, replaceAssetTokens(request.content, materialized), 'utf8');
  return documentPath;
}

export async function openNleDocument(target: DesktopNleTarget, documentPath: string): Promise<void> {
  await execFileAsync('/usr/bin/open', ['-a', nleApplicationName(target), documentPath]);
}
