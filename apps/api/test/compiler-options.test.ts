import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const TSC = join(ROOT, "node_modules", ".bin", "tsc");

/** The compiler options TypeScript applies to a package, its inherited ones included. */
function effectiveOptions(project: string): Record<string, unknown> {
  const shown = execFileSync(TSC, ["--showConfig", "-p", join(ROOT, project, "tsconfig.json")], { encoding: "utf8" });
  return (JSON.parse(shown) as { compilerOptions: Record<string, unknown> }).compilerOptions;
}

describe("the decorator options of the compiler", () => {
  it("are enabled for the API, and for no other project of the workspace", () => {
    const projects = ["apps", "packages"]
      .flatMap((folder) => readdirSync(join(ROOT, folder)).map((name) => `${folder}/${name}`))
      .filter((project) => existsSync(join(ROOT, project, "tsconfig.json")));
    assert.ok(projects.includes("apps/api") && projects.includes("packages/domain") && projects.includes("apps/web"));
    for (const project of projects) {
      const options = effectiveOptions(project);
      const enabled = project === "apps/api";
      assert.equal(options["experimentalDecorators"] === true, enabled, project);
      assert.equal(options["emitDecoratorMetadata"] === true, enabled, project);
    }
  });
});
