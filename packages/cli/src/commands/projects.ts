import { Command } from "commander";
import { apiJson } from "../lib/api";
import { isJsonMode, printJson, printTable } from "../lib/output";

export const projectsCommand = new Command("projects")
  .description("Manage projects");

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
    const data = await apiJson(`/api/v1/projects/${options.id}`);

    if (isJsonMode(options)) {
      printJson(data);
    } else {
      const p = data as any;
      console.log(`ID:          ${p.id}`);
      console.log(`Name:        ${p.name}`);
      console.log(`Description: ${p.description ?? "(none)"}`);
      console.log(`Created:     ${p.created_at}`);
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
