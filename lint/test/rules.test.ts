import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";
import { confinedImports } from "../confined-imports.ts";
import { folderBoundaries } from "../folder-boundaries.ts";
import { ManifestCheck } from "../manifest-check.ts";
import { packageBoundaries } from "../package-boundaries.ts";
import plugin from "../plugin.ts";
import { pureDomain } from "../pure-domain.ts";
import { DemoWorkspace } from "./demo-workspace.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const CWD = "/workspace";
const tester = new RuleTester({ languageOptions: { sourceType: "module" }, cwd: CWD });
const at = (path: string): string => `${CWD}/${path}`;

describe("the plugin of the workspace", () => {
  it("names its rules under open-qa-stack", () => {
    assert.deepEqual(plugin, {
      meta: { name: "open-qa-stack" },
      rules: { "confined-imports": confinedImports, "folder-boundaries": folderBoundaries, "package-boundaries": packageBoundaries, "pure-domain": pureDomain },
    });
  });
});

describe("the rule that keeps each package within its table", () => {
  const options = [
    {
      packages: {
        "@open-qa-stack/domain": { directory: "packages/domain", dependsOn: [], external: ["zod"] },
        "@open-qa-stack/api": { directory: "packages/api", dependsOn: ["@open-qa-stack/domain"] },
      },
    },
  ];
  const api = at("packages/api/src/rule.ts");
  const domain = at("packages/domain/src/rule.ts");
  const refused = (messageId: string, source: string, target: string, allowed: string) => ({ messageId, data: { source, target, allowed } });
  tester.run("package-boundaries", packageBoundaries, {
    valid: [
      { filename: at("packages/check/src/rule.ts"), options, code: 'import { api } from "@open-qa-stack/api";' },
      { filename: api, options, code: 'import { rule } from "@open-qa-stack/domain/rules";\nimport pg from "pg";\nimport { local } from "./local.ts";' },
      { filename: api, options, code: 'export const self = await import("@open-qa-stack/api");\nexport const named = await import(name);' },
      { filename: api, options, code: 'export const limit = 3;\nexport { limit as max };\nexport type Rule = import("../test/rule.ts").Rule;' },
      { filename: domain, options, code: 'import { z } from "zod";\nimport { object } from "zod/v4";\nimport { string } from "../node_modules/zod/index.js";' },
      {
        filename: api,
        options,
        code: [
          "export const named = await import(`@open-qa-stack/${name}`);",
          'export const loaded = require(name, "@open-qa-stack/testing");',
          "export const none = require();",
          'export const other = load("@open-qa-stack/testing");',
          'export const settled = Promise.resolve("@open-qa-stack/testing");',
          'export const member = module.require("@open-qa-stack/testing");',
          'export const created = factory(import.meta.url)("@open-qa-stack/testing");',
          'export const called = loaders()("@open-qa-stack/testing");',
          "import Rules = Domain.Rules;",
        ].join("\n"),
      },
    ],
    invalid: [
      {
        filename: api,
        options,
        code: 'import { answer } from "@open-qa-stack/testing";',
        errors: [refused("forbidden", "@open-qa-stack/api", "@open-qa-stack/testing", "@open-qa-stack/domain")],
      },
      {
        filename: api,
        options,
        code: 'import { rule } from "../../domain/src/rule.ts";',
        errors: [refused("relative", "@open-qa-stack/api", "@open-qa-stack/domain", "@open-qa-stack/domain")],
      },
      {
        filename: api,
        options,
        code: 'export * from "../../testing/src/index.ts";\nexport { other } from "/elsewhere/other.ts";',
        errors: [
          refused("relative", "@open-qa-stack/api", "packages/testing/src/index.ts", "@open-qa-stack/domain"),
          refused("relative", "@open-qa-stack/api", "../elsewhere/other.ts", "@open-qa-stack/domain"),
        ],
      },
      {
        filename: domain,
        options,
        code: 'import type { Api } from "@open-qa-stack/api";\nconst rule = await import("../../api/src/rule.ts");',
        errors: [
          refused("forbidden", "@open-qa-stack/domain", "@open-qa-stack/api", "none"),
          refused("forbidden", "@open-qa-stack/domain", "@open-qa-stack/api", "none"),
        ],
      },
      {
        filename: api,
        options,
        code: [
          "export const template = await import(`@open-qa-stack/testing`);",
          'export const required = require("@open-qa-stack/testing");',
          "export const resolved = require.resolve(`@open-qa-stack/testing/package.json`);",
          'export const created = createRequire(import.meta.url)("@open-qa-stack/testing");',
          'export const located = createRequire(import.meta.url).resolve("@open-qa-stack/testing");',
          'import testing = require("@open-qa-stack/testing");',
          'import { answer } from "../node_modules/@open-qa-stack/testing/src/index.ts";',
        ].join("\n"),
        errors: Array.from({ length: 7 }, () => refused("forbidden", "@open-qa-stack/api", "@open-qa-stack/testing", "@open-qa-stack/domain")),
      },
      {
        filename: domain,
        options,
        code: 'import leftPad from "left-pad";\nimport { parse } from "@scope/parser/strict";\nimport { pad } from "../../../node_modules/left-pad/index.js";',
        errors: [
          refused("external", "@open-qa-stack/domain", "left-pad", "zod"),
          refused("external", "@open-qa-stack/domain", "@scope/parser", "zod"),
          refused("external", "@open-qa-stack/domain", "left-pad", "zod"),
        ],
      },
    ],
  });
});

