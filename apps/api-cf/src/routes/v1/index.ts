import { Hono } from "hono";
import type { Env } from "../../config";
import { projectRoutes } from "./projects";

export const v1Routes = new Hono<{ Bindings: Env }>();

v1Routes.route("/projects", projectRoutes);

// Health check
v1Routes.get("/", (c) => c.json({ version: "v1", status: "ok" }));
