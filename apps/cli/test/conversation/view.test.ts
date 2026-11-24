import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { Session } from "@open-qa-stack/domain/sessions";
import { initialState } from "../../src/solo/conversation/conversation-state.ts";
import { after, COMPLETED, FAILED, NOW, RUNNING, showing, THREAD, type EventBody, endOf } from "./fixtures.ts";
import { PLAIN, screenOf, WIDTHS, widthOf } from "./screen.ts";

const HOME = after([]);
const LIVE = showing();

/** The lines of a screen from the first that holds a text on. */
function from(lines: readonly string[], text: string): readonly string[] {
  const index = lines.findIndex((line) => line.includes(text));
  assert.notEqual(index, -1, `${text}\n${lines.join("\n")}`);
  return lines.slice(index);
}

/** Checks that no line of a screen is wider than the terminal. */
function fits(lines: readonly string[], width: number): void {
  for (const line of lines) assert.ok(widthOf(line) <= width, `${widthOf(line)} > ${width}: ${line}`);
}

describe("the start of the conversation", () => {
  for (const width of WIDTHS)
    it(`shows the banner, the latest sessions, the input and its keys, at ${width} columns`, () => {
      const lines = screenOf(HOME, width);
      fits(lines, width);
      assert.deepEqual(lines.slice(0, 3), ["Open QA Stack · shop-tests", "/work/shop-tests", "environment local · database SQLite"]);
      assert.deepEqual(from(lines, "Latest sessions").slice(0, 3), [
        "Latest sessions",
        "  0a1b2c3d  running  Test the search of a customer.",
        "  9f8e7d6c  a test failed  Test the returns of an order.",
      ]);
      assert.deepEqual(lines.slice(-3), ["", "›  What do we test?", "  Enter open a session · / commands · Ctrl-C quit"]);
    });

  it("says there is no session yet in a repository that has none, and which environment is the default one", () => {
    const lines = screenOf(initialState([], NOW), 100);
    assert.ok(lines.includes("No session yet."));
    assert.ok(!lines.includes("Latest sessions"));
  });

  it("cuts the path of a repository that is longer than the line from its start, and a session of the list at its end", () => {
    const long: Session = { ...FAILED, request: "Test the returns of an order, the refunds, the exchanges and every notification they send." };
    const lines = screenOf(initialState([long], NOW), 60);
    fits(lines, 60);
    assert.match(
      lines.find((line) => line.includes("9f8e7d6c"))!,
      /^ {2}9f8e7d6c {2}a test failed {2}Test the returns of an order, th.*…$/,
    );
  });
});

