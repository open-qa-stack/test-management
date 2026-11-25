import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { lockedPlaywrightVersion, networkFailureAddresses, testVerdicts, type ReportedTest, type RunFacts } from "../src/index.ts";

const APP = "http://localhost:3010";
const listed = (...ids: string[]) => ids.map((id) => ({ id, file: `${id}.spec.ts`, project: "shop" }));
const reported = (
  id: string,
  status: ReportedTest["status"],
  attempts: ReportedTest["attempts"],
  expectedStatus: ReportedTest["expectedStatus"] = "passed",
): ReportedTest => ({ id, status, expectedStatus, attempts });
const facts = (tests: readonly ReportedTest[] | undefined, unreachable: readonly string[] = []): RunFacts => ({
  listed: listed(...(tests ?? []).map((t) => t.id), "absent"),
  ...(tests === undefined ? {} : { reported: tests }),
  addresses: [APP],
  unreachable: new Set(unreachable),
});
const verdictOf = (test: ReportedTest, unreachable: readonly string[] = []) => testVerdicts(facts([test], unreachable))[0]!;
const refused = `page.goto: net::ERR_CONNECTION_REFUSED at ${APP}/policies`;

describe("criterion 1 — the version is the one the lockfile installs", () => {
  it("reads the installed version of two versions, not the declared range", () => {
    const lock = (version: string) =>
      JSON.stringify({ packages: { "": { devDependencies: { "@playwright/test": "^1.0.0" } }, "node_modules/@playwright/test": { version } } });
    assert.deepEqual([lockedPlaywrightVersion(lock("1.64.1")), lockedPlaywrightVersion(lock("1.65.0"))], ["1.64.1", "1.65.0"]);
  });

  it("reads no version from a lockfile that cannot be read or does not install the package", () => {
    for (const text of [
      "",
      "{",
      "null",
      "{}",
      JSON.stringify({ packages: {} }),
      JSON.stringify({ packages: { "node_modules/@playwright/test": { version: 1 } } }),
    ])
      assert.equal(lockedPlaywrightVersion(text), undefined, text);
  });
});

