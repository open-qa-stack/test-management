import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { defectReportOf, defectStatusOf, MAX_DEFECT_DESCRIPTION, MAX_DEFECT_TITLE } from "../src/index.ts";

const TEST = { path: "apps/shop/tests/orders/listing/list-orders.spec.ts", title: "The orders are listed" };

describe("a defect, as a client reports it", () => {
  it("is its title, its severity, its description, its test and its execution, each text trimmed", () => {
    assert.deepEqual(
      defectReportOf({
        title: " The total is wrong ",
        severity: "S1",
        description: " It shows 0. ",
        test: { path: ` ${TEST.path}`, title: TEST.title },
        execution: " e1 ",
      }),
      {
        title: "The total is wrong",
        severity: "S1",
        description: "It shows 0.",
        test: TEST,
        execution: "e1",
      },
    );
    assert.deepEqual(defectReportOf({ title: "Total", severity: "S4", test: TEST, execution: "" }), {
      title: "Total",
      severity: "S4",
      description: "",
      test: TEST,
    });
  });

  it("is refused with why: no report, a title empty or too long, a severity not known, a description too long, no test", () => {
    assert.equal(defectReportOf([]), "A defect is { title, severity, description, test: { path, title }, execution }.");
    const refused = `The title of a defect is a text of 1 to ${MAX_DEFECT_TITLE} characters.`;
    assert.equal(defectReportOf({ title: " ", severity: "S1", test: TEST }), refused);
    assert.equal(defectReportOf({ title: "x".repeat(MAX_DEFECT_TITLE + 1), severity: "S1", test: TEST }), refused);
    assert.equal(defectReportOf({ title: "Total", severity: "S5", test: TEST }), "The severity of a defect is one of S1, S2, S3, S4.");
    assert.equal(
      defectReportOf({ title: "Total", severity: "S2", description: "x".repeat(MAX_DEFECT_DESCRIPTION + 1), test: TEST }),
      `The description of a defect is ${MAX_DEFECT_DESCRIPTION} characters at most.`,
    );
    for (const test of [undefined, { path: TEST.path }, { title: TEST.title }]) {
      assert.equal(defectReportOf({ title: "Total", severity: "S2", test }), "A defect names the test it is reported from: { path, title }.");
    }
  });
});

describe("a change of a defect, as a client sends it", () => {
  it("is open, fixed or closed, and nothing else", () => {
    assert.deepEqual(
      ["open", "fixed", "closed"].map((status) => defectStatusOf({ status })),
      [{ status: "open" }, { status: "fixed" }, { status: "closed" }],
    );
    for (const body of [{ status: "done" }, "fixed", null])
      assert.equal(defectStatusOf(body), 'A change of a defect is { "status" }, one of "open", "fixed" and "closed".');
  });
});
