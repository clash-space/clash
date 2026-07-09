import { rmSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

const LEGACY_PRODUCT_JSON_DATABASE_FILE = ["db", "json"].join(".");

export function legacyProductJsonDatabasePath(dataDir: string): string {
  return join(dataDir, LEGACY_PRODUCT_JSON_DATABASE_FILE);
}

export async function purgeLegacyProductJsonDatabase(dataDir: string): Promise<void> {
  await rm(legacyProductJsonDatabasePath(dataDir), { force: true });
}

export function purgeLegacyProductJsonDatabaseSync(dataDir: string): void {
  rmSync(legacyProductJsonDatabasePath(dataDir), { force: true });
}