describe("criterion 5 — each line of the mapping gives its verdict", () => {
  it("passed: expected, with attempts that all passed", () => {
    assert.equal(verdictOf(reported("a", "expected", [{ status: "passed", errors: [] }])).verdict, "passed");
  });

  it("indeterminate: expected without an attempt, or with one that did not pass", () => {
    assert.equal(verdictOf(reported("a", "expected", [])).verdict, "indeterminate");
    assert.equal(
      verdictOf(
        reported("a", "expected", [
          { status: "passed", errors: [] },
          { status: "skipped", errors: [] },
        ]),
      ).verdict,
      "indeterminate",
    );
  });

  it("failed: unexpected, with its first error line as reason, or without an error", () => {
    const failed = verdictOf(
      reported("a", "unexpected", [{ status: "failed", errors: ["\u001b[2mexpect(\u001b[22m\u001b[31mlocator\u001b[39m).toBeVisible() failed\nLocator: …"] }]),
    );
    assert.deepEqual([failed.verdict, failed.reason], ["failed", "Failed: expect(locator).toBeVisible() failed"]);
    assert.equal(verdictOf(reported("a", "unexpected", [{ status: "timedOut", errors: [] }])).reason, "Failed, without an error message.");
  });

  it("skipped: skipped for a reason the test gives, which the verdict repeats", () => {
    const test = { ...reported("a", "skipped", [{ status: "skipped", errors: [] }]), skippedFor: "No data here" };
    assert.deepEqual(verdictOf(test), { id: "a", verdict: "skipped", reason: "Skipped: No data here" });
  });

  it("indeterminate: skipped, with nothing that says why", () => {
    assert.deepEqual(verdictOf(reported("a", "skipped", [{ status: "skipped", errors: [] }])), {
      id: "a",
      verdict: "indeterminate",
      reason: "Skipped, and nothing in the report says why.",
    });
  });

  it("blocked: a network error towards a declared address that the check after the run found unreachable", () => {
    const test = reported("a", "unexpected", [{ status: "failed", errors: [refused] }]);
    assert.deepEqual(verdictOf(test, [APP]), { id: "a", verdict: "blocked", reason: `${APP} does not answer: the test could not run.` });
  });

  it("indeterminate: a network error towards a declared address that answered again after the run", () => {
    assert.equal(verdictOf(reported("a", "unexpected", [{ status: "failed", errors: [refused] }])).verdict, "indeterminate");
  });

  it("failed: an error that names a declared address, the server answered, or the navigation was cut", () => {
    for (const error of [
      `expected ${APP} to show the policies`,
      `page.goto: net::ERR_HTTP_RESPONSE_CODE_FAILURE at ${APP}/`,
      `page.goto: net::ERR_ABORTED at ${APP}/`,
    ]) {
      assert.equal(verdictOf(reported("a", "unexpected", [{ status: "failed", errors: [error] }]), [APP]).verdict, "failed", error);
    }
  });

  it("failed: a network error towards an address that only starts like a declared one", () => {
    assert.equal(verdictOf(reported("a", "unexpected", [{ status: "failed", errors: [`net::ERR_CONNECTION_REFUSED at ${APP}0/`] }]), [APP]).verdict, "failed");
  });

  it("failed: a network error towards an address that is not declared", () => {
    assert.equal(
      verdictOf(reported("a", "unexpected", [{ status: "failed", errors: ["net::ERR_CONNECTION_REFUSED at http://elsewhere:1"] }]), [APP]).verdict,
      "failed",
    );
  });

  it("indeterminate: flaky, interrupted, or marked as expected to fail", () => {
    assert.equal(
      verdictOf(
        reported("a", "flaky", [
          { status: "failed", errors: ["x"] },
          { status: "passed", errors: [] },
        ]),
      ).verdict,
      "indeterminate",
    );
    assert.equal(verdictOf(reported("a", "unexpected", [{ status: "interrupted", errors: [] }])).verdict, "indeterminate");
    const expectedToFail = verdictOf(reported("a", "expected", [{ status: "failed", errors: ["x"] }], "failed"));
    assert.deepEqual([expectedToFail.verdict, expectedToFail.reason], ["indeterminate", "Marked as expected to end failed."]);
  });

  it("not_run: listed, but absent from the report", () => {
    const verdicts = testVerdicts(facts([reported("a", "expected", [{ status: "passed", errors: [] }])]));
    assert.deepEqual(
      verdicts.map((v) => [v.id, v.verdict]),
      [
        ["a", "passed"],
        ["absent", "not_run"],
      ],
    );
  });
});

describe("criterion 6 — without a readable JSON, no test is passed", () => {
  it("gives every listed test indeterminate", () => {
    assert.deepEqual(
      testVerdicts(facts(undefined)).map((v) => v.verdict),
      ["indeterminate"],
    );
  });
});

describe("the addresses to check again after a run", () => {
  it("are the declared addresses failed tests met a network error towards, each once", () => {
    const tests = [
      reported("a", "unexpected", [{ status: "failed", errors: [refused] }]),
      reported("b", "unexpected", [{ status: "failed", errors: [`net::ERR_NAME_NOT_RESOLVED ${APP}`] }]),
      reported("c", "expected", [{ status: "passed", errors: [refused] }]),
      reported("d", "unexpected", [{ status: "failed", errors: ["boom"] }]),
    ];
    assert.deepEqual(networkFailureAddresses(tests, [APP, "http://localhost:3020"]), [APP]);
    assert.deepEqual(networkFailureAddresses([reported("e", "unexpected", [{ status: "failed", errors: ["ECONNREFUSED shop:3010"] }])], ["shop:3010"]), [
      "shop:3010",
    ]);
  });
});
