import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type DemoCaseKind = "agent" | "feature";
export type DemoTheme = "light" | "dark" | "system";

export interface DemoViewport {
  width: number;
  height: number;
}

export interface DemoChapter {
  id: string;
  title: string;
}

export interface DemoCase {
  id: string;
  title: string;
  kind: DemoCaseKind;
  driverPath: string;
  chapters: DemoChapter[];
  viewport: DemoViewport;
  locale: string;
  theme: DemoTheme;
  timeoutMs: number;
}

export interface DemoSuite {
  schemaVersion: 1;
  id: string;
  suitePath: string;
  cases: DemoCase[];
}

interface DemoCaseDefaults {
  viewport?: DemoViewport;
  locale?: string;
  theme?: DemoTheme;
  timeoutMs?: number;
}

interface DemoCaseInput extends DemoCaseDefaults {
  id: string;
  title: string;
  kind: DemoCaseKind;
  driver: string;
  chapters: DemoChapter[];
}

interface DemoSuiteInput {
  schemaVersion: 1;
  id: string;
  defaults?: DemoCaseDefaults;
  cases: DemoCaseInput[];
}

const FALLBACK_DEFAULTS: Required<DemoCaseDefaults> = {
  viewport: { width: 1440, height: 900 },
  locale: "en-US",
  theme: "light",
  timeoutMs: 120_000,
};

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requirePortableIdentifier(value: unknown, label: string): string {
  const id = requireString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(id)) {
    throw new Error(`${label} must be a portable identifier`);
  }
  return id;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value as number;
}

function parseViewport(value: unknown, label: string): DemoViewport {
  const record = requireRecord(value, label);
  return {
    width: requirePositiveInteger(record.width, `${label}.width`),
    height: requirePositiveInteger(record.height, `${label}.height`),
  };
}

function parseTheme(value: unknown, label: string): DemoTheme {
  if (value !== "light" && value !== "dark" && value !== "system") {
    throw new Error(`${label} must be light, dark, or system`);
  }
  return value;
}

function parseDefaults(value: unknown, label: string): DemoCaseDefaults {
  if (value === undefined) return {};
  const record = requireRecord(value, label);
  return {
    viewport:
      record.viewport === undefined
        ? undefined
        : parseViewport(record.viewport, `${label}.viewport`),
    locale:
      record.locale === undefined
        ? undefined
        : requireString(record.locale, `${label}.locale`),
    theme:
      record.theme === undefined
        ? undefined
        : parseTheme(record.theme, `${label}.theme`),
    timeoutMs:
      record.timeoutMs === undefined
        ? undefined
        : requirePositiveInteger(record.timeoutMs, `${label}.timeoutMs`),
  };
}

function parseChapters(value: unknown, caseId: string): DemoChapter[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`demo case ${caseId} must declare at least one chapter`);
  }

  const ids = new Set<string>();
  return value.map((chapter, index) => {
    const record = requireRecord(chapter, `cases.${caseId}.chapters[${index}]`);
    const id = requirePortableIdentifier(
      record.id,
      `cases.${caseId}.chapters[${index}].id`,
    );
    if (ids.has(id)) {
      throw new Error(`duplicate chapter id ${id} in demo case ${caseId}`);
    }
    ids.add(id);
    return {
      id,
      title: requireString(record.title, `cases.${caseId}.chapters[${index}].title`),
    };
  });
}

function resolveDriverPath(suiteDirectory: string, driver: unknown): string {
  const declaredPath = requireString(driver, "demo case driver");
  if (isAbsolute(declaredPath)) {
    throw new Error("demo case driver must stay inside the suite directory");
  }

  const driverPath = resolve(suiteDirectory, declaredPath);
  const relativePath = relative(suiteDirectory, driverPath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("demo case driver must stay inside the suite directory");
  }
  if (!driverPath.endsWith(".ts")) {
    throw new Error("demo case driver must be a TypeScript file");
  }
  if (existsSync(driverPath)) {
    if (lstatSync(driverPath).isSymbolicLink()) {
      throw new Error("demo case driver must not be a symbolic link");
    }
    const realSuiteDirectory = realpathSync(suiteDirectory);
    const realDriverPath = realpathSync(driverPath);
    const realRelativePath = relative(realSuiteDirectory, realDriverPath);
    if (
      realRelativePath === ".." ||
      realRelativePath.startsWith(`..${sep}`) ||
      isAbsolute(realRelativePath)
    ) {
      throw new Error("demo case driver must stay inside the suite directory");
    }
  }
  return driverPath;
}

export function parseDemoSuite(value: unknown, suitePath: string): DemoSuite {
  const suiteRecord = requireRecord(value, "demo suite");
  if (suiteRecord.schemaVersion !== 1) {
    throw new Error("demo suite schemaVersion must be 1");
  }

  const id = requirePortableIdentifier(suiteRecord.id, "demo suite id");
  const defaults = {
    ...FALLBACK_DEFAULTS,
    ...parseDefaults(suiteRecord.defaults, "demo suite defaults"),
  };
  if (!Array.isArray(suiteRecord.cases) || suiteRecord.cases.length === 0) {
    throw new Error("demo suite must declare at least one case");
  }

  const suiteDirectory = dirname(resolve(suitePath));
  const caseIds = new Set<string>();
  const cases = suiteRecord.cases.map((input, index): DemoCase => {
    const record = requireRecord(input, `demo suite cases[${index}]`);
    const caseId = requirePortableIdentifier(record.id, "demo case id");
    if (caseIds.has(caseId)) {
      throw new Error(`duplicate demo case id ${caseId}`);
    }
    caseIds.add(caseId);

    if (record.kind !== "agent" && record.kind !== "feature") {
      throw new Error(`demo case ${caseId} kind must be agent or feature`);
    }
    const overrides = parseDefaults(record, `demo case ${caseId}`);

    return {
      id: caseId,
      title: requireString(record.title, `demo case ${caseId} title`),
      kind: record.kind,
      driverPath: resolveDriverPath(suiteDirectory, record.driver),
      chapters: parseChapters(record.chapters, caseId),
      viewport: overrides.viewport ?? defaults.viewport,
      locale: overrides.locale ?? defaults.locale,
      theme: overrides.theme ?? defaults.theme,
      timeoutMs: overrides.timeoutMs ?? defaults.timeoutMs,
    };
  });

  return {
    schemaVersion: 1,
    id,
    suitePath: resolve(suitePath),
    cases,
  };
}

export type { DemoCaseInput, DemoSuiteInput };
