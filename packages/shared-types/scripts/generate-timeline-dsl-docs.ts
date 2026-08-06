import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderTimelineAgentWorkflowReference,
  renderTimelineDslMarkdown,
  renderTimelineMaskSkillReference,
  renderTimelineMaskKeyframesExampleYaml,
} from "../src/index";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const docsPath = resolve(repositoryRoot, "docs/timeline-dsl.md");
const examplePath = resolve(repositoryRoot, "docs/examples/mask-keyframes.timeline.yaml");
const timelineSkillPath = resolve(repositoryRoot, "plugins/clash-timeline/skills/clash-timeline/SKILL.md");
const clashSkillPath = resolve(repositoryRoot, "plugins/clash/skills/clash/SKILL.md");
const agentPreludePath = resolve(repositoryRoot, "packages/clash-bridge/assets/shared-cwd/AGENTS-prelude.md");

async function updateGeneratedSection(path: string, generated: string): Promise<void> {
  const source = await readFile(path, "utf8");
  const beginMarker = generated.slice(0, generated.indexOf("\n"));
  const endMarker = generated.slice(generated.lastIndexOf("\n") + 1);
  const begin = source.indexOf(beginMarker);
  const end = source.indexOf(endMarker, begin + beginMarker.length);
  if (begin < 0 || end < 0) {
    throw new Error(`Missing generated Timeline markers in ${path}`);
  }
  const next = source.slice(0, begin) + generated + source.slice(end + endMarker.length);
  await writeFile(path, next, "utf8");
}

await mkdir(dirname(examplePath), { recursive: true });
await Promise.all([
  writeFile(docsPath, renderTimelineDslMarkdown(), "utf8"),
  writeFile(examplePath, renderTimelineMaskKeyframesExampleYaml(), "utf8"),
  updateGeneratedSection(timelineSkillPath, renderTimelineMaskSkillReference()),
  updateGeneratedSection(clashSkillPath, renderTimelineAgentWorkflowReference()),
  updateGeneratedSection(agentPreludePath, renderTimelineAgentWorkflowReference()),
]);