describe("the thread of a session that goes on", () => {
  for (const width of WIDTHS)
    it(`tells the same story as the console, block by block, at ${width} columns`, () => {
      const lines = screenOf(LIVE, width);
      fits(lines, width);
      const thread = from(lines, "Session session-");
      assert.match(thread[0]!, /^Session session-2026-11-13T14-44-05-000Z-0a1b2c3d · opened/);
      // The request of the person, then each phase as a rule across the width.
      assert.deepEqual(from(thread, "› You").slice(0, 2), ["› You", "  Test the search of a customer."]);
      assert.equal(
        thread.find((line) => line.startsWith("── Configuration")),
        `── Configuration ${"─".repeat(width - 17)}`,
      );
      assert.equal(
        thread.find((line) => line.startsWith("── Plan")),
        `── Plan · smoke ${"─".repeat(width - 16)}`,
      );
      // What the harness asks of an agent, then the agent, named once for what it thinks, does and says in a row.
      assert.deepEqual(from(thread, "■ Harness → Planner").slice(0, 2), ["■ Harness → Planner", "  Plan Playwright tests for the environment local."]);
      assert.deepEqual(from(thread, "◆ Planner").slice(0, 5), [
        "◆ Planner",
        "  thinks: I should open the application first.",
        "  · Opened /customers in shop · 900 ms",
        "  ✗ Proposed a plan of 1 scenario · 40 ms",
        "    The plan names no element of the page.",
      ]);
      // A refusal of the harness, as every verdict: its author, the kind of judge it is, the code of its gate, what was refused and what to do.
      assert.equal(from(thread, "■ Harness · automatic")[0], "■ Harness · automatic check · refused · PLAN-ELEMENT · Plan");
      assert.equal(from(thread, "■ Harness · automatic")[1], "  The plan was refused");
      assert.match(from(thread, "■ Harness · automatic")[2]!, /^ {2}name the element each step acts on,/);
      // The plan the harness accepted, as a short list.
      assert.deepEqual(from(thread, "✓ Plan accepted").slice(0, 3), [
        "✓ Plan accepted by the harness · 2 scenarios",
        "  1. smoke Search a customer by name · nominal · shop",
        "  2. smoke Open the profile of a customer",
      ]);
      // A message of the person, with its number and where it is; a part of a pass; an action that goes on.
      assert.deepEqual(from(thread, "› You · message 1").slice(0, 3), ["› You · message 1", "  Leave the archived customers out.", "  waiting for an agent"]);
      assert.ok(thread.includes("── Writing a test · search"));
      assert.deepEqual(from(thread, "● Writer").slice(0, 2), ["● Writer", "  ⠋ Ran the test"]);
      // The state of the session, the input and its keys.
      assert.deepEqual(thread.slice(-4), [
        "",
        "⠋ running · Writing a test · search · Writer · 0 s",
        "›  Say something to the agents",
        "  Enter send · / commands · Ctrl-C stop",
      ]);
    });

  it("says how long ago the session was opened, and nothing of a pass or an agent before the first", () => {
    const state = after([{ type: "ticked", now: NOW + 75_000 }], showing(THREAD.slice(0, 2)));
    assert.equal(screenOf(state, 100).at(-3), "⠋ running · 1 min 15 s");
    assert.equal(screenOf(showing([]), 100).at(-3), "⠋ queued · 0 s");
  });

  it("cuts to the line what must stay on one: an action and its failure", () => {
    const long = "customers ".repeat(12);
    const events: readonly EventBody[] = [
      { type: "action_started", action: "a", agent: "planner", tool: "shop_goto", arguments: { url: `/${long}` } },
      { type: "action_finished", action: "a", outcome: "failed", result: `No page at ${long}`, durationMs: 1200 },
      { type: "agent_message", agent: "planner", text: `Thinking of ${long}${long}`, reasoning: true },
      { type: "harness_message", to: "writer", text: `Write ${long}${long}${long}` },
    ];
    const lines = screenOf(showing(events), 60);
    fits(lines, 60);
    assert.match(
      lines.find((line) => line.includes("Opened"))!,
      /^ {2}✗ Opened \/customers customers .*… · 1\.2 s$/,
    );
    assert.match(
      lines.find((line) => line.includes("No page at"))!,
      /^ {4}No page at customers .*…$/,
    );
    // A reasoning and a request of the harness are cut to a length, then wrap.
    assert.equal(lines.filter((line) => line.includes("…")).length, 4);
  });

  it("writes each scenario of a plan in full, wrapped: its line, its intent, its facts, its sources, its data and each step with what it expects", () => {
    const events: readonly EventBody[] = [
      {
        type: "plan_accepted",
        scenarios: [
          {
            id: "search",
            title: `Search ${"customers ".repeat(6)}by name`,
            level: "functional",
            case: "negative",
            application: "shop",
            intent: "Finds no customer for an unknown name.",
            kind: "functional",
            effect: "write",
            domain: "customers",
            feature: "customer-search",
            sources: [{ source: "specs", item: "Search" }, { source: "shop" }],
            data: [{ value: "Zed", from: "made-up" }],
            steps: [
              {
                action: "Search Zed.",
                expects: [
                  { result: "Nothing is listed.", shows: ["No customer"], absent: ["Ada"] },
                  { result: "It stays.", shows: [], absent: [] },
                ],
              },
              { action: "Clear the search.", expects: [], restores: true },
            ],
          },
          { id: "open", title: "Open a customer", level: "smoke", kind: "functional", data: [] },
        ],
      },
    ];
    const lines = screenOf(showing(events), 60);
    fits(lines, 60);
    assert.deepEqual(from(lines, "✓ Plan accepted").slice(0, 16), [
      "✓ Plan accepted by the harness · 2 scenarios",
      "  1. functional Search customers customers customers",
      "  customers customers customers by name · negative · shop",
      "    Finds no customer for an unknown name.",
      "    search · functional · write · customers/customer-search",
      "    Sources: specs Search, shop",
      '    Data: "Zed" (made-up)',
      "    Step 1. Search Zed.",
      "    → Nothing is listed.",
      '      shows: "No customer"',
      '      no longer shows: "Ada"',
      "    → It stays.",
      "    Step 2. Clear the search. (restores)",
      "  2. smoke Open a customer",
      "    open · functional",
      "    Data: none entered",
    ]);
    const one = screenOf(showing([{ type: "plan_accepted", scenarios: [{ id: "open", title: "Open a customer", level: "smoke" }] }]), 60);
    assert.deepEqual(from(one, "✓ Plan accepted").slice(0, 2), ["✓ Plan accepted by the harness · 1 scenario", "  1. smoke Open a customer"]);
  });

  it("writes a row of notes alike on one line, with how many sources, then the sources", () => {
    const kept = (source: string): readonly EventBody[] => [
      { type: "phase_started", phase: "card", source },
      { type: "note", phase: "card", text: `The card of ${source} is up to date; it was kept.` },
    ];
    const lines = screenOf(showing([...kept("orders-api"), ...kept("orders-db"), ...kept("orders-specs")]), 100);
    fits(lines, 100);
    assert.deepEqual(from(lines, "The card of").slice(0, 2), [
      "■ The card of … is up to date; it was kept. · 3 sources",
      "  orders-api, orders-db, orders-specs",
    ]);
  });

  it("writes the verdict of a reviewer under its name, each remark in full, without the call nor the word it replied", () => {
    const remark = "The asserted total of 50 customers is environment data that can change, so the test breaks when a customer is added.";
    const lines = screenOf(
      showing([
        {
          type: "action_started",
          action: "d",
          agent: "plan_reviewer",
          tool: "report_duplicates",
          arguments: { duplicates: [{ id: "b", of: "a.spec.ts", reason: "Same." }] },
        },
        { type: "action_finished", action: "d", outcome: "failed", result: "Refused.", durationMs: 6 },
        { type: "phase_started", phase: "write", scenario: "search" },
        {
          type: "action_started",
          action: "q",
          agent: "code_reviewer",
          tool: "report_quality",
          arguments: { findings: [{ where: "Step 1", what: remark, rule: "PW-DATA-01", concerns: "plan" }, { what: "No screenshot." }] },
        },
        { type: "action_finished", action: "q", outcome: "done", result: "Recorded. Answer with one word; call no more tools.", durationMs: 6 },
        { type: "agent_message", agent: "code_reviewer", text: "Done", reasoning: false },
        { type: "action_started", action: "c", agent: "coherence_reviewer", tool: "report_findings", arguments: { findings: [] } },
      ]),
      60,
    );
    fits(lines, 60);
    const text = lines.join("\n");
    assert.match(text, /□ Code reviewer · agent · reviewed the test of search: 2\s+remarks/);
    assert.match(
      text.replace(/\s+/g, " "),
      /- Step 1 \(PW-DATA-01\) \[plan\]: The asserted total of 50 customers is environment data that can change, so the test breaks when a customer is added\. - No screenshot\./,
    );
    assert.match(text.replace(/\s+/g, " "), /Plan reviewer · agent · reviewed the plan: 1 duplicate, not taken by the harness - b repeats a\.spec\.ts: Same\./);
    assert.match(text.replace(/\s+/g, " "), /Coherence reviewer · agent · reviewed the test of search: no remark, handing it in/);
    assert.doesNotMatch(text, /Recorded|Done/);
  });

  it("names the message of the person delivered once an agent took it, the notes of the harness under one mark, and an error no gate gave as an error of the harness", () => {
    const lines = screenOf(
      showing([
        ...THREAD,
        { type: "message_delivered", message: 1, agent: "plan_reviewer" },
        { type: "note", phase: "write", text: "The scenario search was opened." },
        { type: "note", phase: "write", text: "Its test is tests/search.spec.ts." },
        { type: "refusal", phase: "write", text: "The design stopped: the run was asked to stop." },
      ]),
      100,
    );
    assert.equal(from(lines, "› You · message 1")[2], "  delivered to the plan reviewer");
    assert.deepEqual(from(lines, "■ The scenario search").slice(0, 2), ["■ The scenario search was opened.", "  Its test is tests/search.spec.ts."]);
    assert.deepEqual(from(lines, "■ Harness · automatic check · error").slice(0, 3), [
      "■ Harness · automatic check · error · Writing a test",
      "  The design stopped",
      "  the run was asked to stop.",
    ]);
  });
});

