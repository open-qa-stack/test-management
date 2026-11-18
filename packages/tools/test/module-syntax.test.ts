import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { moduleSyntax, type ModuleSyntax } from "../src/index.ts";

/** What a syntax tells, without the outline of the test, which the tests of the outline check. */
function imported(syntax: ModuleSyntax): { ok: boolean; imports?: unknown; error?: string } {
  return syntax.ok ? { ok: true, imports: syntax.imports } : syntax;
}

describe("the syntax of a TypeScript module", () => {
  it("lists every module imported, re-exported or required, in the order of the file", async () => {
    const text = [
      `import { test, expect } from "@playwright/test";`,
      `import type { Policy } from "./policy.ts";`,
      `import "./setup";`,
      `export { openPolicy } from '../blocs/open-policy.ts';`,
      `export const answer = 42;`,
      `import fs = require("node:fs");`,
      `const pg = await import("pg");`,
      `const name = "lodash";`,
      `const computed = require(name);`,
      `const nothing = require();`,
      `test("opens", async ({ page }) => { await page.goto("/"); });`,
    ].join("\n");
    assert.deepEqual(imported(await moduleSyntax(text)), {
      ok: true,
      imports: [
        { module: "@playwright/test", line: 1 },
        { module: "./policy.ts", line: 2 },
        { module: "./setup", line: 3 },
        { module: "../blocs/open-policy.ts", line: 4 },
        { module: "node:fs", line: 6 },
        { module: "pg", line: 7 },
        { module: undefined, line: 9 },
        { module: undefined, line: 10 },
      ],
    });
  });

  it("gives the first error by line and column: a missing token, or an unexpected text", async () => {
    assert.deepEqual(await moduleSyntax(`import { test } from "@playwright/test";\ntest("a", async ({ page }) => { await page.goto("/"; });\n`), {
      ok: false,
      error: `line 2, column 52: missing ")"`,
    });
    assert.deepEqual(await moduleSyntax(`const ok = 1;\nconst policy = {\n`), { ok: false, error: `line 2, column 1: unexpected "const policy = {"` });
    assert.deepEqual(await moduleSyntax(`import { test } from "@playwright/test";\ntest("x", async () => {\n`), {
      ok: false,
      error: `line 1, column 1: unexpected "import { test } from \\"@playwright/test\\";"`,
    }); // A string left open makes the whole file an error: the place given is the one inside it that went wrong.
    const open = [
      'import { test } from "@playwright/test";',
      'test("a", async ({ page }, testInfo) => {',
      '  await page.goto("/");',
      '  await testInfo.attach("1", { body: await page.screenshot(), contentType: "image/png\' });',
      "});",
      "",
    ].join("\n");
    assert.deepEqual(await moduleSyntax(open), { ok: false, error: 'line 4, column 91: missing "\\""' });
  });
});

describe("a module named with an escape", () => {
  it("is a computed module: its text is not its name", async () => {
    const text = [`import fs from "node\\x3afs";`, `const pg = require("p\\u0067");`].join("\n");
    assert.deepEqual(imported(await moduleSyntax(text)), {
      ok: true,
      imports: [
        { module: undefined, line: 1 },
        { module: undefined, line: 2 },
      ],
    });
  });
});
