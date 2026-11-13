import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import type { CharterSettings } from "@open-qa-stack/shared";
import type { TestFinding } from "@open-qa-stack/domain";
import { CHARTER_DOC_FILE, documentedSection, renderControls } from "../scripts/emit-charter-doc.ts";
import { DESIGNER_METHOD_EXAMPLE } from "../src/charter/designer-method.ts";
import { readLintReport } from "../src/test-check/lint-report.ts";
import { CHARTER_CONTROLS, CharterCheck, DEFAULT_CHARTER, resolveCharter, type ActiveRule } from "../src/index.ts";

/** Types of `@playwright/test` that the proposed tests below use. */
const PLAYWRIGHT_TYPES = `
export interface Locator {
  click(options?: { force?: boolean }): Promise<void>;
  fill(value: string): Promise<void>;
  first(): Locator;
  nth(index: number): Locator;
  textContent(): Promise<string | null>;
  getByRole(role: string, options?: { name?: string; exact?: boolean }): Locator;
}
export interface ElementHandle { click(): Promise<void>; }
export interface Page {
  goto(url: string): Promise<null>;
  waitForTimeout(timeout: number): Promise<void>;
  waitForSelector(selector: string): Promise<unknown>;
  getByRole(role: string, options?: { name?: string; exact?: boolean }): Locator;
  getByLabel(text: string): Locator;
  getByTestId(id: string): Locator;
  getByTitle(text: string): Locator;
  locator(selector: string): Locator;
  $(selector: string): Promise<ElementHandle | null>;
  screenshot(): Promise<Uint8Array>;
}
export interface TestInfo { attach(name: string, options: { body: Uint8Array; contentType: string }): Promise<void>; }
type Body = (fixtures: { page: Page }, testInfo: TestInfo) => Promise<void>;
type Declare = (title: string, body: Body) => void;
export declare const test: Declare & { skip: Declare; only: Declare; fixme: Declare; fail: Declare; step<T>(title: string, body: () => Promise<T>): Promise<T> };
interface Matchers { toBeVisible(): Promise<void>; toBeHidden(): Promise<void>; toHaveText(text: string): Promise<void>; toContainText(text: string): Promise<void>; toBe(value: unknown): void; }
export declare const expect: { (actual: unknown): Matchers; soft(actual: unknown): Matchers };
`;

const BLOCK = `import type { Page } from "@playwright/test";

export async function openPolicy(page: Page, id: string): Promise<void> {
  await page.goto(\`/policies/\${id}\`);
}
`;

