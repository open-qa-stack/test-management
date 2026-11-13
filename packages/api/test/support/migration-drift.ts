import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const PACKAGE = fileURLToPath(new URL("../../..", import.meta.url));
const DRIZZLE_KIT = join(PACKAGE, "node_modules", "drizzle-kit", "bin.cjs");

function journalTags(folder: string): string[] {
  const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
  return journal.entries.map((entry) => entry.tag);
}

/**
 * Generates, on a copy of the migrations, the migration that would bring them to the declared schema.
 *
 * @param schema - The module that declares the tables.
 * @param migrations - The folder of the versioned migrations.
 * @returns The tags of the migrations the generation added: none when the migrations match the schema.
 */
export async function migrationDrift(schema: string, migrations: string): Promise<string[]> {
  const copy = mkdtempSync(join(tmpdir(), "oqas-migrations-"));
  try {
    cpSync(migrations, copy, { recursive: true });
    await run(process.execPath, [DRIZZLE_KIT, "generate", "--dialect", "postgresql", "--schema", schema, "--out", copy], { cwd: PACKAGE });
    const versioned = new Set(journalTags(migrations));
    return journalTags(copy).filter((tag) => !versioned.has(tag));
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}
