import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SDK_PYTHON_DIR = join(REPO_ROOT, "packages", "clash-sdk", "python");

test("disables an action that exits immediately instead of respawning it", async () => {
  const home = await mkdtemp(join(tmpdir(), "clash-actions-host-"));
  const previousHome = process.env.HOME;
  const previousActionsPython = process.env.CLASH_ACTIONS_PYTHON;
  const previousPath = process.env.PATH;
  const countFile = join(home, "count.txt");
  const fakeBinDir = join(home, "bin");

  process.env.HOME = home;
  process.env.ACTION_COUNT_FILE = countFile;

  try {
    await mkdir(fakeBinDir, { recursive: true });
    const fakePython = join(fakeBinDir, "python");
    await writeFile(
      fakePython,
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"-c\" ]; then exit 0; fi",
        "if [ \"$1\" = \"-m\" ] && [ \"$2\" = \"pip\" ]; then exit 0; fi",
        "case \"$1\" in",
        "  */handler.py) printf x >> \"$ACTION_COUNT_FILE\"; exit 1 ;;",
        "esac",
        "exec python3 \"$@\"",
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakePython, 0o755);
    process.env.CLASH_ACTIONS_PYTHON = fakePython;

    const actionDir = join(home, ".clash", "actions", "broken-action");
    await mkdir(actionDir, { recursive: true });
    await writeFile(
      join(actionDir, "manifest.json"),
      JSON.stringify({ id: "broken-action", name: "Broken Action", runtime: "local" }),
      "utf8",
    );
    await writeFile(
      join(actionDir, "handler.py"),
      [
        "import os",
        "from pathlib import Path",
        "p = Path(os.environ['ACTION_COUNT_FILE'])",
        "p.write_text((p.read_text() if p.exists() else '') + 'x')",
        "raise SystemExit(1)",
        "",
      ].join("\n"),
      "utf8",
    );

    const { CliActionsHost } = await import("./actions-host");
    const host = new CliActionsHost({
      serverUrl: "http://127.0.0.1:49321",
      apiKey: "local-test-key",
      runtimeId: "runtime-test",
    });

    await host.start();
    await new Promise((resolve) => setTimeout(resolve, 1_400));
    await host.stopAll();

    const launches = await readFile(countFile, "utf8");
    assert.equal(launches, "x");
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousActionsPython === undefined) delete process.env.CLASH_ACTIONS_PYTHON;
    else process.env.CLASH_ACTIONS_PYTHON = previousActionsPython;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    delete process.env.ACTION_COUNT_FILE;
    await rm(home, { recursive: true, force: true });
  }
});

test("uses a managed Python venv and installs SDK plus action requirements", async () => {
  const home = await mkdtemp(join(tmpdir(), "clash-actions-host-"));
  const previousHome = process.env.HOME;
  const previousPath = process.env.PATH;
  const previousActionsPython = process.env.CLASH_ACTIONS_PYTHON;
  const previousActionsVenv = process.env.CLASH_ACTIONS_VENV;
  const previousLogFile = process.env.ACTION_LOG_FILE;
  const logFile = join(home, "python.log");
  const fakeBinDir = join(home, "bin");
  const venvDir = join(home, "actions-venv");

  process.env.HOME = home;
  process.env.PATH = `${fakeBinDir}:${previousPath ?? ""}`;
  process.env.CLASH_ACTIONS_VENV = venvDir;
  process.env.ACTION_LOG_FILE = logFile;
  delete process.env.CLASH_ACTIONS_PYTHON;

  try {
    await mkdir(fakeBinDir, { recursive: true });
    const fakePython = join(fakeBinDir, "python3");
    await writeFile(
      fakePython,
      [
        "#!/bin/sh",
        "echo \"python3 $@\" >> \"$ACTION_LOG_FILE\"",
        "if [ \"$1\" = \"-m\" ] && [ \"$2\" = \"venv\" ]; then",
        "  mkdir -p \"$3/bin\"",
        "  cat > \"$3/bin/python\" <<'PY'",
        "#!/bin/sh",
        "echo \"venv-python $@\" >> \"$ACTION_LOG_FILE\"",
        "if [ \"$1\" = \"-m\" ] && [ \"$2\" = \"pip\" ]; then exit 0; fi",
        "if [ \"$1\" = \"-c\" ]; then exit 0; fi",
        "exit 1",
        "PY",
        "  chmod +x \"$3/bin/python\"",
        "  exit 0",
        "fi",
        "exit 1",
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakePython, 0o755);

    const actionDir = join(home, ".clash", "actions", "needs-deps");
    await mkdir(actionDir, { recursive: true });
    await writeFile(
      join(actionDir, "manifest.json"),
      JSON.stringify({ id: "needs-deps", name: "Needs Deps", runtime: "local" }),
      "utf8",
    );
    await writeFile(join(actionDir, "handler.py"), "raise SystemExit(1)\n", "utf8");
    await writeFile(join(actionDir, "requirements.txt"), "Pillow>=10\n", "utf8");

    const { CliActionsHost } = await import("./actions-host");
    const host = new CliActionsHost({
      serverUrl: "http://127.0.0.1:49321",
      apiKey: "local-test-key",
      runtimeId: "runtime-test",
    });

    await host.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await host.stopAll();

    const log = await readFile(logFile, "utf8");
    assert.match(log, new RegExp(`python3 -m venv ${escapeRegExp(venvDir)}`));
    assert.match(log, /venv-python -m pip install -e .*packages\/clash-sdk\/python/);
    assert.match(log, /venv-python -c import clash_sdk; import aiohttp/);
    assert.match(log, new RegExp(`venv-python -m pip install -r ${escapeRegExp(join(actionDir, "requirements.txt"))}`));
    assert.match(log, new RegExp(`venv-python ${escapeRegExp(join(actionDir, "handler.py"))}`));
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousActionsPython === undefined) delete process.env.CLASH_ACTIONS_PYTHON;
    else process.env.CLASH_ACTIONS_PYTHON = previousActionsPython;
    if (previousActionsVenv === undefined) delete process.env.CLASH_ACTIONS_VENV;
    else process.env.CLASH_ACTIONS_VENV = previousActionsVenv;
    if (previousLogFile === undefined) delete process.env.ACTION_LOG_FILE;
    else process.env.ACTION_LOG_FILE = previousLogFile;
    await rm(home, { recursive: true, force: true });
  }
});

