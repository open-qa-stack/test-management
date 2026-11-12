import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const packages = new URL("../../", import.meta.url);

/** The modules imported by the sources of a package, by file. */
function importsOf(sourceDir: string): Map<string, string[]> {
  const files = readdirSync(new URL(sourceDir, packages), { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"));
  return new Map(files.map((f) => [f, [...readFileSync(new URL(`${sourceDir}/${f}`, packages), "utf8").matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!)]));
}

function importers(sourceDir: string, modules: readonly string[]): string[] {
  return [...importsOf(sourceDir)].filter(([, imported]) => imported.some((m) => modules.includes(m))).map(([file]) => file);
}

describe("criterion 2 — the tools live outside the agent core", () => {
  it("keeps Playwright and PostgreSQL out of the harness, and the SDK and the harness out of the tools", () => {
    assert.deepEqual(importers("harness/src", ["playwright-core", "pg"]), []);
    assert.deepEqual(importers("tools/src", ["@github/copilot-sdk", "@open-qa-stack/harness"]), []);
    assert.ok(importers("tools/src", ["playwright-core"]).length > 0);
    assert.ok(importers("harness/src", ["@github/copilot-sdk"]).length > 0);
  });
});
