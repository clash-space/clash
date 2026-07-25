import { basename, join, resolve } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import type { EffectKind } from "@master-clash/remotion-effects";
import {
  installEffectPackage,
  packEffectPackage,
  scaffoldEffectPackage,
  validateEffectPackage,
} from "@master-clash/remotion-effects/authoring";
import { resolveClashRoot } from "../lib/clash-home";
import { isJsonMode, printJson } from "../lib/output";

const EFFECT_KINDS: EffectKind[] = [
  "clip-effect",
  "transition",
  "generator",
  "mask",
  "composite",
];

function parseEffectKind(value: string): EffectKind {
  if (!EFFECT_KINDS.includes(value as EffectKind)) {
    throw new InvalidArgumentError(`kind must be one of: ${EFFECT_KINDS.join(", ")}`);
  }
  return value as EffectKind;
}

function defaultEffectDirectory(id: string): string {
  const name = id.split("/").at(-1) || id;
  return resolve(process.cwd(), "effects", name);
}

export const effectCommand = new Command("effect")
  .description("Create, validate, package, and install local Timeline effects");

effectCommand
  .command("create")
  .description("Scaffold an Agent-editable effect package")
  .argument("<id>", "Namespaced effect id, for example agent/liquid-wipe")
  .option("--kind <kind>", "Effect kind", parseEffectKind, "transition")
  .option("--directory <path>", "Output directory")
  .option("--json", "Output result as JSON")
  .action(async (id: string, options: { kind: EffectKind; directory?: string; json?: boolean }) => {
    const result = await scaffoldEffectPackage({
      target: resolve(options.directory ?? defaultEffectDirectory(id)),
      id,
      kind: options.kind,
    });
    if (isJsonMode(options)) {
      printJson(result);
      return;
    }
    console.log(`Created ${id} in ${result.target}`);
    for (const file of result.files) console.log(`  ${file}`);
  });

effectCommand
  .command("validate")
  .description("Validate an effect manifest and every referenced shader without executing package code")
  .argument("[directory]", "Effect package directory", ".")
  .option("--json", "Output validation report as JSON")
  .action(async (directory: string, options: { json?: boolean }) => {
    const root = resolve(directory);
    const result = await validateEffectPackage(root);
    if (isJsonMode(options)) {
      printJson({ root, ...result });
    } else if (result.ok && result.effect) {
      console.log(`Valid ${result.effect.id}@${result.effect.version}`);
    } else {
      console.error(`Invalid effect package: ${root}`);
      for (const issue of result.issues) {
        console.error(`  ${issue.code}${issue.path ? ` (${issue.path})` : ""}: ${issue.message}`);
      }
    }
    if (!result.ok) process.exitCode = 1;
  });

effectCommand
  .command("pack")
  .description("Validate and create a deterministic .clash-effect.json bundle")
  .argument("[directory]", "Effect package directory", ".")
  .option("--output <path>", "Bundle output path")
  .option("--json", "Output result as JSON")
  .action(async (directory: string, options: { output?: string; json?: boolean }) => {
    const result = await packEffectPackage({
      root: resolve(directory),
      output: options.output ? resolve(options.output) : undefined,
    });
    const output = { output: result.output, effect: result.bundle.effect };
    if (isJsonMode(options)) {
      printJson(output);
      return;
    }
    console.log(`Packed ${result.bundle.effect.id}@${result.bundle.effect.version} to ${result.output}`);
  });

effectCommand
  .command("install")
  .description("Install a validated, immutable effect bundle under $CLASH_HOME/effects")
  .argument("<bundle>", "Path to a .clash-effect.json bundle")
  .option("--root <path>", "Effect registry root")
  .option("--json", "Output result as JSON")
  .action(async (bundle: string, options: { root?: string; json?: boolean }) => {
    const result = await installEffectPackage({
      bundle: resolve(bundle),
      effectsRoot: resolve(options.root ?? join(resolveClashRoot(), "effects")),
    });
    if (isJsonMode(options)) {
      printJson(result);
      return;
    }
    console.log(`Installed ${result.effect.id}@${result.effect.version} in ${result.installPath}`);
    console.log(`Bundle: ${basename(bundle)}`);
  });