test("repairs a stamped managed venv when SDK runtime imports are missing", async () => {
  const home = await mkdtemp(join(tmpdir(), "clash-actions-host-"));
  const previousHome = process.env.HOME;
  const previousActionsPython = process.env.CLASH_ACTIONS_PYTHON;
  const previousActionsVenv = process.env.CLASH_ACTIONS_VENV;
  const previousLogFile = process.env.ACTION_LOG_FILE;
  const previousImportOk = process.env.ACTION_IMPORT_OK;
  const logFile = join(home, "python.log");
  const importOkFile = join(home, "import-ok");
  const venvDir = join(home, "actions-venv");

  process.env.HOME = home;
  process.env.CLASH_ACTIONS_VENV = venvDir;
  process.env.ACTION_LOG_FILE = logFile;
  process.env.ACTION_IMPORT_OK = importOkFile;
  delete process.env.CLASH_ACTIONS_PYTHON;

  try {
    await mkdir(join(venvDir, "bin"), { recursive: true });
    const fakePython = join(venvDir, "bin", "python");
    await writeFile(
      fakePython,
      [
        "#!/bin/sh",
        "echo \"venv-python $@\" >> \"$ACTION_LOG_FILE\"",
        "if [ \"$1\" = \"-c\" ]; then",
        "  test -f \"$ACTION_IMPORT_OK\"",
        "  exit $?",
        "fi",
        "if [ \"$1\" = \"-m\" ] && [ \"$2\" = \"pip\" ] && [ \"$3\" = \"install\" ]; then",
        "  touch \"$ACTION_IMPORT_OK\"",
        "  exit 0",
        "fi",
        "exit 1",
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakePython, 0o755);

    await writeFile(
      join(venvDir, ".clash-python-deps.json"),
      JSON.stringify({ sdk: `${SDK_PYTHON_DIR}:${await fileVersionKey(join(SDK_PYTHON_DIR, "pyproject.toml"))}` }),
      "utf8",
    );

    const actionDir = join(home, ".clash", "actions", "stale-venv");
    await mkdir(actionDir, { recursive: true });
    await writeFile(
      join(actionDir, "manifest.json"),
      JSON.stringify({ id: "stale-venv", name: "Stale Venv", runtime: "local" }),
      "utf8",
    );
    await writeFile(join(actionDir, "handler.py"), "raise SystemExit(1)\n", "utf8");

    const { CliActionsHost } = await import("./actions-host");
    const host = new CliActionsHost({
      serverUrl: "http://127.0.0.1:49321",
      apiKey: "local-test-key",
      runtimeId: "runtime-test",
    });

    await host.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await host.stopAll();

    const log = await readFile(logFile, "utf8");
    assert.match(log, /venv-python -c import clash_sdk; import aiohttp/);
    assert.match(log, /venv-python -m pip install -e .*packages\/clash-sdk\/python/);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousActionsPython === undefined) delete process.env.CLASH_ACTIONS_PYTHON;
    else process.env.CLASH_ACTIONS_PYTHON = previousActionsPython;
    if (previousActionsVenv === undefined) delete process.env.CLASH_ACTIONS_VENV;
    else process.env.CLASH_ACTIONS_VENV = previousActionsVenv;
    if (previousLogFile === undefined) delete process.env.ACTION_LOG_FILE;
    else process.env.ACTION_LOG_FILE = previousLogFile;
    if (previousImportOk === undefined) delete process.env.ACTION_IMPORT_OK;
    else process.env.ACTION_IMPORT_OK = previousImportOk;
    await rm(home, { recursive: true, force: true });
  }
});

