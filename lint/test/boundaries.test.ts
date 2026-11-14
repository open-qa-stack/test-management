import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { join } from "node:path";
import { DemoWorkspace, lint, ROOT, type LintConfiguration } from "./demo-workspace.ts";

/** The nine packages of the product, by short name, and their folders. */
const PACKAGES = {
  domain: "packages/domain",
  shared: "packages/shared",
  api: "packages/api",
  harness: "packages/harness",
  tools: "packages/tools",
  agents: "packages/agents",
  worker: "packages/worker",
  cli: "packages/cli",
  web: "apps/web",
} as const;

type Short = keyof typeof PACKAGES;

/** The couples of packages the architecture allows, source first. */
const ALLOWED: readonly (readonly [Short, Short])[] = [
  ["api", "domain"],
  ["api", "shared"],
  ["harness", "domain"],
  ["harness", "shared"],
  ["tools", "domain"],
  ["tools", "shared"],
  ["agents", "domain"],
  ["agents", "shared"],
  ["agents", "tools"],
  ["worker", "harness"],
  ["worker", "agents"],
  ["worker", "tools"],
  ["worker", "domain"],
  ["worker", "shared"],
  ["cli", "shared"],
  ["cli", "harness"],
  ["cli", "agents"],
  ["cli", "tools"],
  ["cli", "domain"],
  ["web", "shared"],
];

const SHORTS = Object.keys(PACKAGES) as Short[];
const COUPLES = SHORTS.flatMap((source) => SHORTS.filter((target) => target !== source).map((target) => [source, target] as const));
const REFUSED = COUPLES.filter(([source, target]) => !ALLOWED.some(([s, t]) => s === source && t === target));

const name = (short: Short): string => `@open-qa-stack/${short}`;
/** The folder of the demonstration sources of a package; the solo mode for the command line. */
const sources = (short: Short): string => `${PACKAGES[short]}/src${short === "cli" ? "/solo" : ""}`;
const coupleFile = (source: Short, target: Short): string => `${sources(source)}/imports-${target}.ts`;
const byName = (target: Short): string => `// The package imported by its name.\nimport { value } from "${name(target)}";\nexport const used = value;\n`;
const allowedOf = (source: Short): string => {
  const allowed = ALLOWED.filter(([s]) => s === source).map(([, t]) => name(t));
  return allowed.length === 0 ? "none" : allowed.join(", ");
};
const forbidden = (file: string, line: number, source: string, target: string, allowed: string, rule = "package-boundaries", column = 1): string =>
  `${file}:${line}:${column}: ${source} may not import ${target}; among the packages of the workspace, it may import ${allowed}. [Error/open-qa-stack(${rule})]`;
const confined = (file: string, module = "@github/copilot-sdk", column = 1): string =>
  `${file}:1:${column}: ${file} may not import ${module}: only the files under packages/harness/src/copilot may. [Error/open-qa-stack(confined-imports)]`;

/** Lints a demonstration workspace once, and gives the diagnostics of each file. */
function linted(files: Readonly<Record<string, string>>, configure?: (configuration: LintConfiguration) => void): (file: string) => string[] {
  const workspace = new DemoWorkspace(files, configure);
  let diagnostics: string[] = [];
  before(async () => {
    diagnostics = await workspace.lint();
  });
  after(() => workspace.remove());
  return (file) => diagnostics.filter((line) => line.startsWith(`${file}:`));
}

describe("criterion 1 — the delivered code keeps to its boundaries", () => {
  it("lets the rules of the workspace find nothing in its sources", async () => {
    assert.deepEqual(
      (await lint(ROOT)).filter((line) => line.includes("/open-qa-stack(")),
      [],
    );
  });
  it("fails, rather than finds nothing, when the rules cannot run", async () => {
    const workspace = new DemoWorkspace({ "packages/domain/src/demo.ts": "export const demo = 1;\n" }, (configuration) => {
      configuration.jsPlugins = [join(ROOT, "lint", "missing-plugin.ts")];
    });
    after(() => workspace.remove());
    await assert.rejects(workspace.lint(), /^Error: oxlint failed without a diagnostic:/);
  });
});

describe("criterion 2 — each of the 52 couples out of the table is refused by package name", () => {
  const of = linted(Object.fromEntries(REFUSED.map(([source, target]) => [coupleFile(source, target), byName(target)])));
  it("counts 52 refused couples among the 72 of the nine packages", () => {
    assert.equal(COUPLES.length, 72);
    assert.equal(REFUSED.length, 52);
  });
  for (const [source, target] of REFUSED) {
    it(`refuses ${source} → ${target}, naming the file, the line, the source, the target and the rule`, () => {
      const file = coupleFile(source, target);
      assert.deepEqual(of(file), [forbidden(file, 2, name(source), name(target), allowedOf(source))]);
    });
  }
});

