import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DEFAULT_REPOSITORY, validateConfig, type CharterSettings } from "@open-qa-stack/shared";
import { moduleSyntax } from "@open-qa-stack/tools";
import { CHARTER_DOC_FILE, documentedSection, renderRules } from "../scripts/emit-charter-doc.ts";
import { DESIGNER_METHOD, DESIGNER_METHOD_EXAMPLE } from "../src/charter/designer-method.ts";
import { DEFAULT_CHARTER, designerInstructions, resolveCharter, reviewerInstructions, type ActiveRule, type CharterResolution } from "../src/index.ts";

const NO_CHANGE: Required<CharterSettings> = { disable: [], add: [] };
const COMPOSERS = { designer: designerInstructions, reviewer: reviewerInstructions } as const;

function rulesOf(resolution: CharterResolution): ActiveRule[] {
  if (!resolution.ok) throw new Error(`expected the charter to resolve: ${JSON.stringify(resolution.errors)}`);
  return resolution.rules;
}

/** Positions of the rule identifiers in instructions, in the order they appear. */
function listedIds(instructions: string): string[] {
  return [...instructions.matchAll(/^- ([A-Z]+(?:-[A-Z0-9]+)+): /gm)].map((m) => m[1]!);
}

describe("criterion 1 — the charter lists its rules with identifier, statement, rationale and example", () => {
  it("gives every rule its four fields, and a Playwright documentation page as the source of its rationale", () => {
    assert.ok(DEFAULT_CHARTER.length > 0);
    for (const rule of DEFAULT_CHARTER) {
      for (const field of ["id", "statement", "rationale", "example"] as const) {
        assert.ok(rule[field].trim().length > 0, `${rule.id}: ${field}`);
      }
      assert.match(rule.source, /^https:\/\/playwright\.dev\/docs\//, rule.id);
    }
  });

  it("gives each rule a unique identifier of the form PW-<TOPIC>-<number>", () => {
    const ids = DEFAULT_CHARTER.map((rule) => rule.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^PW-[A-Z]+-\d{2}$/);
  });

  it("covers locators, assertions, waits, isolation, data, steps, screenshots, environments, invented values and layout", () => {
    const topics = new Set(DEFAULT_CHARTER.map((rule) => rule.id.split("-")[1]));
    assert.deepEqual([...topics].sort(), ["ASSERT", "DATA", "ENV", "FACT", "ISO", "LOC", "ORG", "SHOT", "STEP", "WAIT"]);
  });

  it("cannot be changed at run time", () => {
    assert.ok(Object.isFrozen(DEFAULT_CHARTER));
  });
});

describe("criterion 2 — without changes, the instructions of the designer and the reviewer hold every rule by its identifier", () => {
  const rules = rulesOf(resolveCharter(NO_CHANGE));

  it("keeps every rule of the charter, in order", () => {
    assert.deepEqual(
      rules.map((rule) => rule.id),
      DEFAULT_CHARTER.map((rule) => rule.id),
    );
  });

  for (const [role, compose] of Object.entries(COMPOSERS)) {
    it(`lists every rule in the ${role} instructions, with its statement, rationale and example`, () => {
      const instructions = compose(rules, DEFAULT_REPOSITORY);
      assert.deepEqual(listedIds(instructions), DEFAULT_CHARTER.map((rule) => rule.id));
      for (const rule of DEFAULT_CHARTER) {
        assert.ok(instructions.includes(`- ${rule.id}: ${rule.statement}\n  Why: ${rule.rationale}`), rule.id);
        for (const line of rule.example.split("\n")) assert.ok(instructions.includes(`\n    ${line}`), `${rule.id}: ${line}`);
      }
    });

    it(`gives the ${role} the folders of the repository layout`, () => {
      const instructions = compose(rules, { ...DEFAULT_REPOSITORY, appsDir: "tests", blocksDir: "blocks", journeysDir: "journeys" });
      assert.ok(instructions.includes("- Tests of an application: tests/<application id>/"));
      assert.ok(instructions.includes("- Blocks of an application: tests/<application id>/blocks/"));
      assert.ok(instructions.includes("- Journeys across applications: journeys/"));
    });
  }

  it("asks the reviewer to cite the identifier of each rule a test breaks", () => {
    assert.match(reviewerInstructions(rules, DEFAULT_REPOSITORY), /For each rule a test breaks, cite the identifier of the rule/);
    assert.doesNotMatch(designerInstructions(rules, DEFAULT_REPOSITORY), /cite the identifier/);
  });
});

describe("criterion 3 — a disabled rule leaves the instructions; an unknown one is refused at its path", () => {
  it("leaves PW-WAIT-01 out of both instructions when the configuration disables it with a reason", () => {
    const rules = rulesOf(resolveCharter({ disable: [{ rule: "PW-WAIT-01", reason: "The legacy grid has no loading state." }], add: [] }));
    for (const compose of Object.values(COMPOSERS)) {
      const instructions = compose(rules, DEFAULT_REPOSITORY);
      assert.ok(!instructions.includes("PW-WAIT-01"));
      assert.deepEqual(listedIds(instructions), DEFAULT_CHARTER.map((rule) => rule.id).filter((id) => id !== "PW-WAIT-01"));
    }
  });

  it("refuses an unknown rule with an error that names its path", () => {
    const resolution = resolveCharter({ disable: [{ rule: "PW-WAIT-01", reason: "r" }, { rule: "PW-NAP-01", reason: "r" }], add: [] });
    assert.deepEqual(resolution, {
      ok: false,
      errors: [{ kind: "reference", path: "/charter/disable/1/rule", rule: "unknown-charter-rule", message: "No rule of the charter has this identifier." }],
    });
  });

  it("refuses a file whose rule identifier is malformed before the charter is resolved", () => {
    const result = validateConfig(configWith({ disable: [{ rule: "pw-wait-01", reason: "r" }] }), {});
    assert.ok(!result.ok);
    assert.deepEqual(result.errors.map((e) => [e.path, e.rule]), [["/charter/disable/0/rule", "charter-rule-id"]]);
  });
});

describe("criterion 4 — a rule added by the configuration comes after the default rules", () => {
  const added = [
    { id: "TEAM-TAG-01", statement: "Tag every test with its domain.", reason: "The nightly run selects tests by domain." },
    { id: "TEAM-TAG-02", statement: "Tag smoke tests with @smoke.", reason: "Deployments run them first." },
  ];

  for (const [role, compose] of Object.entries(COMPOSERS)) {
    it(`lists the added rules last in the ${role} instructions, in the order of the file, with their reason`, () => {
      const instructions = compose(rulesOf(resolveCharter({ disable: [], add: added })), DEFAULT_REPOSITORY);
      assert.deepEqual(listedIds(instructions), [...DEFAULT_CHARTER.map((rule) => rule.id), "TEAM-TAG-01", "TEAM-TAG-02"]);
      assert.ok(instructions.includes("- TEAM-TAG-01: Tag every test with its domain.\n  Why: The nightly run selects tests by domain.\n- TEAM-TAG-02"));
    });
  }

  it("refuses an added rule that takes the identifier of a default rule", () => {
    const resolution = resolveCharter({ disable: [{ rule: "PW-NAP-01", reason: "r" }], add: [{ id: "PW-LOC-01", statement: "s", reason: "r" }] });
    assert.ok(!resolution.ok);
    assert.deepEqual(
      resolution.errors.map((e) => [e.kind, e.path, e.rule]),
      [
        ["reference", "/charter/disable/0/rule", "unknown-charter-rule"],
        ["structure", "/charter/add/0/id", "duplicate"],
      ],
    );
  });
});

describe("criterion 5 — the charter and its composition are tested without model or network", () => {
  it("imports nothing but its own modules and the types of the configuration", () => {
    const dir = new URL("../src/charter/", import.meta.url);
    for (const file of readdirSync(dir)) {
      const source = readFileSync(new URL(file, dir), "utf8");
      for (const [, statement, specifier] of source.matchAll(/^(import .*) from "([^"]+)";$/gm)) {
        assert.ok(specifier!.startsWith("./") || (specifier === "@open-qa-stack/shared" && statement!.startsWith("import type ")), `${file}: ${specifier}`);
      }
    }
  });

  it("composes the same instructions twice, with fetch refused", () => {
    const original = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error("network refused"));
    try {
      const compose = () => designerInstructions(rulesOf(resolveCharter(NO_CHANGE)), DEFAULT_REPOSITORY);
      assert.equal(compose(), compose());
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("the method of the designer", () => {
  const rules = rulesOf(resolveCharter(NO_CHANGE));

  it("ends the instructions of the designer, after the charter and the layout, and stays out of the reviewer's", () => {
    const instructions = designerInstructions(rules, DEFAULT_REPOSITORY);
    assert.ok(instructions.endsWith(`\n\n${DESIGNER_METHOD}`));
    assert.ok(instructions.indexOf("Repository layout:") < instructions.indexOf("Method, for each test:"));
    assert.ok(!reviewerInstructions(rules, DEFAULT_REPOSITORY).includes("Method, for each test:"));
  });

  it("stays with the designer whatever the rules in force", () => {
    assert.ok(designerInstructions([], DEFAULT_REPOSITORY).endsWith(DESIGNER_METHOD));
  });

  it("numbers seven steps, from the screen to the failure of a test", () => {
    assert.deepEqual(
      [...DESIGNER_METHOD.matchAll(/^(\d)\. /gm)].map((m) => m[1]),
      ["1", "2", "3", "4", "5", "6", "7"],
    );
    assert.match(DESIGNER_METHOD, /^7\. When it fails, .*Never remove or weaken the assertion that verifies the scenario.*propose it as failing/m);
  });

  it("is short enough for a small model", () => {
    assert.ok(DESIGNER_METHOD.length <= 3500);
  });

  it("gives its example whole, indented like the examples of the charter", () => {
    const indented = DESIGNER_METHOD_EXAMPLE.split("\n").map((line) => (line === "" ? line : `    ${line}`)).join("\n");
    assert.ok(DESIGNER_METHOD.endsWith(`\n${indented}`));
    assert.doesNotMatch(DESIGNER_METHOD, /[ \t]$/m);
  });

  it("has an example that parses as TypeScript and imports the test runner only", async () => {
    assert.deepEqual(await moduleSyntax(DESIGNER_METHOD_EXAMPLE), { ok: true, imports: [{ module: "@playwright/test", line: 1 }] });
  });

  it("has an example with a screenshot attached at the end of each step, and a relative path", () => {
    const steps = DESIGNER_METHOD_EXAMPLE.split("await test.step(").slice(1);
    assert.equal(steps.length, 2);
    for (const step of steps) assert.match(step, /await testInfo\.attach\([^\n]*await page\.screenshot\(\)[^\n]*\n {2}\}\);/);
    assert.deepEqual([...DESIGNER_METHOD_EXAMPLE.matchAll(/goto\("([^"]*)"\)/g)].map((m) => m[1]), ["/orders"]);
  });
});

describe("criterion 6 — the documentation describes the charter and how to tune it", () => {
  const doc = readFileSync(CHARTER_DOC_FILE, "utf8");

  it("lists every rule exactly as the charter holds it", () => {
    assert.equal(documentedSection(doc, "rules"), renderRules());
  });

  it("has a tuning example that the configuration and the charter accept", () => {
    const block = /```json\n([\s\S]*?)```/.exec(doc)![1]!;
    const { charter } = JSON.parse(block) as { charter: CharterSettings };
    const result = validateConfig(configWith(charter), {});
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(resolveCharter(result.config.charter).ok, true);
  });
});

/** A minimal configuration file with the given charter changes. */
function configWith(charter: CharterSettings): string {
  return JSON.stringify({
    formatVersion: 1,
    applications: [{ id: "shop", name: "Shop", type: "web", authentication: { method: "none" }, environments: [{ name: "local", uiUrl: "http://localhost:3000" }] }],
    knowledge: [],
    charter,
    model: { mode: "provider-key", provider: "openai", baseUrl: "http://localhost:1234/v1", model: "local-model" },
    autonomy: { level: "supervised" },
  });
}
