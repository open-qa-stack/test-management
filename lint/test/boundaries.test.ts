import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import { join } from "node:path";
import { ManifestCheck } from "../manifest-check.ts";
import { DemoWorkspace, lint, ROOT, type LintConfiguration } from "./demo-workspace.ts";

/** The nine packages of the product, by short name, and their folders. */
const PACKAGES = {
  domain: "packages/domain",
  store: "packages/store",
  api: "apps/api",
  harness: "packages/harness",
  tools: "packages/tools",
  agents: "packages/agents",
  engine: "packages/engine",
  cli: "apps/cli",
  web: "apps/web",
} as const;

type Short = keyof typeof PACKAGES;

/** The couples of packages the architecture allows, source first. */
const ALLOWED: readonly (readonly [Short, Short])[] = [
  ["store", "domain"],
  ["api", "engine"],
  ["api", "store"],
  ["api", "domain"],
  ["harness", "domain"],
  ["tools", "domain"],
  ["agents", "domain"],
  ["agents", "tools"],
  ["engine", "harness"],
  ["engine", "agents"],
  ["engine", "tools"],
  ["engine", "domain"],
  ["cli", "api"],
  ["cli", "web"],
  ["cli", "engine"],
  ["cli", "store"],
  ["cli", "harness"],
  ["cli", "tools"],
  ["cli", "domain"],
  ["web", "domain"],
];

const SHORTS = Object.keys(PACKAGES) as Short[];
const COUPLES = SHORTS.flatMap((source) => SHORTS.filter((target) => target !== source).map((target) => [source, target] as const));
const REFUSED = COUPLES.filter(([source, target]) => !ALLOWED.some(([s, t]) => s === source && t === target));

const name = (short: Short): string => `@open-qa-stack/${short}`;
/** The folder of the demonstration sources of a package; the command line has them at its root. */
const sources = (short: Short): string => `${PACKAGES[short]}/src`;
const coupleFile = (source: Short, target: Short): string => `${sources(source)}/imports-${target}.ts`;
/** The entry of a package a source imports: the web console reads the domain by its contract of sessions only. */
const entry = (source: Short, target: Short): string => `${name(target)}${source === "web" && target === "domain" ? "/sessions" : ""}`;
const byName = (specifier: string): string => `// The package imported by its name.\nimport { value } from "${specifier}";\nexport const used = value;\n`;
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
  beforeAll(async () => {
    diagnostics = await workspace.lint();
  });
  afterAll(() => workspace.remove());
  return (file) => diagnostics.filter((line) => line.startsWith(`${file}:`));
}

describe("criterion 1 — the delivered code keeps to its boundaries", () => {
  it("lets the rules of the workspace find nothing in its sources, and the check of the manifests pass", async () => {
    assert.deepEqual(
      (await lint(ROOT)).filter((line) => line.includes("/open-qa-stack(")),
      [],
    );
    assert.deepEqual(await (await ManifestCheck.of(ROOT)).violations(), []);
  });
  it("fails, rather than finds nothing, when the rules cannot run", async () => {
    const workspace = new DemoWorkspace({ "packages/domain/src/demo.ts": "export const demo = 1;\n" }, (configuration) => {
      configuration.jsPlugins = [join(ROOT, "lint", "missing-plugin.ts")];
    });
    afterAll(() => workspace.remove());
    await assert.rejects(workspace.lint(), /^Error: oxlint failed without a diagnostic:/);
  });
});

describe("criterion 2 — each of the 52 couples out of the table is refused by package name", () => {
  const of = linted(Object.fromEntries(REFUSED.map(([source, target]) => [coupleFile(source, target), byName(name(target))])));
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
    "relative.ts": ['import { runner } from "../../../../packages/harness/src/index.ts";\nexport const used = runner;\n', 1, 1],
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
  const file = (form: string): string => `apps/api/src/forms/${form}`;
  const of = linted(Object.fromEntries(Object.entries(forms).map(([form, [code]]) => [file(form), code])));
  for (const [form, [, line, column]] of Object.entries(forms)) {
    it(`refuses api → harness by a ${form.slice(0, form.indexOf("."))} import`, () => {
      assert.deepEqual(of(file(form)), [forbidden(file(form), line, name("api"), name("harness"), allowedOf("api"), "package-boundaries", column)]);
    });
  }
});