describe("the rule that keeps a folder to fewer packages than its package", () => {
  const options = [{ directory: "packages/cli/src/connected", dependsOn: ["@open-qa-stack/shared"] }];
  const connected = at("packages/cli/src/connected/rule.ts");
  tester.run("folder-boundaries", folderBoundaries, {
    valid: [
      { filename: at("packages/cli/src/solo/rule.ts"), options, code: 'import { run } from "@open-qa-stack/harness";\nimport { a } from "../connected/a.ts";' },
      {
        filename: connected,
        options,
        code: 'import { config } from "@open-qa-stack/shared";\nimport { local } from "./local.ts";\nimport { fetch } from "undici";',
      },
    ],
    invalid: [
      {
        filename: connected,
        options,
        code: 'import { run } from "@open-qa-stack/harness";\nimport { solo } from "../solo/solo.ts";\nimport { runner } from "../../node_modules/@open-qa-stack/harness/src/index.ts";',
        errors: [
          { messageId: "forbidden", data: { source: "packages/cli/src/connected", target: "@open-qa-stack/harness", allowed: "@open-qa-stack/shared" } },
          { messageId: "relative", data: { source: "packages/cli/src/connected", target: "packages/cli/src/solo/solo.ts", allowed: "@open-qa-stack/shared" } },
          { messageId: "forbidden", data: { source: "packages/cli/src/connected", target: "@open-qa-stack/harness", allowed: "@open-qa-stack/shared" } },
        ],
      },
    ],
  });
});

describe("the rule that confines a package to one folder", () => {
  const options = [{ modules: { "@github/copilot-sdk": "packages/harness/src/copilot" } }];
  const confined = (file: string, module: string) => ({ messageId: "confined", data: { file, module, directory: "packages/harness/src/copilot" } });
  tester.run("confined-imports", confinedImports, {
    valid: [
      {
        filename: at("packages/harness/src/copilot/runtime.ts"),
        options,
        code: 'import { CopilotClient } from "@github/copilot-sdk";\nimport type { Hooks } from "@github/copilot-sdk/hooks";',
      },
      {
        filename: at("packages/api/src/store.ts"),
        options,
        code: 'import pg from "pg";\nimport { local } from "./copilot-sdk.ts";\nimport { pool } from "../node_modules/pg/lib/index.js";',
      },
    ],
    invalid: [
      {
        filename: at("packages/api/src/agent.ts"),
        options,
        code: 'import { CopilotClient } from "@github/copilot-sdk";',
        errors: [confined("packages/api/src/agent.ts", "@github/copilot-sdk")],
      },
      {
        filename: at("packages/harness/test/hooks.test.ts"),
        options,
        code: 'export type Hooks = import("@github/copilot-sdk/hooks").Hooks;',
        errors: [confined("packages/harness/test/hooks.test.ts", "@github/copilot-sdk/hooks")],
      },
      {
        filename: at("packages/worker/src/agent.ts"),
        options,
        code: 'export const sdk = await import(`@github/copilot-sdk`);\nimport { CopilotClient } from "../node_modules/@github/copilot-sdk/dist/index.js";',
        errors: [
          confined("packages/worker/src/agent.ts", "@github/copilot-sdk"),
          confined("packages/worker/src/agent.ts", "../node_modules/@github/copilot-sdk/dist/index.js"),
        ],
      },
    ],
  });
});

