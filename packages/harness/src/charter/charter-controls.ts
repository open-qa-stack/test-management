import type { CharterControl } from "./charter-control.ts";

/**
 * How each rule of the default charter is checked, in the order of the charter.
 *
 * @remarks
 * A lint rule belongs to one rule of the charter only, so that each finding cites a single identifier.
 */
export const CHARTER_CONTROLS: readonly CharterControl[] = Object.freeze([
  {
    rule: "PW-LOC-01",
    lint: [{ name: "playwright/prefer-native-locators" }, { name: "playwright/no-get-by-title" }],
    note: "Flags a locator that a getBy method replaces, and getByTitle. Whether getByRole came first is left to review.",
  },
  {
    rule: "PW-LOC-02",
    lint: [{ name: "playwright/no-raw-locators" }, { name: "playwright/no-element-handle" }, { name: "playwright/no-nth-methods" }],
    note: "Flags CSS and XPath locators, element handles, and first, last and nth.",
  },
  {
    rule: "PW-ASSERT-01",
    lint: [{ name: "playwright/expect-expect" }, { name: "playwright/prefer-web-first-assertions" }, { name: "playwright/missing-playwright-await" }],
    note: "Flags a test without assertion, an assertion on a value read once from the page, and an assertion that is not awaited.",
  },
  {
    rule: "PW-WAIT-01",
    lint: [
      { name: "playwright/no-wait-for-timeout" },
      {
        name: "no-restricted-globals",
        options: [
          { name: "setTimeout", message: "Never wait for a fixed time." },
          { name: "setInterval", message: "Never wait for a fixed time." },
        ],
      },
    ],
    note: "Flags page.waitForTimeout, setTimeout and setInterval.",
  },
  {
    rule: "PW-ISO-01",
    lint: [{ name: "playwright/no-export" }],
    note: "Flags an export from a test file, which another test could import. Shared state, order and serial mode are left to review.",
  },
  {
    rule: "PW-DATA-01",
    lint: [],
    note: "Not checked: how a test prepares and removes its data is left to review.",
  },
  {
    rule: "PW-STEP-01",
    lint: [],
    note: "Not checked: which actions are business actions is left to review.",
  },
  {
    rule: "PW-SHOT-01",
    lint: [],
    note: "Not checked: no lint rule ties a screenshot to the end of a step.",
  },
  {
    rule: "PW-ENV-01",
    lint: [],
    note: "Not checked: no lint rule knows the addresses of the environments.",
  },
  {
    rule: "PW-FACT-01",
    lint: [],
    note: "Not checked: whether a value comes from the knowledge sources is left to review.",
  },
  {
    rule: "PW-ORG-01",
    lint: [],
    note: "Not checked: the path of a test is chosen before it is checked.",
  },
]);
