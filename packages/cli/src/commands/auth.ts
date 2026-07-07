import { Command } from "commander";
import { createServer } from "node:http";
import { configFilePath, saveConfig, loadConfig, getApiKey, getServerUrl } from "../lib/config";

export const authCommand = new Command("auth")
  .description(`Manage authentication

Get a token: Clash web app → avatar → Settings → API Tokens → Create
Or run: clash auth login (opens browser for OAuth)
Config stored at: $CLASH_HOME/config.json, or ~/.clash/config.json by default`);

authCommand
  .command("login")
  .description("Authenticate via browser (opens Clash web app)")
  .action(async () => {
    const serverUrl = getServerUrl();

    // Start temporary localhost server to receive callback
    const port = await new Promise<number>((resolve) => {
      const srv = createServer();
      srv.listen(0, () => {
        const addr = srv.address();
        const p = typeof addr === "object" && addr ? addr.port : 0;
        srv.close(() => resolve(p));
      });
    });

    const callbackUrl = `http://localhost:${port}/callback`;
    const authUrl = `${serverUrl}/auth/cli?redirect_uri=${encodeURIComponent(callbackUrl)}`;

    const server = createServer((req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${port}`);

      if (url.pathname === "/callback") {
        const token = url.searchParams.get("token");
        const error = url.searchParams.get("error");

        if (token && token.startsWith("clsh_")) {
          const config = loadConfig();
          config.apiKey = token;
          saveConfig(config);

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
                <div style="text-align: center;">
                  <h1>Authenticated!</h1>
                  <p>You can close this tab and return to the terminal.</p>
                </div>
              </body>
            </html>
          `);

          console.log("\nAuthenticated successfully!");
          console.log(`API key saved to ${configFilePath()}`);
          setTimeout(() => { server.close(); process.exit(0); }, 500);
        } else {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
                <div style="text-align: center;">
                  <h1>Authentication failed</h1>
                  <p>${error || "No token received"}</p>
                </div>
              </body>
            </html>
          `);

          console.error(`\nAuthentication failed: ${error || "No token received"}`);
          setTimeout(() => { server.close(); process.exit(1); }, 500);
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(port, () => {
      console.log(`Opening browser for authentication...`);
      console.log(`If the browser doesn't open, visit:\n  ${authUrl}\n`);
      console.log("Waiting for authentication...");

      // Open browser
      const { exec } = require("node:child_process");
      const openCmd = process.platform === "darwin" ? "open"
        : process.platform === "win32" ? "start"
        : "xdg-open";
      exec(`${openCmd} "${authUrl}"`);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      console.error("\nAuthentication timed out.");
      server.close();
      process.exit(1);
    }, 5 * 60 * 1000);
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
    } catch {
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
