/**
 * Output formatting for CLI.
 * JSON mode when --json flag or stdout is not a TTY.
 */

export function isJsonMode(options: { json?: boolean }): boolean {
  return options.json === true || !process.stdout.isTTY;
}

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function printTable(
  rows: Record<string, unknown>[],
  columns: { key: string; label: string; width?: number }[]
): void {
  if (rows.length === 0) {
    console.log("(no results)");
    return;
  }

  // Header
  const header = columns
    .map((col) => col.label.padEnd(col.width ?? 20))
    .join("  ");
  console.log(header);
  console.log("-".repeat(header.length));

  // Rows
  for (const row of rows) {
    const line = columns
      .map((col) => {
        const val = String(row[col.key] ?? "");
        return val.slice(0, col.width ?? 20).padEnd(col.width ?? 20);
      })
      .join("  ");
    console.log(line);
  }
}