describe("criterion 4 — each of the 23 couples of the table is accepted", () => {
  const of = linted(Object.fromEntries(ALLOWED.map(([source, target]) => [coupleFile(source, target), byName(entry(source, target))])));
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
    "packages/domain/src/validation.ts":
      'import { posix } from "node:path";\nimport { Ajv2020 } from "ajv/dist/2020.js";\nexport const used = [posix, Ajv2020];\n',
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
    assert.deepEqual(delivered("packages/domain/src/left-pad.ts"), [external("packages/domain/src/left-pad.ts", "left-pad", "ajv, node:path")]);
    assert.deepEqual(delivered("packages/domain/src/file-system.ts"), [external("packages/domain/src/file-system.ts", "node:fs", "ajv, node:path")]);
    assert.deepEqual(delivered("packages/domain/src/schema.ts"), [external("packages/domain/src/schema.ts", "zod", "ajv, node:path")]);
  });
  it("accepts the modules of the list, by their name or by a path into them", () => {
    assert.deepEqual(delivered("packages/domain/src/validation.ts"), []);
  });
  it("accepts a module the demonstration configuration adds to the list, and refuses the others", () => {
    assert.deepEqual(demonstration("packages/domain/src/schema.ts"), []);
    assert.deepEqual(demonstration("packages/domain/src/left-pad.ts"), [external("packages/domain/src/left-pad.ts", "left-pad", "ajv, node:path, zod")]);
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
  const refused = ["packages/harness/src/runner/session.ts", "packages/engine/src/run/session.ts", "apps/cli/src/session.ts", "apps/api/src/session.ts"];
  const implementation = "packages/harness/src/copilot/session.ts";
  const dynamic = "packages/engine/src/dynamic.ts";
  const installed = "packages/engine/src/installed.ts";
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

describe("criterion 8 — the connected mode of the command line imports only the domain", () => {
  const connected = (file: string): string => `apps/cli/src/connected/${file}`;
  const command = (file: string): string => `apps/cli/src/${file}`;
  const refused = ["harness", "store", "tools"] as const;
  const of = linted({
    ...Object.fromEntries(refused.map((target) => [connected(`${target}.ts`), byName(name(target))])),
    [connected("sdk.ts")]: 'import { CopilotClient } from "@github/copilot-sdk";\nexport const client = CopilotClient;\n',
    [connected("domain.ts")]: byName(name("domain")),
    [connected("command.ts")]: 'import { runOqas } from "../run-oqas.ts";\nexport const command = runOqas;\n',
    [connected("installed.ts")]: 'import { runner } from "../../node_modules/@open-qa-stack/harness/src/index.ts";\nexport const used = runner;\n',
    ...Object.fromEntries(refused.map((target) => [command(`${target}.ts`), byName(name(target))])),
  });
  it("is set by an override of the lint configuration on the folder of the connected mode", async () => {
    const configuration = (await import(join(ROOT, ".oxlintrc.json"), { with: { type: "json" } })) as { default: { overrides: { files: string[] }[] } };
    assert.ok(configuration.default.overrides.some(({ files }) => files.length === 1 && files[0] === "apps/cli/src/connected/**"));
  });
  for (const target of refused) {
    it(`refuses ${target} in connected/`, () => {
      const file = connected(`${target}.ts`);
      assert.deepEqual(of(file), [forbidden(file, 2, "apps/cli/src/connected", name(target), name("domain"), "folder-boundaries")]);
    });
  }
  it("refuses the SDK of the agents in connected/", () => {
    assert.deepEqual(of(connected("sdk.ts")), [confined(connected("sdk.ts"))]);
  });
  it("accepts the domain in connected/", () => {
    assert.deepEqual(of(connected("domain.ts")), []);
  });
  it("refuses a file of the command line outside connected/ imported by a relative path in connected/", () => {
    assert.deepEqual(of(connected("command.ts")), [
      `${connected("command.ts")}:1:1: apps/cli/src/connected may not import ${command("run-oqas.ts")} by a relative path that leaves its folder. [Error/open-qa-stack(folder-boundaries)]`,
    ]);
  });
  it("refuses harness reached by a path through the installed packages in connected/", () => {
    const file = connected("installed.ts");
    assert.deepEqual(of(file), [forbidden(file, 1, "apps/cli/src/connected", name("harness"), name("domain"), "folder-boundaries")]);
  });
  for (const target of refused) {
    it(`accepts ${target} outside connected/`, () => {
      assert.deepEqual(of(command(`${target}.ts`)), []);
    });
  }
});

describe("criterion 9 — a manifest that declares a dependency of the workspace out of the table fails the check", () => {
  const manifest = (dependencies: Record<string, string>, devDependencies: Record<string, string> = {}): string =>
    `${JSON.stringify({ name: "@open-qa-stack/agents", private: true, dependencies, devDependencies }, null, 2)}\n`;
  const workspace = new DemoWorkspace({});
  afterAll(() => workspace.remove());
  it("fails, naming the manifest, the line, the source, the target, the field and the rule", async () => {
    workspace.write({ "packages/agents/package.json": manifest({ "@open-qa-stack/domain": "workspace:*", "@open-qa-stack/harness": "workspace:*" }) });
    assert.deepEqual(await workspace.checkManifests(), {
      code: 1,
      output:
        "packages/agents/package.json:6: @open-qa-stack/agents may not import @open-qa-stack/harness; among the packages of the workspace, it may import @open-qa-stack/domain, @open-qa-stack/tools. (dependencies) [open-qa-stack/package-boundaries]\n",
    });
  });
  it("passes when the manifest keeps to the table, the dependencies of its tests apart", async () => {
    workspace.write({
      "packages/agents/package.json": manifest({ "@open-qa-stack/tools": "workspace:*", ajv: "8.20.0" }, { "@open-qa-stack/harness": "workspace:*" }),
    });
    assert.deepEqual(await workspace.checkManifests(), { code: 0, output: "" });
  });
});

describe("criterion 10 — the tests of the criteria run on demonstration files outside the packages of the product", () => {
  it("writes them in a temporary workspace, away from the repository", () => {
    const workspace = new DemoWorkspace({ "packages/domain/src/demo.ts": "export const demo = 1;\n" });
    afterAll(() => workspace.remove());
    assert.ok(!workspace.root.startsWith(ROOT));
    assert.ok(!(workspace.root + "/").startsWith(join(ROOT, "packages")));
  });
});

describe("criterion 11 — the web console imports the contract of sessions and nothing else of the domain", () => {
  const sessions = "apps/web/src/sessions.ts";
  const whole = "apps/web/src/whole.ts";
  const of = linted({
    [sessions]: 'import type { Session } from "@open-qa-stack/domain/sessions";\nexport type Shown = Session;\n',
    [whole]:
      'import type { Verdict } from "@open-qa-stack/domain";\nexport const domain = await import("@open-qa-stack/domain");\nexport type Shown = Verdict;\n',
  });
  const restricted = (line: number, column: number): string =>
    `${whole}:${line}:${column}: '@open-qa-stack/domain' import is restricted from being used. [Error/eslint(no-restricted-imports)]`;
  it("accepts the entry of the sessions", () => {
    assert.deepEqual(of(sessions), []);
  });
  it("refuses the main entry, by a static or a dynamic import", () => {
    assert.deepEqual(of(whole), [restricted(1, 1), restricted(2, 29)]);
  });
});
