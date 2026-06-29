import { Command } from "commander";
import { randomUUID } from "node:crypto";
import { apiJson } from "../lib/api";
import { isJsonMode, printJson, printTable } from "../lib/output";
import {
  resolveProjectContext,
  writeProjectMarker,
  type ResolvedProjectContext,
} from "../lib/project-context";

export async function linkProject(
  projectId: string,
  options: { cwd?: string } = {},
): Promise<string> {
  return writeProjectMarker(options.cwd ?? process.cwd(), {
    schemaVersion: 1,
    projectId,
    store: "external",
    sync: { mode: "local" },
  });
}

export async function initProject(options: {
  cwd?: string;
  projectId?: string;
} = {}): Promise<{ projectId: string; markerPath: string }> {
  const projectId = options.projectId?.trim() || `local_${randomUUID()}`;
  const markerPath = await writeProjectMarker(options.cwd ?? process.cwd(), {
    schemaVersion: 1,
    projectId,
    store: "managed",
    sync: { mode: "local" },
  });
  return { projectId, markerPath };
}

export const initCommand = new Command("init")
  .description("Initialize a local Clash project marker in this directory")
  .option("--project <id>", "Use an existing project id instead of generating a local id")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const result = await initProject({ projectId: options.project });
    if (isJsonMode(options)) {
      printJson(result);
    } else {
      console.log(`Initialized Clash project: ${result.projectId}`);
      console.log(`Marker: ${result.markerPath}`);
    }
  });

export const projectsCommand = new Command("projects")
  .alias("project")
  .description("Manage projects");

projectsCommand
  .command("link")
  .description("Link this directory to a Clash project")
  .argument("<projectId>", "Project ID")
  .option("--json", "Output as JSON")
  .action(async (projectId, options) => {
    const markerPath = await linkProject(projectId);
    const result = { projectId, markerPath };
    if (isJsonMode(options)) {
      printJson(result);
    } else {
      console.log(`Linked Clash project: ${projectId}`);
      console.log(`Marker: ${markerPath}`);
    }
  });

projectsCommand
  .command("status")
  .description("Show the resolved Clash project context")
  .option("--project <id>", "Project ID")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    let context: ResolvedProjectContext;
    try {
      context = await resolveProjectContext({ project: options.project });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(2);
    }

    if (isJsonMode(options)) {
      printJson(context);
      return;
    }

    console.log(`Project: ${context.projectId}`);
    console.log(`Source:  ${context.source}`);
    console.log(`Marker:  ${context.markerPath ?? "(none)"}`);
  });

projectsCommand
  .command("list")
  .description("List your projects")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const data = await apiJson<{ projects: any[] }>("/api/v1/projects");

    if (isJsonMode(options)) {
      printJson(data.projects);
    } else {
      printTable(data.projects, [
        { key: "id", label: "ID", width: 38 },
        { key: "name", label: "Name", width: 30 },
        { key: "created_at", label: "Created", width: 12 },
      ]);
    }
  });

projectsCommand
  .command("create")
  .description("Create a new project")
  .requiredOption("--name <name>", "Project name")
  .option("--description <desc>", "Project description")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const data = await apiJson<{ id: string; name: string }>(
      "/api/v1/projects",
      {
        method: "POST",
        body: JSON.stringify({
          name: options.name,
          description: options.description,
        }),
      }
    );

    if (isJsonMode(options)) {
      printJson(data);
    } else {
      console.log(`Created project: ${data.id} (${data.name})`);
    }
  });

projectsCommand
  .command("get")
  .description("Get project details")
  .requiredOption("--id <id>", "Project ID")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const data = await apiJson<{ id: string; name: string; description?: string; created_at: string }>(
      `/api/v1/projects/${options.id}`
    );

    if (isJsonMode(options)) {
      printJson(data);
    } else {
      console.log(`ID:          ${data.id}`);
      console.log(`Name:        ${data.name}`);
      console.log(`Description: ${data.description ?? "(none)"}`);
      console.log(`Created:     ${data.created_at}`);
    }
  });

projectsCommand
  .command("delete")
  .description("Delete a project")
  .requiredOption("--id <id>", "Project ID")
  .action(async (options) => {
    await apiJson(`/api/v1/projects/${options.id}`, { method: "DELETE" });
    console.log(`Deleted project: ${options.id}`);
  });