describe("the scope of a session", () => {
  it("writes the levels asked, the applications and the environment, then where the levels are asked", () => {
    const lines = screenOf(showing([{ type: "scope_resolved", environment: "local", applications: ["shop", "back-office"], levels: ["functional"] }]), 100);
    assert.deepEqual(from(lines, "Scope of the session").slice(0, 5), [
      "  Scope of the session",
      "  Levels asked: functional",
      "  Applications: shop, back-office",
      "  Environment: local",
      "  Only these levels are designed: design.levels in the configuration sets them.",
    ]);
  });
});

describe("a verdict of the harness", () => {
  it("names the scenario and the tool it is about, and writes the page it quotes in full, under what to do", () => {
    const text = 'shop_click: The button matches two elements.\n\nThe page is now at http://localhost:3000/:\n- heading "Orders"\n  - button "Search"';
    const lines = screenOf(showing([{ type: "refusal", phase: "write", scenario: "search", text }]), 100);
    assert.deepEqual(from(lines, "■ Harness · automatic").slice(0, 5), [
      "■ Harness · automatic check · error · Writing a test · scenario search · tool shop_click",
      "  The button matches two elements.",
      "  The page was at http://localhost:3000/:",
      '  - heading "Orders"',
      '    - button "Search"',
    ]);
  });
});