test("explicit CLASH_ACTIONS_PYTHON also gets SDK and action requirements prepared", async () => {
  const home = await mkdtemp(join(tmpdir(), "clash-actions-host-"));
  const previousHome = process.env.HOME;
  const previousActionsPython = process.env.CLASH_ACTIONS_PYTHON;
  const previousActionsVenv = process.env.CLASH_ACTIONS_VENV;
  const previousLogFile = process.env.ACTION_LOG_FILE;
  const previousImportOk = process.env.ACTION_IMPORT_OK;
  const logFile = join(home, "python.log");
  const importOkFile = join(home, "import-ok");
  const fakePython = join(home, "explicit-python");

  process.env.HOME = home;
  process.env.CLASH_ACTIONS_PYTHON = fakePython;
  process.env.ACTION_LOG_FILE = logFile;
  process.env.ACTION_IMPORT_OK = importOkFile;
  delete process.env.CLASH_ACTIONS_VENV;

  try {
    await writeFile(
      fakePython,
      [
        "#!/bin/sh",
        "echo \"explicit-python $@\" >> \"$ACTION_LOG_FILE\"",
        "if [ \"$1\" = \"-c\" ]; then",
        "  test -f \"$ACTION_IMPORT_OK\"",
        "  exit $?",
        "fi",
        "if [ \"$1\" = \"-m\" ] && [ \"$2\" = \"pip\" ] && [ \"$3\" = \"install\" ]; then",
        "  touch \"$ACTION_IMPORT_OK\"",
        "  exit 0",
        "fi",
        "exit 1",
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(fakePython, 0o755);

    const actionDir = join(home, ".clash", "actions", "explicit-python-action");
    await mkdir(actionDir, { recursive: true });
    await writeFile(
      join(actionDir, "manifest.json"),
      JSON.stringify({ id: "explicit-python-action", name: "Explicit Python", runtime: "local" }),
      "utf8",
    );
    await writeFile(join(actionDir, "handler.py"), "raise SystemExit(1)\n", "utf8");
    await writeFile(join(actionDir, "requirements.txt"), "Pillow>=10\n", "utf8");

    const { CliActionsHost } = await import("./actions-host");
    const host = new CliActionsHost({
      serverUrl: "http://127.0.0.1:49321",
      apiKey: "local-test-key",
      runtimeId: "runtime-test",
    });

    await host.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await host.stopAll();

    const log = await readFile(logFile, "utf8");
    assert.match(log, /explicit-python -m pip install -e .*packages\/clash-sdk\/python/);
    assert.match(log, new RegExp(`explicit-python -m pip install -r ${escapeRegExp(join(actionDir, "requirements.txt"))}`));
    assert.match(log, /explicit-python -c import clash_sdk; import aiohttp/);
    assert.match(log, new RegExp(`explicit-python ${escapeRegExp(join(actionDir, "handler.py"))}`));
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousActionsPython === undefined) delete process.env.CLASH_ACTIONS_PYTHON;
    else process.env.CLASH_ACTIONS_PYTHON = previousActionsPython;
    if (previousActionsVenv === undefined) delete process.env.CLASH_ACTIONS_VENV;
    else process.env.CLASH_ACTIONS_VENV = previousActionsVenv;
    if (previousLogFile === undefined) delete process.env.ACTION_LOG_FILE;
    else process.env.ACTION_LOG_FILE = previousLogFile;
    if (previousImportOk === undefined) delete process.env.ACTION_IMPORT_OK;
    else process.env.ACTION_IMPORT_OK = previousImportOk;
    await rm(home, { recursive: true, force: true });
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fileVersionKey(path: string): Promise<string> {
  const s = await stat(path);
  return `${s.size}:${Math.round(s.mtimeMs)}`;
}
