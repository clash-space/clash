import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { renderTimeline } from "./render.js";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

app.post("/render", async (c) => {
  const { timelineDsl, projectId, taskId } = await c.req.json<{
    timelineDsl: Record<string, any>;
    projectId: string;
    taskId: string;
  }>();

  if (!timelineDsl?.tracks) {
    return c.json({ error: "Missing timelineDsl.tracks" }, 400);
  }

  console.log(`[render-server] Starting render: task=${taskId} project=${projectId} tracks=${timelineDsl.tracks.length}`);

  try {
    const buffer = await renderTimeline(timelineDsl, taskId);
    console.log(`[render-server] Render complete: task=${taskId} size=${buffer.byteLength} bytes`);

    return new Response(buffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": buffer.byteLength.toString(),
      },
    });
  } catch (e: any) {
    console.error(`[render-server] Render failed: task=${taskId}`, e);
    return c.json({ error: e.message }, 500);
  }
});

const port = parseInt(process.env.PORT || "8080", 10);
console.log(`[render-server] Listening on port ${port}`);
serve({ fetch: app.fetch, port });
