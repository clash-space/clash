import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ExecutablePluginContractTestDocumentSchema,
  ExecutablePluginManifestSchema,
} from "@clash/shared-types";
import { describe, expect, it } from "vitest";

const PROVIDERS = ["fal", "google", "minimax", "pika", "hrhrng-hub"] as const;

describe("first-party Provider operation contracts", () => {
  it.each(PROVIDERS)(
    "%s exercises every declared submit/poll operation through a contract document",
    async (provider) => {
      const pluginDir = join(__dirname, "../../../plugins", provider);
      const manifest = ExecutablePluginManifestSchema.parse(
        JSON.parse(await readFile(join(pluginDir, "manifest.json"), "utf8")),
      );
      const contracts = await Promise.all(
        manifest.contractTests.map(async (path) =>
          ExecutablePluginContractTestDocumentSchema.parse(
            JSON.parse(await readFile(join(pluginDir, path), "utf8")),
          ),
        ),
      );

      for (const executor of manifest.contributes.functions.filter(
        (entry) => entry.kind === "provider-executor",
      )) {
        const declared = executor.operations.filter(
          (operation) => operation === "submit" || operation === "poll",
        );
        const covered = new Set(
          contracts
            .filter(
              (contract) =>
                contract.target.kind === "provider-executor" &&
                contract.target.exportId === executor.id,
            )
            .map((contract) => contract.operation),
        );

        expect([...covered].sort(), `${manifest.id}/${executor.id}`).toEqual(
          [...declared].sort(),
        );
      }
    },
  );
});