describe("criterion 3 — a refused couple is refused whatever the form of the import", () => {
  /** The code of each form, by the name of its file, and the line and the column where the import starts. */
  const forms: Readonly<Record<string, readonly [string, number, number]>> = {
    "subpath.ts": ['import { runner } from "@open-qa-stack/harness/runner";\nexport const used = runner;\n', 1, 1],
    "relative.ts": ['import { runner } from "../../../harness/src/index.ts";\nexport const used = runner;\n', 1, 1],
    "installed.ts": ['import { runner } from "../../node_modules/@open-qa-stack/harness/src/index.ts";\nexport const used = runner;\n', 1, 1],
    "dynamic.ts": ['export const harness = await import("@open-qa-stack/harness");\n', 1, 30],
    "template.ts": ["export const harness = await import(`@open-qa-stack/harness`);\n", 1, 30],
    "require.ts": [
      'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\nexport const harness = require("@open-qa-stack/harness");\n',
      3,
      24,
    ],
    "created-require.ts": [
      'import { createRequire } from "node:module";\nexport const harness = createRequire(import.meta.url)("@open-qa-stack/harness");\n',
      2,
      24,
    ],
    "import-equals.cts": ['import harness = require("@open-qa-stack/harness");\nexport = harness;\n', 1, 1],
    "type-only.ts": ['import type { Runner } from "@open-qa-stack/harness";\nexport type Used = Runner;\n', 1, 1],
    "type-query.ts": ['export type Runner = import("@open-qa-stack/harness").Runner;\n', 1, 22],
    "re-export.ts": ['export { runner } from "@open-qa-stack/harness";\n', 1, 1],
    "re-export-all.ts": ['export * from "@open-qa-stack/harness";\n', 1, 1],
  };
  const file = (form: string): string => `packages/api/src/forms/${form}`;
  const of = linted(Object.fromEntries(Object.entries(forms).map(([form, [code]]) => [file(form), code])));
  for (const [form, [, line, column]] of Object.entries(forms)) {
    it(`refuses api → harness by a ${form.slice(0, form.indexOf("."))} import`, () => {
      assert.deepEqual(of(file(form)), [forbidden(file(form), line, name("api"), name("harness"), allowedOf("api"), "package-boundaries", column)]);
    });
  }
});

describe("criterion 4 — each of the 20 couples of the table is accepted", () => {
  const of = linted(Object.fromEntries(ALLOWED.map(([source, target]) => [coupleFile(source, target), byName(target)])));
  for (const [source, target] of ALLOWED) {
    it(`accepts ${source} → ${target}`, () => {
      assert.deepEqual(of(coupleFile(source, target)), []);
    });
  }
});

describe("criterion 5 — the domain imports only the external modules its list allows", () => {
  const files = {
    "packages/domain/src/left-pad.ts": 'import leftPad from "left-pad";\nexport const pad = leftPad;\n',
    "packages/domain/src/file-system.ts": 'import { readFile } from "node:fs/promises";\nexport const read = readFile;\n',
    "packages/domain/src/schema.ts": 'import { z } from "zod/v4";\nexport const schema = z;\n',
  };
  const external = (file: string, target: string, allowed: string): string =>
    `${file}:1:1: @open-qa-stack/domain may not import ${target}; among the external modules, it may import ${allowed}. [Error/open-qa-stack(package-boundaries)]`;
  const delivered = linted(files);
  const demonstration = linted(files, (configuration) => {
    const overrides = configuration["overrides"] as { rules: Record<string, [string, { packages: Record<string, { external?: string[] }> }]> }[];
    const table = overrides.map(({ rules }) => rules["open-qa-stack/package-boundaries"]).find((rule) => rule !== undefined)!;
    table[1].packages["@open-qa-stack/domain"]!.external!.push("zod");
  });
  it("refuses an external module absent from the list, a module of Node.js included", () => {
    assert.deepEqual(delivered("packages/domain/src/left-pad.ts"), [external("packages/domain/src/left-pad.ts", "left-pad", "none")]);
    assert.deepEqual(delivered("packages/domain/src/file-system.ts"), [external("packages/domain/src/file-system.ts", "node:fs", "none")]);
    assert.deepEqual(delivered("packages/domain/src/schema.ts"), [external("packages/domain/src/schema.ts", "zod", "none")]);
  });
  it("accepts a module the demonstration configuration adds to the list, and refuses the others", () => {
    assert.deepEqual(demonstration("packages/domain/src/schema.ts"), []);
    assert.deepEqual(demonstration("packages/domain/src/left-pad.ts"), [external("packages/domain/src/left-pad.ts", "left-pad", "zod")]);
  });
});

describe("criterion 6 — the domain holds no decorator, whatever its kind", () => {
  const legacy = "packages/domain/src/legacy.ts";
  const standard = "packages/domain/src/standard.ts";
  const of = linted({
    [legacy]:
      'declare function inject(token: string): ParameterDecorator;\nexport class Limits {\n  constructor(@inject("budget") readonly budget: number) {}\n}\n',
    [standard]:
      "declare function tracked(value: undefined, context: ClassFieldDecoratorContext): void;\nexport class Counter {\n  @tracked accessor count = 0;\n}\n",
  });
  const decorator = (file: string, line: number, column: number): string =>
    `${file}:${line}:${column}: The domain holds no decorator: the API plugs the domain in through its providers. [Error/open-qa-stack(pure-domain)]`;
  it("refuses a decorator of the experimental TypeScript kind, on a parameter", () => {
    assert.deepEqual(of(legacy), [decorator(legacy, 3, 15)]);
  });
  it("refuses a standard decorator, on an accessor", () => {
    assert.deepEqual(of(standard), [decorator(standard, 3, 3)]);
  });
});