describe("the thread of a session that ended", () => {
  for (const width of WIDTHS)
    it(`closes on the verdict of each test and on what the session came to, at ${width} columns`, () => {
      const lines = screenOf(after(endOf(COMPLETED), LIVE), width);
      fits(lines, width);
      // An action whose tool never answered is written as ended, and spins no more.
      assert.deepEqual(from(lines, "● Writer").slice(0, 2), ["● Writer", "  · Ran the test"]);
      assert.deepEqual(from(lines, "Verdicts of the run").slice(0, 3), [
        "  Verdicts of the run: 2 tests",
        "✓ passed  searches a customer",
        "✓ passed  opens a customer",
      ]);
      const summary = from(lines, "Session completed");
      assert.equal(summary[0], "Session completed · tests passed");
      assert.match(summary.slice(1, 3).join(" "), /^1 min 12 s · 17 model requests · 2 of 2 tests passed · branch oqas\/design-20261113T144405Z/);
      assert.deepEqual(lines.slice(-3), ["", "›  What do the agents do next?", "  Enter go on · /new another session · Ctrl-C quit"]);
    });

  it("says why a test did not pass, marks a verdict that is neither a success nor a failure, and counts what passed", () => {
    const mixed: Session = {
      ...COMPLETED,
      result: {
        outcome: "failed",
        durationMs: 900,
        modelRequests: 1,
        tests: [
          { id: "searches", verdict: "passed", reason: "It passed." },
          { id: "opens", verdict: "failed", reason: "The total is wrong." },
          { id: "exports", verdict: "not_run", reason: "The application did not answer." },
        ],
      },
    };
    const lines = screenOf(after(endOf(mixed), LIVE), 100);
    assert.deepEqual(from(lines, "Verdicts of the run").slice(1, 6), [
      "✓ passed  searches",
      "✗ failed  opens",
      "  The total is wrong.",
      "! not run  exports",
      "  The application did not answer.",
    ]);
    assert.deepEqual(from(lines, "Session completed").slice(0, 2), ["Session completed · a test failed", "900 ms · 1 model request · 1 of 3 tests passed"]);
  });

  it("says a session was interrupted, which has no fact to give, and closes on the scenarios the harness closed", () => {
    const events: readonly EventBody[] = [
      ...THREAD,
      { type: "scenario_closed", scenario: "search", level: "smoke", verdict: "passed" },
      { type: "state_changed", state: "interrupted" },
    ];
    const lines = screenOf(after([{ type: "ended", session: { ...RUNNING, state: "interrupted" } }], showing(events)), 100);
    assert.deepEqual(from(lines, "1 test closed by the harness").slice(0, 2), ["  1 test closed by the harness", "✓ passed  search"]);
    assert.deepEqual(from(lines, "Session interrupted").slice(0, 2), ["Session interrupted", ""]);
  });

  it("gives the facts of a session that produced no test, in the singular when it has one", () => {
    const empty: Session = { ...COMPLETED, result: { outcome: "stopped", durationMs: 2000, modelRequests: 2, tests: [] } };
    assert.deepEqual(from(screenOf(after(endOf(empty), LIVE), 100), "Session completed").slice(0, 2), [
      "Session completed · stopped before the end",
      "2.0 s · 2 model requests",
    ]);
    const one: Session = { ...COMPLETED, result: { ...COMPLETED.result!, tests: COMPLETED.result!.tests.slice(0, 1) } };
    assert.match(from(screenOf(after(endOf(one), LIVE), 100), "Session completed")[1]!, / · 1 of 1 test passed · /);
  });
});

