import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "vitest";

describe("the package of the command", () => {
  it("imports the engine, the store, the harness, the tools and the domain, no other package, and never the SDK of the agents", () => {
    const folder = new URL("../src/", import.meta.url);
    const imported = readdirSync(folder, { recursive: true })
      .filter((file) => String(file).endsWith(".ts"))
      .flatMap((file) => [...readFileSync(new URL(String(file), folder), "utf8").matchAll(/(?:from\s+|import\s*\(?\s*)"([^"]+)"/g)].map((match) => match[1]!));
    const allowed = /^(node:|\.\/|@open-qa-stack\/(engine|store|harness|tools|domain(\/sessions)?)$)/;
    assert.ok(imported.length > 0);
    assert.deepEqual(
      imported.filter((module) => !allowed.test(module)),
      [],
    );
    assert.ok(!imported.some((module) => module.includes("copilot")));
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
    assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
      "@open-qa-stack/domain",
      "@open-qa-stack/engine",
      "@open-qa-stack/harness",
      "@open-qa-stack/store",
      "@open-qa-stack/tools",
    ]);
  });
});
