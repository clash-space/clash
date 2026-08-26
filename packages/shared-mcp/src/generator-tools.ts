import { z } from "zod";
import {
  createGeneratorClient,
  type GeneratorRequest,
} from "@clash/shared-runtime/generator-client";
import { describeClashTool } from "./tool-guidance.js";
import type { ClashMcpServer } from "./server.js";

const jsonObject = z.record(z.string(), z.unknown());
const result = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  structuredContent: { result: value },
});

/** Register the native Generator HTTP leaves; the fixed clash_generators dispatcher discovers them automatically. */
export function registerGeneratorTools(
  server: ClashMcpServer,
  options: { request: GeneratorRequest },
): void {
  const client = createGeneratorClient(options.request);
  const tool = (
    name: string,
    title: string,
    useWhen: string,
    readOnly: boolean,
    inputSchema: Record<string, z.ZodType>,
    call: (args: Record<string, unknown>) => Promise<unknown>,
  ) => {
    server.registerTool(
      name,
      {
        title,
        description: describeClashTool({
          useWhen,
          effect:
            "calls the native generic Generator HTTP authority exactly once",
          returns: "the exact JSON response from the Generator API",
          next: "inspect the returned Generator, Revision, Action Run, or Output Commit",
        }),
        inputSchema,
        annotations: { readOnlyHint: readOnly, destructiveHint: false },
      },
      async (args) => result(await call(args as Record<string, unknown>)),
    );
  };
  tool(
    "clash_generators_definitions_list",
    "List GeneratorDefinitions",
    "registered GeneratorDefinitions must be discovered",
    true,
    {},
    () => client.listDefinitions(),
  );
  tool(
    "clash_generators_definition_get",
    "Read GeneratorDefinition",
    "one exact plugin GeneratorDefinition is needed",
    true,
    { pluginId: z.string().min(1), definitionId: z.string().min(1) },
    (a) => client.getDefinition(a.pluginId as string, a.definitionId as string),
  );
  tool(
    "clash_generators_create",
    "Create ProjectGenerator",
    "a ProjectGenerator and initial immutable Revision must be created",
    false,
    { projectId: z.string().min(1), input: jsonObject },
    (a) => client.createGenerator(a.projectId as string, a.input),
  );
  tool(
    "clash_generators_get",
    "Read ProjectGenerator",
    "a ProjectGenerator and head Revision must be read",
    true,
    { projectId: z.string().min(1), generatorId: z.string().min(1) },
    (a) => client.getGenerator(a.projectId as string, a.generatorId as string),
  );
  tool(
    "clash_generators_advance",
    "Advance ProjectGenerator",
    "a new immutable Revision must advance an observed ProjectGenerator head",
    false,
    {
      projectId: z.string().min(1),
      generatorId: z.string().min(1),
      input: jsonObject,
    },
    (a) =>
      client.advanceGenerator(
        a.projectId as string,
        a.generatorId as string,
        a.input,
      ),
  );
  tool(
    "clash_generators_action_run_submit",
    "Submit ActionRun",
    "a named Action must be submitted against an exact Generator Revision",
    false,
    {
      projectId: z.string().min(1),
      generatorId: z.string().min(1),
      actionId: z.string().min(1),
      input: jsonObject,
    },
    (a) =>
      client.submitActionRun(
        a.projectId as string,
        a.generatorId as string,
        a.actionId as string,
        a.input,
      ),
  );
  tool(
    "clash_generators_action_run_get",
    "Read ActionRun",
    "one native ActionRun state is needed",
    true,
    { projectId: z.string().min(1), actionRunId: z.string().min(1) },
    (a) => client.getActionRun(a.projectId as string, a.actionRunId as string),
  );
  tool(
    "clash_generators_output_commit_get",
    "Read OutputCommit",
    "the immutable output committed for an ActionRun slot is needed",
    true,
    {
      projectId: z.string().min(1),
      actionRunId: z.string().min(1),
      outputSlot: z.string().min(1),
    },
    (a) =>
      client.getOutputCommit(
        a.projectId as string,
        a.actionRunId as string,
        a.outputSlot as string,
      ),
  );
}
