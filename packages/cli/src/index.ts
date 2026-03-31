#!/usr/bin/env node

import { Command } from "commander";
import { authCommand } from "./commands/auth";
import { projectsCommand } from "./commands/projects";
import { canvasCommand } from "./commands/canvas";
import { tasksCommand } from "./commands/tasks";
import { actionsCommand } from "./commands/actions";
import { varsCommand } from "./commands/vars";

const program = new Command();

program
  .name("clash")
  .description("Clash CLI — AI video production from your terminal")
  .version("0.1.0");

program.addCommand(authCommand);
program.addCommand(projectsCommand);
program.addCommand(canvasCommand);
program.addCommand(tasksCommand);
program.addCommand(actionsCommand);
program.addCommand(varsCommand);

program.parse();