/** A test repository with `@playwright/test` installed and one block. */
function testRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "test-repository-"));
  const files = {
    "node_modules/@playwright/test/package.json": JSON.stringify({ name: "@playwright/test", version: "0.0.0", types: "index.d.ts" }),
    "node_modules/@playwright/test/index.d.ts": PLAYWRIGHT_TYPES,
    "apps/policies/blocs/open-policy.ts": BLOCK,
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** Every file under a folder, relative to it, with its content. */
function snapshot(root: string): Record<string, string> {
  const entries = readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  return Object.fromEntries(entries.map((entry) => [join(entry.parentPath, entry.name).slice(root.length + 1), readFileSync(join(entry.parentPath, entry.name), "utf8")]));
}

/** A test file whose single test runs `body`, then asserts on the page. */
function spec(body: string): string {
  return `import { expect, test } from "@playwright/test";

test("renews a policy", async ({ page }) => {
${body}
  await expect(page.getByRole("status")).toHaveText("Policy renewed");
});
`;
}

const repository = testRepository();
after(() => rmSync(repository, { recursive: true, force: true }));

const DEFAULT_RULES = resolveCharter({ disable: [], add: [] });
if (!DEFAULT_RULES.ok) throw new Error("the default charter does not resolve");
const check = new CharterCheck({ repository, rules: DEFAULT_RULES.rules });
const PATH = "apps/policies/renew-policy.spec.ts";

function ruleIds(findings: readonly TestFinding[]): string[] {
  return [...new Set(findings.map((finding) => (finding.kind === "charter" ? finding.rule : finding.code)))].sort();
}

describe("criterion 1 — a test that waits with waitForTimeout goes back with a finding citing the wait rule", () => {
  it("cites PW-WAIT-01 at the line and column of the call", async () => {
    const findings = await check.check({ path: PATH, content: spec(`  await page.goto("/policies");\n  await page.waitForTimeout(2000);`) });
    const { example } = DEFAULT_CHARTER.find((rule) => rule.id === "PW-WAIT-01")!;
    assert.deepEqual(findings, [{ kind: "charter", rule: "PW-WAIT-01", line: 5, column: 9, message: "Unexpected use of page.waitForTimeout().", example }]);
  });

  it("cites PW-WAIT-01 for a timer too", async () => {
    const findings = await check.check({ path: PATH, content: spec(`  await new Promise((resolve) => setTimeout(resolve, 2000));`) });
    assert.deepEqual(ruleIds(findings), ["PW-WAIT-01"]);
    assert.match(findings[0]!.message, /Never wait for a fixed time\./);
  });
});

describe("criterion 2 — a test that does not compile goes back with the error of the compiler", () => {
  it("gives the code, the position and the message of a type error", async () => {
    const findings = await check.check({ path: PATH, content: spec(`  const id: number = "P-001";\n  await page.goto(\`/policies/\${id}\`);`) });
    assert.deepEqual(findings, [{ kind: "compiler", code: "TS2322", line: 4, column: 9, message: "Type 'string' is not assignable to type 'number'." }]);
  });

  it("gives the syntax error of a file that does not parse", async () => {
    const findings = await check.check({ path: PATH, content: spec(`  await page.goto(`) });
    assert.ok(findings.length > 0);
    assert.ok(findings.every((finding) => finding.kind === "compiler"));
    assert.ok(findings.some((finding) => finding.kind === "compiler" && finding.code === "syntax"));
  });

  it("gives the import that does not resolve", async () => {
    const findings = await check.check({ path: PATH, content: spec(`  await import("./blocs/missing-block.ts");`) });
    assert.deepEqual(ruleIds(findings), ["TS2307"]);
  });
});

describe("criterion 3 — a conforming test has no finding", () => {
  const conforming = `import { expect, test } from "@playwright/test";
import { openPolicy } from "./blocs/open-policy.ts";

test("renews a policy", async ({ page }, testInfo) => {
  await test.step("Open the policy", async () => {
    await openPolicy(page, "P-001");
    await expect(page.getByRole("table", { name: "Policies" })).toBeVisible();
  });
  await test.step("Renew the policy", async () => {
    await page.getByLabel("Start date").fill("2027-01-01");
    await page.getByTestId("policy-summary").getByRole("button", { name: "Renew" }).click();
    await expect(page.getByRole("status")).toHaveText("Policy renewed");
    await testInfo.attach("policy renewed", { body: await page.screenshot(), contentType: "image/png" });
  });
});
`;

  it("returns no finding for a test that imports a block of the repository by relative path", async () => {
    assert.deepEqual(await check.check({ path: PATH, content: conforming }), []);
  });

  it("returns no finding for the example of the method of the designer", async () => {
    assert.deepEqual(await check.check({ path: "apps/shop/search-orders.spec.ts", content: `${DESIGNER_METHOD_EXAMPLE}\n` }), []);
  });

  it("writes nothing to the test repository and leaves no temporary folder behind", async () => {
    const before = snapshot(repository);
    const folders = () => readdirSync(tmpdir()).filter((name) => name.startsWith("test-check-")).sort();
    const foldersBefore = folders();
    await check.check({ path: PATH, content: conforming });
    await check.check({ path: PATH, content: spec("  const broken: number = '';") });
    assert.deepEqual(snapshot(repository), before);
    assert.deepEqual(folders(), foldersBefore);
  });
});

/** A proposed test that breaks each lint rule of the table, and nothing else. */
const BREAKING: Record<string, string> = {
  "playwright/prefer-native-locators": spec(`  await page.locator('[data-testid="renew"]').click();`),
  "playwright/no-get-by-title": spec(`  await page.getByTitle("Renew").click();`),
  "playwright/no-raw-locators": spec(`  await page.locator(".renew-button").click();`),
  "playwright/no-element-handle": spec(`  await (await page.$("#renew"))?.click();`),
  "playwright/no-nth-methods": spec(`  await page.getByRole("row").first().click();`),
  "playwright/expect-expect": `import { test } from "@playwright/test";\n\ntest("renews a policy", async ({ page }) => {\n  await page.getByRole("button", { name: "Renew" }).click();\n});\n`,
  "playwright/prefer-web-first-assertions": spec(`  expect(await page.getByRole("status").textContent()).toBe("Policy renewed");`),
  "playwright/missing-playwright-await": spec(`  expect(page.getByRole("status")).toBeVisible();`),
  "playwright/no-skipped-test": spec("").replace("test(", "test.skip("),
  "playwright/no-focused-test": spec("").replace("test(", "test.only("),
  "playwright/no-conditional-expect": spec(`  if (Date.now() > 0) await expect(page.getByRole("status")).toBeVisible();`),
  "playwright/no-conditional-in-test": spec(`  if (Date.now() > 0) await page.goto("/policies");`),
  "playwright/no-force-option": spec(`  await page.getByRole("button", { name: "Renew" }).click({ force: true });`),
  "no-restricted-properties": spec(`  await expect.soft(page.getByRole("status")).toBeVisible();`),
  "playwright/no-wait-for-timeout": spec(`  await page.waitForTimeout(500);`),
  "playwright/no-wait-for-selector": spec(`  await page.waitForSelector('table[aria-label="Policies"]');`),
  "no-restricted-globals": spec(`  setInterval(() => undefined, 500);`),
  "playwright/no-export": `export const POLICY = "P-001";\n\n${spec("")}`,
};

describe("criterion 4 — the table from rules of the charter to controls is documented and tested", () => {
  const lintNames = CHARTER_CONTROLS.flatMap((control) => control.lint.map((lint) => lint.name));

  it("has one row per rule of the default charter, in its order", () => {
    assert.deepEqual(
      CHARTER_CONTROLS.map((control) => control.rule),
      DEFAULT_CHARTER.map((rule) => rule.id),
    );
  });

  it("gives each lint rule to a single rule of the charter, and says what a row leaves unchecked", () => {
    assert.equal(new Set(lintNames.map((name) => name.slice(name.indexOf("/") + 1))).size, lintNames.length);
    for (const control of CHARTER_CONTROLS) {
      assert.ok(control.note.length > 0, control.rule);
      if (control.lint.length === 0) assert.match(control.note, /^Not checked: /, control.rule);
    }
  });

  it("is documented exactly as the table holds it", () => {
    assert.equal(documentedSection(readFileSync(CHARTER_DOC_FILE, "utf8"), "controls"), renderControls());
  });

  it("has a test that breaks each lint rule", () => {
    assert.deepEqual(Object.keys(BREAKING).sort(), [...lintNames].sort());
  });

  for (const control of CHARTER_CONTROLS) {
    for (const lint of control.lint) {
      it(`cites ${control.rule} for a test that breaks ${lint.name}`, async () => {
        const findings = await check.check({ path: PATH, content: BREAKING[lint.name]! });
        assert.ok(findings.length > 0);
        assert.ok(
          findings.every((finding) => finding.kind === "charter"),
          JSON.stringify(findings),
        );
        assert.ok(findings.some((finding) => finding.kind === "charter" && finding.rule === control.rule));
      });
    }
  }

  it("cites PW-KEEP-01 for a test marked as expected to fail or to be fixed later, with the example of the rule", async () => {
    const { example } = DEFAULT_CHARTER.find((rule) => rule.id === "PW-KEEP-01")!;
    for (const mark of ["fail", "fixme"]) {
      const findings = await check.check({ path: PATH, content: spec("").replace("test(", `test.${mark}(`) });
      assert.deepEqual(findings, [{ kind: "charter", rule: "PW-KEEP-01", line: 3, column: 1, message: `'test.${mark}' is restricted from being used.`, example }]);
    }
  });

  it("turns off the controls of a rule the configuration disables, and checks no added rule", async () => {
    const settings: Required<CharterSettings> = {
      disable: [{ rule: "PW-WAIT-01", reason: "Waits are reviewed by hand." }],
      add: [{ id: "TEAM-TAG-01", statement: "Tag every test with its domain.", reason: "The nightly run selects tests by domain." }],
    };
    const resolution = resolveCharter(settings);
    assert.ok(resolution.ok);
    const tuned = new CharterCheck({ repository, rules: resolution.rules });
    assert.deepEqual(await tuned.check({ path: PATH, content: spec(`  await page.waitForTimeout(500);`) }), []);
    assert.deepEqual(ruleIds(await tuned.check({ path: PATH, content: BREAKING["playwright/no-raw-locators"]! })), ["PW-LOC-02"]);
  });

  it("still reports compiler errors with no rule in force", async () => {
    const none: ActiveRule[] = [];
    const findings = await new CharterCheck({ repository, rules: none }).check({ path: PATH, content: spec(`  await page.waitForTimeout("500");`) });
    assert.deepEqual(ruleIds(findings), ["TS2345"]);
  });
});

describe("the path of a proposed test", () => {
  for (const path of ["/tmp/renew-policy.spec.ts", "../renew-policy.spec.ts", "apps/../../renew-policy.spec.ts", "node_modules/renew-policy.spec.ts", "apps/policies/renew-policy.spec.js"]) {
    it(`is refused when it is ${path}`, async () => {
      await assert.rejects(check.check({ path, content: spec("") }), RangeError);
    });
  }

  it("may name a file at the root of the repository, written with ./", async () => {
    assert.deepEqual(await check.check({ path: "./renew-policy.spec.ts", content: spec("") }), []);
  });
});

describe("the report of the linter", () => {
  const charterRuleOf = new Map([["no-wait-for-timeout", "PW-WAIT-01"]]);

  for (const [what, stdout] of [
    ["is not JSON", "Failed to parse oxlint configuration file."],
    ["is JSON without diagnostics", "{}"],
    ["is null", "null"],
  ] as const) {
    it(`is refused with what the linter wrote when the output ${what}`, () => {
      assert.throws(() => readLintReport({ stdout, stderr: "x Failed" }, charterRuleOf), (error: Error) => error.message.startsWith("The linter gave no report: x Failed"));
    });
  }

  it("places a diagnostic without position at the start of the file, and orders findings by line then column", () => {
    const stdout = JSON.stringify({
      diagnostics: [
        { message: "late", code: "playwright(no-wait-for-timeout)", labels: [{ span: { line: 2, column: 9 } }] },
        { message: "early", code: "playwright(no-wait-for-timeout)", labels: [{ span: { line: 2, column: 3 } }] },
        { message: "nowhere", code: "typescript(TS6059)", labels: [] },
        { message: "unlabelled" },
      ],
    });
    assert.deepEqual(readLintReport({ stdout, stderr: "" }, charterRuleOf), [
      { kind: "compiler", code: "TS6059", line: 1, column: 1, message: "nowhere" },
      { kind: "compiler", code: "syntax", line: 1, column: 1, message: "unlabelled" },
      { kind: "charter", rule: "PW-WAIT-01", line: 2, column: 3, message: "early" },
      { kind: "charter", rule: "PW-WAIT-01", line: 2, column: 9, message: "late" },
    ]);
  });
});
