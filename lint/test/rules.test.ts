import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { RuleTester } from "oxlint/plugins-dev";
import plugin from "../plugin.ts";
import { pureDomain } from "../pure-domain.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OXLINT = join(ROOT, "node_modules", ".bin", "oxlint");

describe("the plugin of the workspace", () => {
  it("names its rules under open-qa-stack", () => {
    assert.deepEqual(plugin, { meta: { name: "open-qa-stack" }, rules: { "pure-domain": pureDomain } });
  });
});

describe("the rule that keeps the domain pure", () => {
  const framework = (source: string) => ({ messageId: "framework", data: { source } });
  new RuleTester({ languageOptions: { sourceType: "module" } }).run("pure-domain", pureDomain, {
    valid: [
      { filename: "rule.ts", code: 'import { readFile } from "node:fs/promises";\nimport type { Verdict } from "./verdict.ts";' },
      { filename: "rule.ts", code: 'export { verdict } from "./verdict.ts";\nexport * from "./limits.ts";\nexport const limit = 3;' },
      { filename: "rule.ts", code: 'const module = await import("./verdict.ts");\nconst named = await import(name);' },
      { filename: "rule.ts", code: 'import { fastifyLike } from "fastify-like";\nimport { nest } from "nestjs";' },
      { filename: "rule.ts", code: 'export type Verdict = import("./verdict.ts").Verdict;' },
    ],
    invalid: [
      { filename: "rule.ts", code: 'import { Injectable } from "@nestjs/common";', errors: [framework("@nestjs/common")] },
      { filename: "rule.ts", code: 'import "reflect-metadata";', errors: [framework("reflect-metadata")] },
      { filename: "rule.ts", code: 'import type { FastifyInstance } from "fastify";', errors: [framework("fastify")] },
      { filename: "rule.ts", code: 'export { fastify } from "fastify";', errors: [framework("fastify")] },
      { filename: "rule.ts", code: 'export * from "@nestjs/core";', errors: [framework("@nestjs/core")] },
      { filename: "rule.ts", code: 'const core = await import("@nestjs/core");', errors: [framework("@nestjs/core")] },
      { filename: "rule.ts", code: 'import { types } from "fastify/types";', errors: [framework("fastify/types")] },
      { filename: "rule.ts", code: 'type App = import("@nestjs/common").INestApplication;', errors: [framework("@nestjs/common")] },
      { filename: "rule.ts", code: 'export type Reply = import("fastify").FastifyReply;', errors: [framework("fastify")] },
      { filename: "rule.ts", code: "@sealed\nexport class Limits {}", errors: [{ messageId: "decorator" }] },
      { filename: "rule.ts", code: "export class Limits {\n  @logged\n  check(): void {}\n}", errors: [{ messageId: "decorator" }] },
    ],
  });
});

describe("the lint configuration of the workspace", () => {
  const workspace = mkdtempSync(join(tmpdir(), "oqas-lint-"));
  after(() => rmSync(workspace, { recursive: true, force: true }));
  const configuration = JSON.parse(readFileSync(join(ROOT, ".oxlintrc.json"), "utf8")) as { $schema?: string; jsPlugins: string[] };
  delete configuration.$schema;
  configuration.jsPlugins = configuration.jsPlugins.map((path) => join(ROOT, path));
  writeFileSync(join(workspace, ".oxlintrc.json"), JSON.stringify(configuration));
  const files: Record<string, string> = {
    "packages/api/src/health/health.service.ts": 'export const mode = process.env["MODE"];\n',
    "packages/api/src/config/process-environment.ts": "export const environment = () => process.env;\n",
    "packages/api/test/startup.test.ts": 'export const coverage = process.env["NODE_V8_COVERAGE"];\n',
    "packages/api/test/support/environment.ts": "export const environment = process.env;\n",
    "packages/domain/src/test/limits.ts": 'import { Injectable } from "@nestjs/common";\n@Injectable()\nexport class Limits {}\n',
    "packages/harness/src/runner.ts": 'import "reflect-metadata";\nexport const home = process.env["HOME"];\n',
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(workspace, path)), { recursive: true });
    writeFileSync(join(workspace, path), content);
  }

  it("refuses process.env in the API outside its configuration module and its test support, and the framework in the domain only", async () => {
    const output = await new Promise<string>((resolve) =>
      execFile(OXLINT, ["--format", "json"], { cwd: workspace, encoding: "utf8" }, (_error, out) => resolve(out)),
    );
    const found = (JSON.parse(output) as { diagnostics: { code: string; filename: string }[] }).diagnostics.map(({ code, filename }) => `${filename} ${code}`);
    assert.deepEqual(found.sort(), [
      "packages/api/src/health/health.service.ts node(no-process-env)",
      "packages/api/test/startup.test.ts node(no-process-env)",
      "packages/domain/src/test/limits.ts open-qa-stack(pure-domain)",
      "packages/domain/src/test/limits.ts open-qa-stack(pure-domain)",
    ]);
  });
});
