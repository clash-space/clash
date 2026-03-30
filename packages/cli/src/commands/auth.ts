import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { saveConfig, loadConfig, getApiKey, getServerUrl } from "../lib/config";

export const authCommand = new Command("auth")
  .description("Manage authentication");

authCommand
  .command("login")
  .description("Configure API key")
  .action(async () => {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const apiKey = await rl.question("Enter your Clash API key (clsh_...): ");
      if (!apiKey.startsWith("clsh_")) {
        console.error("Error: API key must start with 'clsh_'");
        process.exit(1);
      }
      const config = loadConfig();
      config.apiKey = apiKey.trim();
      saveConfig(config);
      console.log("API key saved to ~/.clash/config.json");
    } finally {
      rl.close();
    }
  });

authCommand
  .command("status")
  .description("Check authentication status")
  .action(async () => {
    const apiKey = getApiKey();
    const serverUrl = getServerUrl();

    if (!apiKey) {
      console.log("Not authenticated. Run `clash auth login`.");
      process.exit(1);
    }

    console.log(`API key: ${apiKey.slice(0, 13)}...`);
    console.log(`Server:  ${serverUrl}`);

    // Validate the token by hitting the projects endpoint
    try {
      const res = await fetch(`${serverUrl}/api/v1/projects`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        const data = await res.json() as { projects: unknown[] };
        console.log(`Status:  Authenticated (${data.projects.length} projects)`);
      } else if (res.status === 401) {
        console.log("Status:  Invalid token");
        process.exit(1);
      } else {
        console.log(`Status:  Server error (${res.status})`);
      }
    } catch (err) {
      console.log(`Status:  Cannot reach server at ${serverUrl}`);
    }
  });

authCommand
  .command("logout")
  .description("Remove saved API key")
  .action(() => {
    const config = loadConfig();
    delete config.apiKey;
    saveConfig(config);
    console.log("API key removed.");
  });
