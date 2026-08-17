import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { evaluateSubmission } from "../../../packages/shared-artifact-evals/src/evaluator.ts";
import { matchRequiredProductOperations } from "../../../packages/shared-artifact-evals/src/product-operations.ts";
import { captureRequiredProductReadback } from "../../../packages/shared-artifact-evals/src/runner.ts";
import { loadBenchmarkSuite } from "../../../packages/shared-artifact-evals/src/suite.ts";

async function main(): Promise<void> {
const workspace = resolve(process.env.CLASH_REGRESSION_WORKSPACE ?? "");
const tracePath = resolve(process.env.CLASH_REGRESSION_CLI_TRACE ?? "");
const outputRoot = resolve(process.env.CLASH_REGRESSION_EVIDENCE ?? "");
const apiUrl = process.env.CLASH_API_URL?.trim();
if (!workspace || !tracePath || !outputRoot || !apiUrl) {
  throw new Error("Regression verification environment is incomplete");
}

const suite = await loadBenchmarkSuite(
  resolve("benchmarks/creative-artifacts/v2/suite.json"),
);
const benchmark = suite.cases.find(
  ({ id }) => id === "mixed-premium-gadget-mini-review-v2",
);
if (!benchmark) throw new Error("Benchmark case is missing");
await mkdir(outputRoot, { recursive: true });

const evaluation = await evaluateSubmission({ benchmark, workspace });
const readback = await captureRequiredProductReadback({
  benchmark,
  workspace,
  caseRoot: outputRoot,
  ready: { projectId: "benchmark-content-effect-base-v1", apiUrl },
});
const successfulCliArgv = (await readFile(tracePath, "utf8"))
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Record<string, unknown>)
  .filter(
    (event) =>
      event.type === "clash.cli.completed" && event.exitCode === 0,
  )
  .map((event) => event.argv as string[]);
const operations = matchRequiredProductOperations({
  requiredProductOperations:
    benchmark.execution?.requiredProductOperations ?? [],
  successfulMcpTools: [],
  successfulCliArgv,
});
const summary = {
  schemaVersion: 1,
  kind: "deterministic-product-regression-verification",
  realAgentAttempt: false,
  benchmarkCaseId: benchmark.id,
  technicalEvaluation: {
    status: evaluation.status,
    score: evaluation.score,
    checks: evaluation.checks.map(({ id, status }) => ({ id, status })),
  },
  productOperations: {
    required: benchmark.execution?.requiredProductOperations ?? [],
    observed: operations.observedProductOperations,
    missing: operations.missingProductOperations,
  },
  productReadback: readback?.report,
};
await Promise.all([
  writeFile(
    resolve(outputRoot, "evaluation.json"),
    `${JSON.stringify(evaluation, null, 2)}\n`,
  ),
  writeFile(
    resolve(outputRoot, "verification-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  ),
]);
if (
  evaluation.status !== "pass" ||
  evaluation.score !== 100 ||
  operations.missingProductOperations.length > 0 ||
  readback?.report.status !== "pass"
) {
  throw new Error(`Regression verification failed: ${JSON.stringify(summary)}`);
}
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

void main();