describe("the rule that keeps decorators out of the domain", () => {
  tester.run("pure-domain", pureDomain, {
    valid: [{ filename: "rule.ts", code: "export class Limits {\n  check(): void {}\n}" }],
    invalid: [
      { filename: "rule.ts", code: "@sealed\nexport class Limits {}", errors: [{ messageId: "decorator" }] },
      { filename: "rule.ts", code: "export class Limits {\n  @logged\n  check(): void {}\n}", errors: [{ messageId: "decorator" }] },
      { filename: "rule.ts", code: "export class Limits {\n  constructor(@inject() readonly budget: number) {}\n}", errors: [{ messageId: "decorator" }] },
    ],
  });
});

describe("the check of the manifests", () => {
  const workspace = new DemoWorkspace({
    "packages/domain/package.json": JSON.stringify({ name: "@open-qa-stack/domain", peerDependencies: { "@open-qa-stack/shared": "workspace:*" } }),
    "packages/shared/package.json": JSON.stringify({ name: "@open-qa-stack/shared" }),
  });
  const unset = new DemoWorkspace({}, (configuration) => {
    delete configuration["overrides"];
  });
  after(() => {
    workspace.remove();
    unset.remove();
  });

  it("names each refused dependency of the workspace a manifest declares", async () => {
    assert.deepEqual(await (await ManifestCheck.of(workspace.root)).violations(), [
      "packages/domain/package.json:1: @open-qa-stack/domain may not import @open-qa-stack/shared; among the packages of the workspace, it may import none. (peerDependencies) [open-qa-stack/package-boundaries]",
    ]);
  });
  it("refuses a lint configuration that does not set the rule with its table", async () => {
    await assert.rejects(ManifestCheck.of(unset.root), new Error(".oxlintrc.json does not set open-qa-stack/package-boundaries with its table of packages."));
  });
});

describe("the lint configuration of the workspace", () => {
  const workspace = new DemoWorkspace({
    "packages/api/src/health/health.service.ts": 'export const mode = process.env["MODE"];\n',
    "packages/api/src/config/process-environment.ts": "export const environment = () => process.env;\n",
    "packages/api/test/startup.test.ts": 'export const coverage = process.env["NODE_V8_COVERAGE"];\n',
    "packages/api/test/support/environment.ts": "export const environment = process.env;\n",
    "packages/domain/src/test/limits.ts": "@Injectable()\nexport class Limits {}\n",
    "packages/domain/test/limits.test.ts": "@Injectable()\nexport class Fixture {}\n",
    "packages/harness/src/runner.ts": 'import "reflect-metadata";\nexport const home = process.env["HOME"];\n',
  });
  after(() => workspace.remove());

  it("refuses process.env in the API outside its configuration module and its test support, and decorators in the sources of the domain only", async () => {
    assert.deepEqual((await workspace.lint()).map((line) => `${line.split(":")[0]} ${line.slice(line.lastIndexOf("/") + 1, -1)}`).sort(), [
      "packages/api/src/health/health.service.ts node(no-process-env)",
      "packages/api/test/startup.test.ts node(no-process-env)",
      "packages/domain/src/test/limits.ts open-qa-stack(pure-domain)",
    ]);
  });
});
