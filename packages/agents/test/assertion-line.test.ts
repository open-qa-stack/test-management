import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertionsOf, writtenValues } from "../src/designer/assertion-line.ts";

const ADDRESS = "742 Alpine Way, 3000 Bern";
const BY_TEXT = { text: ADDRESS, locator: `page.getByText(${JSON.stringify(ADDRESS)}, { exact: true })`, field: false };
const expect = (shows: string[], absent: string[], elements = [BY_TEXT]) => ({ result: "The address shows", shows, absent, elements });

describe("the values a test writes in the environment", () => {
  it("are those of the data of a scenario that writes, long enough to be told in a text, and none for one that only reads", () => {
    const data = [
      { value: "742 Alpine Way", from: "made-up" },
      { value: "CH", from: "shop" },
    ];
    assert.deepEqual([writtenValues({ effect: "write", data }), writtenValues({ effect: "read", data })], [["742 Alpine Way"], []]);
  });
});

describe("the assertion of a text that holds a value the test writes", () => {
  const written = ["742 Alpine Way"];

  it("counts the elements the page shows, since each run may add one: one at least for a text shown, none for one gone", () => {
    assert.deepEqual(assertionsOf(expect([ADDRESS], []), written), [
      `await expect(page.getByText(${JSON.stringify(ADDRESS)}, { exact: true }).filter({ visible: true })).not.toHaveCount(0);`,
    ]);
    assert.deepEqual(assertionsOf(expect([], [ADDRESS]), written), [
      `await expect(page.getByText(${JSON.stringify(ADDRESS)}, { exact: true }).filter({ visible: true })).toHaveCount(0);`,
    ]);
    // A text no screen gave an element for is found anywhere on the page.
    assert.deepEqual(assertionsOf(expect([], [ADDRESS], []), written), [
      `await expect(page.getByText(${JSON.stringify(ADDRESS)}).filter({ visible: true })).toHaveCount(0);`,
    ]);
  });

  it("stays as it is on a field, which holds one value, and on an element found by something else than the text", () => {
    const field = { text: "742 Alpine Way", locator: 'page.getByRole("textbox", { name: "Street", exact: true })', field: true };
    const row = { text: ADDRESS, locator: 'page.getByRole("row", { name: "Ado Kinnett" })', field: false };
    assert.deepEqual(assertionsOf(expect(["742 Alpine Way", ADDRESS], [], [field, row]), written), [
      'await expect(page.getByRole("textbox", { name: "Street", exact: true })).toHaveValue("742 Alpine Way");',
      `await expect(page.getByRole("row", { name: "Ado Kinnett" })).toContainText(${JSON.stringify(ADDRESS)});`,
    ]);
  });

  it("is that of one element for a text the test does not write, as the plan found it", () => {
    assert.deepEqual(assertionsOf(expect([ADDRESS], [])), [`await expect(page.getByText(${JSON.stringify(ADDRESS)}, { exact: true })).toBeVisible();`]);
    assert.deepEqual(assertionsOf(expect([ADDRESS], []), ["Veldane"]), [
      `await expect(page.getByText(${JSON.stringify(ADDRESS)}, { exact: true })).toBeVisible();`,
    ]);
  });
});