describe("what stands over the input", () => {
  for (const width of WIDTHS)
    it(`is the picker of a session, the selected one pointed at, or the confirmation of a stop, at ${width} columns`, () => {
      const passed: Session = { ...COMPLETED, id: "session-2026-11-11T08-00-00-000Z-5e5e5e5e" };
      const picker = screenOf(
        after([
          { type: "listed", sessions: [RUNNING, FAILED, passed] },
          { type: "moved", by: 1 },
        ]),
        width,
      );
      fits(picker, width);
      assert.deepEqual(picker.slice(-5), [
        "Reopen a session",
        "  0a1b2c3d  running  Test the search of a customer.",
        "❯ 9f8e7d6c  a test failed  Test the returns of an order.",
        "  5e5e5e5e  tests passed  Test the search of a customer.",
        "  Up/Down select · Enter open · Esc close",
      ]);
      const stop = screenOf(after([{ type: "submitted", request: { kind: "stop", session: RUNNING.id } }], LIVE), width);
      fits(stop, width);
      const question = from(stop, "Stop the session");
      assert.match(
        question.join(" ").replace(/\s+/g, " "),
        /^Stop the session session-2026-11-13T14-44-05-000Z-0a1b2c3d\? Its agents stop as soon as they hand over, and the session does not resume\. What they wrote stays in the test repository\. Enter stop it · Esc keep it going$/,
      );
      // The input is not drawn under what stands over it.
      assert.ok(!stop.some((line) => line.startsWith("›") && !line.startsWith("› You")));
    });

  it("lists a session that waits, one that was interrupted and one nothing was asked in, each as it stands", () => {
    const { request: _unasked, ...unasked } = { ...RUNNING, state: "interrupted" as const, id: "session-0000000-7777aaaa" };
    const lines = screenOf(after([{ type: "listed", sessions: [{ ...RUNNING, state: "queued" }, unasked] }]), 100);
    assert.deepEqual(lines.slice(-3, -1), ["❯ 0a1b2c3d  queued  Test the search of a customer.", "  7777aaaa  interrupted"]);
  });

  it("lists a session that maps the knowledge as such", () => {
    const { request: _none, ...mapping } = { ...RUNNING, purpose: "map" as const };
    const lines = screenOf(after([{ type: "listed", sessions: [mapping] }]), 100);
    assert.equal(lines.at(-2), "❯ 0a1b2c3d  running  mapping of the knowledge");
  });
});