describe("criterion 7 — the SDK of the agents is imported by the implementation of the agent runtime only", () => {
  const sdk = 'import { CopilotClient } from "@github/copilot-sdk";\nexport const client = CopilotClient;\n';
  const refused = [
    "packages/harness/src/runner/session.ts",
    "packages/worker/src/session.ts",
    "packages/cli/src/solo/session.ts",
    "packages/api/src/session.ts",
  ];
  const implementation = "packages/harness/src/copilot/session.ts";
  const dynamic = "packages/worker/src/dynamic.ts";
  const installed = "packages/worker/src/installed.ts";
  const of = linted({
    ...Object.fromEntries([...refused, implementation].map((file) => [file, sdk])),
    [dynamic]: "export const sdk = await import(`@github/copilot-sdk`);\n",
    [installed]: 'import { CopilotClient } from "../node_modules/@github/copilot-sdk/dist/index.js";\nexport const client = CopilotClient;\n',
  });
  for (const file of refused) {
    it(`refuses it in ${file}`, () => {
      assert.deepEqual(of(file), [confined(file)]);
    });
  }
  it("refuses it by a dynamic import of a template literal, or by a path through the installed packages", () => {
    assert.deepEqual(of(dynamic), [confined(dynamic, "@github/copilot-sdk", 26)]);
    assert.deepEqual(of(installed), [confined(installed, "../node_modules/@github/copilot-sdk/dist/index.js")]);
  });
  it("accepts it under the folder its configuration declares", () => {
    assert.deepEqual(of(implementation), []);
  });
});

describe("criterion 8 — the connected mode of the command line imports only shared", () => {
  const connected = (file: string): string => `packages/cli/src/connected/${file}`;
  const solo = (file: string): string => `packages/cli/src/solo/${file}`;
  const refused = ["harness", "agents", "tools", "domain"] as const;
  const of = linted({
    ...Object.fromEntries(refused.map((target) => [connected(`${target}.ts`), byName(target)])),
    [connected("sdk.ts")]: 'import { CopilotClient } from "@github/copilot-sdk";\nexport const client = CopilotClient;\n',
    [connected("shared.ts")]: byName("shared"),
    [connected("solo.ts")]: 'import { soloCommand } from "../solo/solo-command.ts";\nexport const command = soloCommand;\n',
    [connected("installed.ts")]: 'import { runner } from "../../node_modules/@open-qa-stack/harness/src/index.ts";\nexport const used = runner;\n',
    ...Object.fromEntries(refused.map((target) => [solo(`${target}.ts`), byName(target)])),
  });
  it("is set by an override of the lint configuration on the folder of the connected mode", async () => {
    const configuration = (await import(join(ROOT, ".oxlintrc.json"), { with: { type: "json" } })) as { default: { overrides: { files: string[] }[] } };
    assert.ok(configuration.default.overrides.some(({ files }) => files.length === 1 && files[0] === "packages/cli/src/connected/**"));
  });
  for (const target of refused) {
    it(`refuses ${target} in connected/`, () => {
      const file = connected(`${target}.ts`);
      assert.deepEqual(of(file), [forbidden(file, 2, "packages/cli/src/connected", name(target), name("shared"), "folder-boundaries")]);
    });
  }
  it("refuses the SDK of the agents in connected/", () => {
    assert.deepEqual(of(connected("sdk.ts")), [confined(connected("sdk.ts"))]);
  });
  it("accepts shared in connected/", () => {
    assert.deepEqual(of(connected("shared.ts")), []);
  });
  it("refuses a file of solo/ imported by a relative path in connected/", () => {
    assert.deepEqual(of(connected("solo.ts")), [
      `${connected("solo.ts")}:1:1: packages/cli/src/connected may not import ${solo("solo-command.ts")} by a relative path that leaves its folder. [Error/open-qa-stack(folder-boundaries)]`,
    ]);
  });
  it("refuses harness reached by a path through the installed packages in connected/", () => {
    const file = connected("installed.ts");
    assert.deepEqual(of(file), [forbidden(file, 1, "packages/cli/src/connected", name("harness"), name("shared"), "folder-boundaries")]);
  });
  for (const target of refused) {
    it(`accepts ${target} in solo/`, () => {
      assert.deepEqual(of(solo(`${target}.ts`)), []);
    });
  }
});

describe("criterion 10 — the tests of the criteria run on demonstration files outside the packages of the product", () => {
  it("writes them in a temporary workspace, away from the repository", () => {
    const workspace = new DemoWorkspace({ "packages/domain/src/demo.ts": "export const demo = 1;\n" });
    after(() => workspace.remove());
    assert.ok(!workspace.root.startsWith(ROOT));
    assert.ok(!(workspace.root + "/").startsWith(join(ROOT, "packages")));
  });
});
