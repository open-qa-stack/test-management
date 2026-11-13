import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFile, cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("..", import.meta.url));
const ROOT = join(APP, "../..");

async function scripts(dir: string): Promise<Record<string, string>> {
  return (JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
}

/**
 * Runs the build script of a copy of the console, outside the workspace, beside a copy of the base
 * TypeScript configuration it extends.
 *
 * @param broken - Whether to write a syntax error into a module of the copy first.
 * @returns The exit code of the build.
 */
async function buildCopy(broken: boolean): Promise<number | null> {
  const root = await mkdtemp(join(tmpdir(), "oqas-web-"));
  const copy = join(root, "apps/web");
  try {
    await cp(join(ROOT, "tsconfig.base.json"), join(root, "tsconfig.base.json"));
    await cp(APP, copy, { recursive: true, filter: (source) => !/[\\/](?:node_modules|dist)$/.test(source) });
    await symlink(join(APP, "node_modules"), join(copy, "node_modules"), "dir");
    if (broken) await appendFile(join(copy, "src/shell.tsx"), "\nexport const = ;\n");
    return spawnSync("pnpm", ["run", "--silent", "build"], { cwd: copy, stdio: "ignore" }).status;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("criterion 1 — the single check command builds the console with Vite, and fails if the build fails", () => {
  it("is the check of the workspace, which runs the build of every package before the tests", async () => {
    const root = await scripts(ROOT);
    assert.equal(root["build"], "pnpm -r --if-present build");
    assert.equal(root["check"], "node --disable-warning=ExperimentalWarning packages/check/src/main.ts");
  });

  it("builds the console with Vite", async () => {
    assert.equal((await scripts(APP))["build"], "vite build");
    assert.equal(await buildCopy(false), 0);
  });

  it("exits with an error when a module does not compile", async () => {
    assert.notEqual(await buildCopy(true), 0);
  });
});
