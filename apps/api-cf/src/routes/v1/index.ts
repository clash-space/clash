import { Hono } from "hono";
import type { Env } from "../../config";
import { projectRoutes } from "./projects";
import { varsRoutes } from "./vars";
import { sessionRoutes } from "./sessions";
import { cliAuthRoutes } from "./cli-auth";

export const v1Routes = new Hono<{ Bindings: Env }>();

v1Routes.route("/projects", projectRoutes);
v1Routes.route("/vars", varsRoutes);
v1Routes.route("/sessions", sessionRoutes);
v1Routes.route("/cli-auth", cliAuthRoutes);

// Health check
v1Routes.get("/", (c) => c.json({ version: "v1", status: "ok" }));
