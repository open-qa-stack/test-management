import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { qaViews, type JsonResult, type QaView } from "../src/index.ts";

/** A report of one test of the shop, its last attempt the one given, after an attempt that failed at once. */
function report(result: JsonResult, status = "expected"): string {
  return JSON.stringify({
    suites: [
      {
        title: "orders/search.spec.ts",
        file: "orders/search.spec.ts",
        specs: [
          {
            title: "Search an order",
            file: "orders/search.spec.ts",
            line: 3,
            tests: [{ projectName: "shop", status, expectedStatus: "passed", results: [{ status: "failed", steps: [] }, result] }],
          },
        ],
      },
    ],
  });
}

/** The one view of a report. */
function viewOf(json: string): QaView {
  const read = qaViews(json);
  assert.ok("views" in read);
  return read.views[0]!;
}

const step = (title: string, extra: object = {}) => ({ title, duration: 10, ...extra });
const capture = (name: string) => ({ name, contentType: "image/png", body: "iVBOR" });

describe("a test of a report read in steps", () => {
  it("numbers each step the test calls in the order of the report, with its exact title, its state and its duration", () => {
    const titles = Array.from({ length: 7 }, (_, at) => `${at + 1}. Do the step ${at + 1}`);
    const view = viewOf(report({ status: "passed", steps: titles.map((title) => step(title)), attachments: titles.map((_, at) => capture(String(at + 1))) }));
    assert.equal(view.id, "shop › orders/search.spec.ts:3 › Search an order");
    assert.deepEqual(
      view.steps.map(({ number, title, state, duration }) => [number, title, state, duration]),
      titles.map((title, at) => [at + 1, title, "passed", 10]),
    );
    assert.deepEqual([view.failedStep, view.uncaptured, view.expected], [undefined, [], undefined]);
    assert.deepEqual(view.steps[2]!.capture, { name: "3", contentType: "image/png" });
  });

  it("names the first step that failed, holds the steps a step holds without numbering them, and says which steps have no capture", () => {
    const view = viewOf(
      report(
        {
          status: "failed",
          steps: [
            // A step the report gives no duration of took none it measured.
            step("1. Open the orders", { steps: [step("Fill the search"), { title: "Press Enter" }] }),
            step("2. Read the order", { error: { message: "Error: the order" } }),
            step("3. Close it", { error: { message: "Error: later" } }),
          ],
          attachments: [capture("1"), { name: "2", path: "/runs/2.png" }, { name: "screenshot", contentType: "image/png", path: "/runs/end.png" }],
        },
        "unexpected",
      ),
    );
    assert.deepEqual([view.status, view.failedStep, view.uncaptured], ["unexpected", 2, [3]]);
    assert.deepEqual(
      view.steps[0]!.steps.map(({ number, title, duration }) => [number, title, duration]),
      [
        [undefined, "Fill the search", 10],
        [undefined, "Press Enter", 0],
      ],
    );
    assert.deepEqual(view.steps[1]!.capture, { name: "2", contentType: "application/octet-stream", path: "/runs/2.png" });
    assert.deepEqual(view.details.screenshots, ["/runs/end.png"]);
  });

  it("gives what the failed assertion expected and received when its message says both, and its whole message in the details", () => {
    const told = 'Error: \u001b[2mexpect(\u001b[22mlocator).toHaveText()\n\nExpected string: \u001b[32m"Lena Brook"\u001b[39m\nReceived string: "Mira Veldane"';
    const view = viewOf(
      report({
        status: "failed",
        errors: [{ message: told, stack: "Error: \u001b[2mat\u001b[22m search.spec.ts:9" }],
        stdout: [{ text: "searching\n" }, "found\n", {}],
        stderr: [{ text: "warned\n" }],
        attachments: [
          { name: "trace", contentType: "application/zip", path: "/runs/trace.zip" },
          { name: "error-context", contentType: "text/markdown", path: "/runs/error-context.md" },
        ],
      }),
    );
    assert.deepEqual([view.expected, view.received], ['"Lena Brook"', '"Mira Veldane"']);
    assert.deepEqual(view.details, {
      error: 'Error: expect(locator).toHaveText()\n\nExpected string: "Lena Brook"\nReceived string: "Mira Veldane"',
      stack: "Error: at search.spec.ts:9",
      stdout: ["searching\n", "found\n"],
      stderr: ["warned\n"],
      trace: "/runs/trace.zip",
      errorContext: "/runs/error-context.md",
      screenshots: [],
    });
    // A message that does not say what it received gives neither value: nothing is made up.
    const visible = viewOf(
      report({ status: "failed", errors: [{ message: "Error: expect(locator).toBeVisible() failed\n\nExpected: visible\nError: element(s) not found" }] }),
    );
    assert.deepEqual(
      [visible.expected, visible.received, visible.details.error?.startsWith("Error: expect(locator).toBeVisible()")],
      [undefined, undefined, true],
    );
  });

  it("has no step for a test that made no attempt", () => {
    const json = JSON.stringify({
      suites: [
        {
          title: "a",
          specs: [{ title: "t", file: "a.spec.ts", line: 1, tests: [{ projectName: "p", status: "skipped", expectedStatus: "skipped", results: [] }] }],
        },
      ],
    });
    assert.deepEqual(viewOf(json), {
      id: "p › a.spec.ts:1 › a › t",
      status: "skipped",
      steps: [],
      uncaptured: [],
      details: { stdout: [], stderr: [], screenshots: [] },
    });
  });
});

describe("a report that cannot be read in steps", () => {
  it("says why, empty or of another form, and holds no test", () => {
    assert.deepEqual(
      [qaViews(""), qaViews("  \n"), qaViews('{"suites": '), qaViews('{"tests": []}'), qaViews("null")],
      [
        { unavailable: "The report is empty." },
        { unavailable: "The report is empty." },
        { unavailable: "The report is no JSON of the Playwright reporter." },
        { unavailable: "The report is no JSON of the Playwright reporter." },
        { unavailable: "The report is no JSON of the Playwright reporter." },
      ],
    );
  });
});
