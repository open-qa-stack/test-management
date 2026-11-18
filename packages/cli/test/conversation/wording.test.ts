import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { Session, SessionPhase } from "@open-qa-stack/domain/sessions";
import { elapsedText, sinceText, standing } from "../../src/solo/conversation/session-facts.ts";
import { toolTitle } from "../../src/solo/conversation/tool-title.ts";
import { WORDING } from "../../src/solo/conversation/wording.ts";
import { COMPLETED, FAILED, RUNNING } from "./fixtures.ts";

describe("what a tool call did, as the terminal words it", () => {
  it("is a sentence in the past tense for each tool the command knows", () => {
    const cases: readonly (readonly [string, unknown, string])[] = [
      ["customer_self_service_goto", { url: "/login" }, "Opened /login in customer-self-service"],
      ["shop_click", { target: { name: "Log in" } }, 'Clicked "Log in" in shop'],
      ["shop_click", { target: { text: "Sign up" } }, 'Clicked "Sign up" in shop'],
      ["shop_click", {}, 'Clicked "an element" in shop'],
      ["shop_goto", null, "Opened  in shop"],
      ["shop_fill", "anything", 'Typed a value in "an element"'],
      ["shop_fill", { target: { name: "Email" }, value: "a@b.c" }, 'Typed "a@b.c" in "Email"'],
      ["shop_fill", { target: { name: "Email" } }, 'Typed a value in "Email"'],
      ["shop_select_option", { option: "Paris" }, 'Chose "Paris"'],
      ["shop_check", { target: { name: "Terms" } }, 'Checked "Terms"'],
      ["shop_snapshot", {}, "Looked at the page of shop"],
      ["shop_screenshot", {}, "Captured the screen of shop"],
      ["orders_db_list_tables", {}, "Listed the tables of orders"],
      ["orders_db_describe_table", { table: "orders" }, "Described the table orders"],
      ["orders_db_sample_rows", { table: "orders" }, "Read rows of the table orders"],
      ["shop_api_list_operations", {}, "Listed the operations of the API of shop"],
      ["shop_api_read_operation", { method: "GET", path: "/orders" }, "Read the operation GET /orders"],
      ["specs_list_files", {}, "Listed the files of specs"],
      ["specs_read_file", { path: "orders.md" }, "Read orders.md"],
      ["order_specs_read_file", {}, "Read a file of order-specs"],
      ["order_specs_read_section", { number: 2 }, "Read section 2 of order-specs"],
      ["order_specs_read_section", { file: "orders.md", number: 2 }, "Read section 2 of orders.md"],
      ["knowledge_domain", { domain: "orders" }, "Read the domain orders"],
      ["knowledge_list", { words: "refund" }, "Searched the knowledge: refund"],
      ["knowledge_read", { item: "orders/refund" }, "Read orders/refund"],
      ["tests_list", {}, "Looked for the existing tests"],
      ["tests_read", { path: "a.spec.ts" }, "Read the test a.spec.ts"],
      ["propose_plan", { scenarios: [{}, {}] }, "Proposed a plan of 2 scenarios"],
      ["propose_plan", { scenarios: [{}] }, "Proposed a plan of 1 scenario"],
      ["propose_plan", null, "Proposed a plan of 0 scenarios"],
      ["run_test", {}, "Ran the test"],
      ["propose_test", {}, "Handed in the test"],
      ["report_duplicates", { duplicates: [{}] }, "Reported 1 duplicate"],
      ["report_findings", { findings: [] }, "Reported 0 coherence findings"],
      ["report_quality", { findings: [{}, {}] }, "Reported 2 remarks on the code"],
      ["remember", {}, "Noted something for later"],
      ["recall", {}, "Read what was noted"],
      ["write_domain", { id: "orders" }, "Wrote the domain orders"],
      ["submit_index", { domains: [{}] }, "Handed in an index of 1 domain"],
    ];
    for (const [tool, args, title] of cases) assert.equal(toolTitle(tool, args), title, tool);
  });

  it("names a value typed from a test account, and never shows it", () => {
    assert.equal(
      toolTitle("shop_fill", { target: { name: "Password" }, value: { account: "demo", field: "password" } }),
      'Typed the password of the account demo in "Password"',
    );
  });

  it("is the name of the tool and its arguments for a tool the command does not know", () => {
    assert.equal(toolTitle("something_else", { a: 1 }), 'something_else {"a":1}');
    assert.equal(toolTitle("something_else", undefined), "something_else {}");
  });
});

describe("the words of the terminal for a thread", () => {
  it("name each phase, and one they do not know a step", () => {
    assert.deepEqual(
      (
        [
          "configuration",
          "prerequisites",
          "survey",
          "card",
          "consolidation",
          "index",
          "plan",
          "review",
          "write",
          "execution",
          "summary",
          "later",
        ] as SessionPhase[]
      ).map(WORDING.phase),
      [
        "Configuration",
        "Prerequisites",
        "Cartography · sources",
        "Cartography · card",
        "Cartography · domains",
        "Cartography · index",
        "Plan",
        "Plan review",
        "Writing a test",
        "Running the tests",
        "Summary",
        "Step",
      ],
    );
  });

  it("count what a session produced, title a session nobody asked anything in, and word a tool call", () => {
    assert.deepEqual([WORDING.verdicts(1), WORDING.verdicts(3)], ["Verdicts of the run: 1 test", "Verdicts of the run: 3 tests"]);
    assert.deepEqual([WORDING.closed(1), WORDING.closed(2)], ["1 test closed by the harness", "2 tests closed by the harness"]);
    assert.equal(WORDING.opened("2026-11-13", "14:44:05"), "Session of 2026-11-13 at 14:44:05 UTC");
    assert.equal(WORDING.tool("run_test", {}), "Ran the test");
  });
});

describe("how a session stands", () => {
  it("is its state while it goes on or when it was interrupted, how it ended otherwise, and ended when nothing tells how", () => {
    const stopped: Session = { ...COMPLETED, result: { ...COMPLETED.result!, outcome: "stopped" } };
    const inconclusive: Session = { ...COMPLETED, result: { ...COMPLETED.result!, outcome: "inconclusive" } };
    const unknown: Session = { ...COMPLETED, result: { ...COMPLETED.result!, outcome: "later" as "passed" } };
    const { result: _none, ...unresulted } = COMPLETED;
    assert.deepEqual(
      [
        { ...RUNNING, state: "queued" as const },
        RUNNING,
        { ...RUNNING, state: "interrupted" as const },
        COMPLETED,
        FAILED,
        inconclusive,
        stopped,
        unknown,
        unresulted,
      ].map(standing),
      ["queued", "running", "interrupted", "tests passed", "a test failed", "a test has no verdict", "stopped before the end", "ended", "ended"],
    );
  });
});

describe("a duration, as a person reads it", () => {
  it("is in milliseconds under a second, in seconds with a decimal under a minute, in minutes and seconds beyond", () => {
    assert.deepEqual([0, 849.6, 1000, 12_340, 59_999, 60_000, 185_400].map(elapsedText), [
      "0 ms",
      "850 ms",
      "1.0 s",
      "12.3 s",
      "60.0 s",
      "1 min 00 s",
      "3 min 05 s",
    ]);
  });

  it("is in whole seconds, then in minutes and seconds, for what goes on", () => {
    assert.deepEqual([0, 400, 12_340, 59_400, 60_000, 185_400].map(sinceText), ["0 s", "0 s", "12 s", "59 s", "1 min 00 s", "3 min 05 s"]);
  });
});
