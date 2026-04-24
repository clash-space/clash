import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./app/lib/db/migrations.schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  driver: "d1-http",
});
