import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlannedScenario } from "@open-qa-stack/domain";
import { PLAN_FILE_SUFFIX, planFileText, readPlanFile, type PlanRecord } from "../src/designer/plan-file.ts";

const SEARCH: PlannedScenario = {
  id: "search-customer-by-last-name",
  title: "Search a customer by last name",
  intent: "Verifies that a search by last name lists the customer found and no other.",
  kind: "functional",
  case: "nominal",
  application: "policy-management",
  domain: "customers",
  sources: [{ source: "customers-db", item: "public.customers" }, { source: "policy-management" }],
  data: [{ value: "Veldane", from: "customers-db" }],
  steps: [
    { action: "Open the list of the customers.", code: ['await page.goto("/customers");'], expects: [] },
    {
      action: "Search the last name Veldane",
      code: [
        'await page.getByRole("searchbox", { name: "Search a customer", exact: true }).fill("Veldane");',
        'await page.getByRole("button", { name: "Search", exact: true }).click();',
      ],
      expects: [
        {
          result: "The list shows the customer found, and no longer the others.",
          shows: ["Mira Veldane", "Veldane", "1 customer", "Active"],
          absent: ["Ada Brennick"],
          elements: [
            { text: "Mira Veldane", locator: 'page.getByRole("link", { name: "Mira Veldane", exact: true })', field: false },
            { text: "Veldane", locator: 'page.getByRole("searchbox", { name: "Search a customer", exact: true })', field: true },
            { text: "Active", locator: 'page.getByRole("cell", { name: "Active", exact: true })', field: false, count: 3 },
            { text: "Ada Brennick", locator: 'page.getByRole("link", { name: "Ada Brennick", exact: true })', field: false },
          ],
        },
      ],
    },
  ],
};

const RECORD: PlanRecord = {
  formatVersion: 2,
  design: "design-20261114T101500Z",
  environment: "local",
  brief: "Test the search of a customer in the list.",
  scenarios: [SEARCH],
};

const PAGE = `# Test plan design-20261114T101500Z

- Environment: local
- Brief: Test the search of a customer in the list.

The harness wrote this file from the plan it accepted, and reads its last part again. Edit neither part by hand: a file whose two parts differ is not read.

## 1. search-customer-by-last-name

Search a customer by last name (functional, nominal). Application policy-management, domain customers.

- Intent: Verifies that a search by last name lists the customer found and no other.
- Sources: customers-db: public.customers; policy-management
- Data: "Veldane" (customers-db)

### Step 1. Open the list of the customers

\`\`\`ts
await page.goto("/customers");
\`\`\`

### Step 2. Search the last name Veldane

\`\`\`ts
await page.getByRole("searchbox", { name: "Search a customer", exact: true }).fill("Veldane");
await page.getByRole("button", { name: "Search", exact: true }).click();
\`\`\`

Expect 2.1: The list shows the customer found, and no longer the others.
- shows "Mira Veldane" in \`page.getByRole("link", { name: "Mira Veldane", exact: true })\`
- shows "Veldane" as the value of \`page.getByRole("searchbox", { name: "Search a customer", exact: true })\`
- shows "1 customer" by its text
- shows "Active" in any of the 3 \`page.getByRole("cell", { name: "Active", exact: true })\`
- no longer shows "Ada Brennick" in \`page.getByRole("link", { name: "Ada Brennick", exact: true })\`

## Record

\`\`\`json
`;

describe("the file of a plan", () => {
  it("is a page a person reads, then the record, and is read back as the plan it was written from", () => {
    const text = planFileText(RECORD);
    assert.equal(text, `${PAGE}${JSON.stringify(RECORD, null, 2)}\n\`\`\`\n`);
    assert.deepEqual(readPlanFile(text), RECORD);
    assert.equal(PLAN_FILE_SUFFIX, ".plan.md");
  });

  it("says under its own heading what the brief asks and no scenario does, and reads it back", () => {
    const uncovered = [{ asked: "Change the address\nof a customer.", reason: "No screen offers to edit an address." }];
    const text = planFileText({ ...RECORD, uncovered });
    assert.ok(
      text.includes(
        "\n## Not covered\n\nThe brief asks what follows, and no scenario does it:\n\n- Change the address of a customer. No screen offers to edit an address.\n\n## Record\n",
      ),
      text,
    );
    assert.deepEqual(readPlanFile(text), { ...RECORD, uncovered });
    assert.ok(!planFileText(RECORD).includes("## Not covered"));
  });

  it("holds each text on one line of the page, and exactly in the record: new lines, grave accents, the marks of its own record", () => {
    const { brief: _brief, ...unbriefed } = RECORD;
    const odd: PlanRecord = {
      ...unbriefed,
      scenarios: [
        {
          ...SEARCH,
          title: "Search\n## Record\n\n```json\n{}\n```\n",
          intent: "Verifies `a` search,\n  on two lines.",
          data: [],
          steps: [
            {
              action: "Type ```",
              code: ['await page.getByRole("searchbox").fill("```");', "await page.getByText(`Search`).click();"],
              expects: [
                {
                  result: "A message\nshows",
                  shows: ["No customer\nfound", "```"],
                  absent: [],
                  elements: [{ text: "```", locator: 'page.getByRole("link", { name: "``" })', field: false }],
                },
              ],
            },
            { action: "Read the answer of the service", code: [], expects: [] },
          ],
        },
      ],
    };
    const text = planFileText(odd);
    assert.ok(!text.includes("- Brief:"));
    assert.match(text, /^Search ## Record ```json \{\} ``` \(functional, nominal\)\./m);
    assert.match(text, /^- Intent: Verifies `a` search, on two lines\.$/m);
    assert.match(text, /^- Data: none$/m);
    assert.match(text, /^- shows "No customer\\nfound" by its text$/m);
    // The fence of a code is longer than the grave accents it holds.
    assert.ok(text.includes('\n\n````ts\nawait page.getByRole("searchbox").fill("```");\nawait page.getByText(`Search`).click();\n````\n\n'));
    assert.ok(text.includes('- shows "```" in ```page.getByRole("link", { name: "``" })```\n'));
    // A step done on no screen has no code.
    assert.ok(text.includes("### Step 2. Read the answer of the service\n\n## Record"));
    assert.deepEqual(readPlanFile(text), odd);
  });

  it("is not read when its record is missing, cut, no JSON, of another version or of another shape, nor when a hand changed either part", () => {
    const text = planFileText(RECORD);
    assert.equal(readPlanFile(""), undefined);
    assert.equal(readPlanFile(text.slice(0, text.indexOf("## Record"))), undefined);
    assert.equal(readPlanFile(text.trimEnd()), undefined);
    assert.equal(readPlanFile(text.replace('"formatVersion": 2', '"formatVersion": 2,,')), undefined);
    assert.equal(readPlanFile(text.replace('"formatVersion": 2', '"formatVersion": 1')), undefined);
    assert.equal(readPlanFile(text.replace(/"scenarios": \[[^]*\]\n\}/, '"scenarios": 3\n}')), undefined);
    // The page changed, the record not; then the record, the page not.
    assert.equal(readPlanFile(text.replace('- shows "Mira Veldane"', '- shows "Mira Veldano"')), undefined);
    assert.equal(readPlanFile(text.replace('"shows": [\n                "Mira Veldane"', '"shows": [\n                "Mira Veldano"')), undefined);
  });
});
