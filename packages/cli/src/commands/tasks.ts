import { Command } from "commander";
import { apiJson } from "../lib/api";
import { isJsonMode, printJson } from "../lib/output";

export const tasksCommand = new Command("tasks")
  .description("Generation task management");

tasksCommand
  .command("status")
  .description("Check task status")
  .requiredOption("--task-id <id>", "Task ID")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const data = await apiJson<{
      task_id: string;
      status: string;
      result_url?: string;
      error?: string;
    }>(`/api/tasks/${options.taskId}`);

    if (isJsonMode(options)) {
      printJson(data);
    } else {
      console.log(`Task:   ${data.task_id}`);
      console.log(`Status: ${data.status}`);
      if (data.result_url) console.log(`Result: ${data.result_url}`);
      if (data.error) console.log(`Error:  ${data.error}`);
    }
  });

tasksCommand
  .command("wait")
  .description("Wait for a task to complete")
  .requiredOption("--task-id <id>", "Task ID")
  .option("--timeout <seconds>", "Max wait time", "120")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const deadline = Date.now() + parseInt(options.timeout) * 1000;
    const POLL_MS = 3_000;

    while (Date.now() < deadline) {
      const data = await apiJson<{
        task_id: string;
        status: string;
        result_url?: string;
        error?: string;
      }>(`/api/tasks/${options.taskId}`);

      if (data.status === "completed" || data.status === "failed") {
        if (isJsonMode(options)) {
          printJson(data);
        } else {
          console.log(`Task ${data.task_id}: ${data.status}`);
          if (data.result_url) console.log(`Result: ${data.result_url}`);
          if (data.error) console.log(`Error:  ${data.error}`);
        }
        process.exit(data.status === "failed" ? 1 : 0);
      }

      if (!isJsonMode(options)) {
        process.stdout.write(".");
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }

    console.error("\nTimeout: task did not complete in time.");
    process.exit(1);
  });