describe("what the conversation tells around a thread", () => {
  for (const width of WIDTHS)
    it(`hints the commands being typed, writes the help, an error and a notice, at ${width} columns`, () => {
      const hinted = screenOf(after([{ type: "typed", input: "/s" }]), width);
      fits(hinted, width);
      assert.equal(hinted.at(-4), "› /s");
      assert.match(hinted.at(-3)!, /^❯ \/sessions {3}Pick a session and reopen its thread/);
      assert.match(hinted.at(-2)!, /^ {2}\/stop {7}Stop the session on screen/);
      assert.match(hinted.at(-1)!, /^ {2}\/secrets {4}List the variables the configuration names/);
      assert.match(screenOf(after([{ type: "typed", input: "/u" }]), width).at(-1)!, /^❯ \/ui \[port\] {2}Serve the web console/);

      const told = screenOf(
        after([
          { type: "submitted", request: { kind: "help" } },
          { type: "failed", why: "No session x; oqas sessions lists them." },
          { type: "served", url: "http://127.0.0.1:6727" },
          { type: "interrupted" },
        ]),
        width,
      );
      fits(told, width);
      assert.match(from(told, "Commands").slice(1, 3).join(" "), /^\/sessions {7}Pick a session and reopen its thread; one/);
      assert.ok(from(told, "Keys").some((line) => line.startsWith("Ctrl-C          Clear the input;")));
      assert.ok(told.includes("✗ No session x; oqas sessions lists them."));
      assert.match(
        from(told, "  The web console is served at").slice(0, 2).join(" ").replace(/\s+/g, " "),
        /^ The web console is served at http:\/\/127\.0\.0\.1:6727 until you leave\./,
      );
      assert.deepEqual(told.slice(-3), ["Press Ctrl-C again to quit.", "›  What do we test?", "  Enter open a session · / commands · Ctrl-C quit"]);
    });
});

describe("a terminal that draws ASCII alone, without colour", () => {
  it("draws every mark, rule and state of the conversation in ASCII, each speaker still told by its mark and its name", () => {
    const lines = screenOf(after([{ type: "listed", sessions: [RUNNING] }], LIVE), 60, PLAIN);
    fits(lines, 60);
    for (const head of ["> You", "| Harness -> Planner", "* Planner", "+ Writer", "> You - message 1"]) assert.ok(lines.includes(head), head);
    assert.equal(
      lines.find((line) => line.startsWith("-- Configuration")),
      `-- Configuration ${"-".repeat(43)}`,
    );
    assert.ok(lines.includes("| Harness - automatic check - refused - PLAN-ELEMENT - Plan"));
    assert.ok(lines.includes("+ Plan accepted by the harness - 2 scenarios"));
    assert.ok(lines.includes("  x Proposed a plan of 1 scenario - 40 ms"));
    assert.ok(lines.includes("  + Proposed a plan of 2 scenarios - 35 ms"));
    assert.ok(lines.includes("  - Opened /customers in shop - 900 ms"));
    assert.equal(lines.at(-5), "- running - Writing a test - search - Writer - 0 s");
    assert.deepEqual(lines.slice(-2), ["> 0a1b2c3d  running  Test the search of a customer.", "  Up/Down select - Enter open - Esc close"]);
    // What is left beyond ASCII is what the thread itself holds, never what the conversation draws around it.
    const drawn = lines.filter((line) => !line.includes("·"));
    assert.ok(
      drawn.length > 30 && drawn.every((line) => /^[\x20-\x7e]*$/.test(line)),
      drawn.find((line) => !/^[\x20-\x7e]*$/.test(line)),
    );
  });
});
