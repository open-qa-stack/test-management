import assert from "node:assert/strict";
import { at, delivered, entry, traced } from "@open-qa-stack/testing";
import { describe, it } from "vitest";
import { CONFIG_FILE_NAME, journalLine, RunThread, traceLine, type RunLine } from "../src/index.ts";
import type { SessionEvent } from "../src/sessions/index.ts";

/** A thread whose events are ranked from 1 in the order it tells them, as whoever keeps a thread ranks them. */
class RankedThread {
  readonly #thread = new RunThread();
  #last = 0;

  add(line: RunLine): SessionEvent[] {
    return this.#thread.add(line).map((event) => ({ id: ++this.#last, ...event }));
  }
}

/** The thread of the lines of a trace, read in the order they are given. */
function threadOf(lines: readonly string[]): SessionEvent[] {
  const thread = new RankedThread();
  return lines.flatMap((text) => {
    const line = traceLine(text);
    return line === undefined ? [] : thread.add(line);
  });
}

/** The events of a type among the events of a thread. */
function ofType<Type extends SessionEvent["type"]>(events: readonly SessionEvent[], type: Type): Extract<SessionEvent, { type: Type }>[] {
  return events.filter((event): event is Extract<SessionEvent, { type: Type }> => event.type === type);
}

/** What the command journals itself when the design cannot start: an error no trace tells. */
const CHANGED = `Tracked files are changed: ${CONFIG_FILE_NAME}.`;

const REQUEST = "Plan the tests.\n\nBrief of the developer, in their words:\n<brief>\ncover the profile\n</brief>\n\nKnowledge: …";

describe("a line of a trace", () => {
  it("is read with its date, its phase, who it is from, what happened and the source concerned", () => {
    assert.deepEqual(traceLine(traced(1, "card", "harness", { type: "started" }, "orders-db")), {
      at: at(1),
      phase: "card",
      actor: "harness",
      event: { type: "started" },
      source: "orders-db",
    });
    assert.deepEqual(traceLine(traced(2, "plan", "agent", { type: "text", text: "Read." })), {
      at: at(2),
      phase: "plan",
      actor: "agent",
      event: { type: "text", text: "Read." },
    });
  });

  it("has its date written in the one form dates are compared in", () => {
    const line = JSON.stringify({ at: "2026-11-14T10:00:01+01:00", phase: "plan", actor: "agent", event: { type: "end" } });
    assert.equal(traceLine(line)?.at, at(1));
  });

  it("is nothing when the text is no line of a trace of a known phase", () => {
    const whole = { at: at(1), phase: "plan", actor: "agent", event: { type: "text" } };
    for (const text of [
      "not a line",
      "null",
      "[]",
      "",
      JSON.stringify({ ...whole, at: undefined }),
      JSON.stringify({ ...whole, at: "yesterday" }),
      JSON.stringify({ ...whole, at: 3 }),
      JSON.stringify({ ...whole, phase: "release" }),
      JSON.stringify({ ...whole, phase: "configuration" }),
      JSON.stringify({ ...whole, actor: "command" }),
      JSON.stringify({ ...whole, event: "text" }),
      JSON.stringify({ ...whole, event: { text: "Without a type." } }),
    ]) {
      assert.equal(traceLine(text), undefined, text);
    }
  });

  it("leaves out a source that is no text", () => {
    const line = traceLine(JSON.stringify({ at: at(1), phase: "card", source: { a: 1 }, actor: "harness", event: { type: "started" } }));
    assert.deepEqual(line, { at: at(1), phase: "card", actor: "harness", event: { type: "started" } });
  });
});

describe("an entry of the journal of a run", () => {
  it("is read as the start of a step of the command, or as what the command journaled in it", () => {
    assert.deepEqual(journalLine(entry(1, "configuration", "started", "The configuration starts.")), {
      at: at(1),
      phase: "configuration",
      actor: "command",
      event: { type: "started" },
    });
    assert.deepEqual(journalLine(entry(2, "execution", "error", "The runner failed.")), {
      at: at(2),
      phase: "execution",
      actor: "command",
      event: { type: "journal", level: "error", message: "The runner failed." },
    });
    for (const event of ["info", "finished"]) {
      assert.deepEqual(journalLine(entry(3, "summary", event, "1 test passed."))?.event, { type: "journal", level: "info", message: "1 test passed." });
    }
  });

  it("is read, for an error of the cartography or of the design, under the first phase of the step", () => {
    assert.deepEqual(journalLine(entry(1, "design", "error", CHANGED)), {
      at: at(1),
      phase: "plan",
      actor: "command",
      event: { type: "journal", level: "error", message: CHANGED },
    });
    assert.deepEqual(journalLine(entry(2, "cartography", "error", "orders-db: The source does not answer.")), {
      at: at(2),
      phase: "survey",
      actor: "command",
      event: { type: "journal", level: "error", message: "orders-db: The source does not answer." },
    });
  });

  it("is nothing for what else the cartography and the design journal, which their traces tell, and for a text that is no entry", () => {
    for (const text of [
      entry(1, "design", "started", "The design starts."),
      entry(2, "cartography", "info", "3 sources."),
      entry(2, "design", "info", "Pass functional: 0 tests."),
      entry(2, "design", "finished", "The design did not succeed."),
      entry(2, "release", "error", "A step the command does not have."),
      entry(2, "constructor", "error", "A step named as something every object has."),
      "not an entry",
      "null",
      JSON.stringify({ step: "execution", event: "info", message: "Without a date." }),
      JSON.stringify({ at: at(3), step: 4, event: "info", message: "Without a step." }),
      JSON.stringify({ at: at(3), step: "execution", event: "info" }),
    ]) {
      assert.equal(journalLine(text), undefined, text);
    }
  });
});

describe("the thread of a run", () => {
  it("tells its events in the order the lines are read, each dated as its line", () => {
    const events = threadOf([
      traced(1, "plan", "harness", { type: "started" }),
      traced(2, "plan", "agent", { type: "text", text: "First." }),
      traced(2, "plan", "agent", { type: "text", text: "Second." }),
    ]);
    assert.deepEqual(
      events.map(({ id, at: date }) => [id, date]),
      [
        [1, at(1)],
        [2, at(2)],
        [3, at(2)],
      ],
    );
  });

  it("starts a phase where the harness or the command starts one, with the source it works on", () => {
    const thread = new RankedThread();
    const lines = [
      journalLine(entry(1, "configuration", "started", "The configuration starts.")),
      traceLine(traced(2, "survey", "harness", { type: "started" })),
      traceLine(traced(3, "card", "harness", { type: "started" }, "orders-db")),
      traceLine(traced(4, "write", "harness", { type: "started" })),
    ];
    assert.deepEqual(
      lines.flatMap((line) => (line === undefined ? [] : thread.add(line))),
      [
        { id: 1, at: at(1), type: "phase_started", phase: "configuration" },
        { id: 2, at: at(2), type: "phase_started", phase: "survey" },
        { id: 3, at: at(3), type: "phase_started", phase: "card", source: "orders-db" },
        { id: 4, at: at(4), type: "phase_started", phase: "write" },
      ],
    );
  });

  it("tells each request of the harness to the agent of the phase, and never the brief it quotes, which whoever took it told", () => {
    const events = threadOf([
      traced(1, "plan", "harness", { type: "message", text: REQUEST }),
      traced(2, "plan", "harness", { type: "message", text: REQUEST }),
      traced(3, "card", "harness", { type: "message", text: "Describe the source." }),
      traced(4, "write", "harness", { type: "message" }),
    ]);
    assert.deepEqual(events, [
      { id: 1, at: at(1), type: "harness_message", to: "planner", text: REQUEST },
      { id: 2, at: at(2), type: "harness_message", to: "planner", text: REQUEST },
      { id: 3, at: at(3), type: "harness_message", to: "cartographer", text: "Describe the source." },
      { id: 4, at: at(4), type: "harness_message", to: "writer", text: "" },
    ]);
  });

  it("tells the delivery of a message of the person to the agent of the phase whose session received it, the reviewer the harness last addressed included", () => {
    const events = threadOf([
      delivered(1, "consolidation", 1),
      delivered(2, "plan", 2),
      delivered(3, "write", 3),
      delivered(4, "review", 4),
      traced(5, "review", "harness", { type: "message", text: "The test:\n…" }),
      delivered(6, "review", 5),
    ]);
    assert.deepEqual(
      ofType(events, "message_delivered").map(({ id, at: date, message, agent }) => [id, date, message, agent]),
      [
        [1, at(1), 1, "cartographer"],
        [2, at(2), 2, "planner"],
        [3, at(3), 3, "writer"],
        [4, at(4), 4, "plan_reviewer"],
        [6, at(6), 5, "code_reviewer"],
      ],
    );
    assert.deepEqual(ofType(events, "user_message"), []);
  });

  it("leaves out a delivery that does not number its message, and what is no line of the harness", () => {
    const thread = new RankedThread();
    assert.deepEqual(
      threadOf([traced(1, "plan", "harness", { type: "person", text: "said" }), traced(2, "plan", "harness", { type: "person", message: "1", text: "said" })]),
      [],
    );
    assert.deepEqual(thread.add({ at: at(1), actor: "command", phase: "summary", event: { type: "person", message: 1 } }), []);
    assert.deepEqual(thread.add({ at: at(1), actor: "command", phase: "summary", event: { type: "message", text: "said" } }), []);
  });

  it("gives what a model wrote and thought to the agent of its phase", () => {
    const events = threadOf([
      traced(1, "plan", "agent", { type: "reasoning", text: "I read the domain first." }),
      traced(2, "write", "agent", { type: "text", text: "Written." }),
      traced(3, "index", "agent", { type: "text" }),
    ]);
    assert.deepEqual(events, [
      { id: 1, at: at(1), type: "agent_message", agent: "planner", text: "I read the domain first.", reasoning: true },
      { id: 2, at: at(2), type: "agent_message", agent: "writer", text: "Written.", reasoning: false },
      { id: 3, at: at(3), type: "agent_message", agent: "cartographer", text: "", reasoning: false },
    ]);
  });

  it("tells the three reviewers apart by what the harness asks each", () => {
    const events = threadOf([
      traced(1, "review", "agent", { type: "text", text: "Before any request." }),
      traced(2, "review", "harness", { type: "message", text: "Scenarios kept: one." }),
      traced(3, "review", "agent", { type: "tool-call", callId: "r1", tool: "report_duplicates", arguments: { duplicates: [] } }),
      traced(4, "review", "harness", { type: "message", text: "Scenario a — A scenario (functional, nominal)." }),
      traced(5, "review", "agent", { type: "tool-call", callId: "r2", tool: "report_findings", arguments: { findings: [] } }),
      traced(6, "review", "harness", { type: "message", text: "The test:\n```ts\ntest();\n```" }),
      traced(7, "review", "agent", { type: "text", text: "Read." }),
    ]);
    assert.deepEqual(
      events.map((event) => ("agent" in event ? event.agent : "to" in event ? `to ${event.to}` : "")),
      ["plan_reviewer", "to plan_reviewer", "plan_reviewer", "to coherence_reviewer", "coherence_reviewer", "to code_reviewer", "code_reviewer"],
    );
  });

  it("makes an action of a tool call, and its end of the answer of the tool, with how long it took", () => {
    const events = threadOf([
      traced(1, "plan", "agent", { type: "tool-call", callId: "c1", tool: "knowledge_domain", arguments: { domain: "identity-access" } }),
      traced(2, "plan", "agent", { type: "tool-call", callId: "c2", tool: "orders_db_list_tables" }),
      traced(4, "plan", "agent", { type: "tool-result", callId: "c2", tool: "orders_db_list_tables", result: [{ schema: "public" }] }),
      traced(5, "plan", "agent", { type: "tool-result", callId: "c1", tool: "knowledge_domain", result: "identity-access (Account Access): sign in." }),
    ]);
    assert.deepEqual(events, [
      { id: 1, at: at(1), type: "action_started", action: "c1", agent: "planner", tool: "knowledge_domain", arguments: { domain: "identity-access" } },
      { id: 2, at: at(2), type: "action_started", action: "c2", agent: "planner", tool: "orders_db_list_tables", arguments: undefined },
      { id: 3, at: at(4), type: "action_finished", action: "c2", outcome: "done", result: '[{"schema":"public"}]', durationMs: 2000 },
      { id: 4, at: at(5), type: "action_finished", action: "c1", outcome: "done", result: "identity-access (Account Access): sign in.", durationMs: 4000 },
    ]);
  });

  it("shows the page a browser tool rendered, under its address, or under the tool when it gives none", () => {
    const [, opened, , looked] = threadOf([
      traced(1, "plan", "agent", { type: "tool-call", callId: "c1", tool: "shop_goto", arguments: { url: "/" } }),
      traced(2, "plan", "agent", {
        type: "tool-result",
        callId: "c1",
        tool: "shop_goto",
        result: { url: "http://localhost:3000/", code: 'await page.goto("/");', page: '- heading "Home"\n- button "Log in"' },
      }),
      traced(3, "plan", "agent", { type: "tool-call", callId: "c2", tool: "shop_snapshot", arguments: null }),
      traced(4, "plan", "agent", { type: "tool-result", callId: "c2", tool: "shop_snapshot", result: { page: '- heading "Profile"' } }),
    ]);
    assert.deepEqual(opened, {
      id: 2,
      at: at(2),
      type: "action_finished",
      action: "c1",
      outcome: "done",
      result: 'await page.goto("/");',
      durationMs: 1000,
      look: { kind: "page", name: "http://localhost:3000/", lines: ['- heading "Home"', '- button "Log in"'] },
    });
    assert.ok(looked?.type === "action_finished");
    assert.deepEqual(
      [looked.result, looked.look],
      ['{"page":"- heading \\"Profile\\""}', { kind: "page", name: "shop_snapshot", lines: ['- heading "Profile"'] }],
    );
  });

  it("shows the file an agent hands in from the start of its action, named after the test of the scenario the harness opened, then each test its run ran", () => {
    const events = threadOf([
      traced(1, "write", "agent", { type: "tool-call", callId: "c0", tool: "run_test", arguments: { content: "early();" } }),
      traced(2, "write", "agent", { type: "tool-result", callId: "c0", tool: "run_test", result: null }),
      traced(3, "write", "harness", { type: "journal", level: "info", message: "The scenario a was opened; its test is apps/shop/tests/a.spec.ts." }),
      traced(4, "write", "harness", { type: "started" }),
      traced(5, "write", "agent", { type: "tool-call", callId: "c1", tool: "run_test", arguments: { content: 'test("a", async () => {});\n// end' } }),
      traced(6, "write", "agent", {
        type: "tool-result",
        callId: "c1",
        tool: "run_test",
        result: "Run of the file: failed.\n- shop › a.spec.ts:3 › a: failed.\n  Error: expected\n- shop › a.spec.ts:9 › b: passed.\nNext: fix it.",
      }),
      traced(7, "write", "agent", { type: "tool-call", callId: "c2", tool: "run_test", arguments: { content: "test();" } }),
      traced(8, "write", "agent", {
        type: "tool-result",
        callId: "c2",
        tool: "run_test",
        result: "Run of the file: it could not run: no browser.\n- shop › a.spec.ts:3 › a: passed.",
      }),
      traced(9, "write", "agent", { type: "tool-call", callId: "c3", tool: "tests_read", arguments: { path: "a.spec.ts" } }),
      traced(10, "write", "agent", { type: "tool-result", callId: "c3", tool: "tests_read", result: "- shop › a.spec.ts:3 › a: passed." }),
    ]);
    assert.deepEqual(
      ofType(events, "action_started").map(({ look }) => look),
      [
        { kind: "file", name: "run_test", lines: ["early();"] },
        { kind: "file", name: "apps/shop/tests/a.spec.ts", lines: ['test("a", async () => {});', "// end"] },
        { kind: "file", name: "apps/shop/tests/a.spec.ts", lines: ["test();"] },
        undefined,
      ],
    );
    assert.deepEqual(
      ofType(events, "action_finished").map(({ outcome, look, tests }) => [outcome, look, tests]),
      [
        ["done", undefined, undefined],
        [
          "failed",
          undefined,
          [
            { id: "shop › a.spec.ts:3 › a", verdict: "failed" },
            { id: "shop › a.spec.ts:9 › b", verdict: "passed" },
          ],
        ],
        ["passed", undefined, [{ id: "shop › a.spec.ts:3 › a", verdict: "passed" }]],
        ["passed", undefined, undefined],
      ],
    );
    assert.deepEqual(ofType(events, "phase_started"), [{ id: 4, at: at(4), type: "phase_started", phase: "write", scenario: "a" }]);
  });

  it("ends as failed an action whose tool failed, with why, and shows nothing of it", () => {
    const events = threadOf([
      traced(1, "plan", "agent", { type: "tool-call", callId: "c1", tool: "shop_goto", arguments: { content: "x" } }),
      traced(2, "plan", "agent", { type: "tool-error", callId: "c1", tool: "shop_goto", reason: "failed", message: "The tool failed." }),
      traced(3, "plan", "agent", { type: "tool-call", callId: "c2", tool: "shop_click", arguments: {} }),
      traced(4, "plan", "agent", { type: "tool-result", callId: "c2", tool: "shop_click", result: { error: "No such element.", code: "await page.click();" } }),
    ]);
    assert.deepEqual(ofType(events, "action_finished"), [
      { id: 2, at: at(2), type: "action_finished", action: "c1", outcome: "failed", result: "The tool failed.", durationMs: 1000 },
      { id: 4, at: at(4), type: "action_finished", action: "c2", outcome: "failed", result: "No such element.", durationMs: 1000 },
    ]);
  });

  it("leaves out a call that names no tool or bears no identifier, an answer to a call it does not hold, and a second answer", () => {
    const events = threadOf([
      traced(1, "plan", "agent", { type: "tool-call", tool: "shop_goto" }),
      traced(2, "plan", "agent", { type: "tool-call", callId: "c1" }),
      traced(3, "plan", "agent", { type: "tool-result", callId: "unknown", result: "Lost." }),
      traced(4, "plan", "agent", { type: "tool-result", result: "Lost." }),
      traced(5, "plan", "agent", { type: "tool-call", callId: "c2", tool: "shop_goto" }),
      traced(6, "plan", "agent", { type: "tool-result", callId: "c2", result: "Kept." }),
      traced(7, "plan", "agent", { type: "tool-result", callId: "c2", result: "Again." }),
    ]);
    assert.deepEqual(
      events.map(({ id, type }) => [id, type]),
      [
        [1, "action_started"],
        [2, "action_finished"],
      ],
    );
  });

  const propose = (seconds: number, callId: string, scenarios: unknown, result: unknown) => [
    traced(seconds, "plan", "agent", { type: "tool-call", callId, tool: "propose_plan", arguments: scenarios === undefined ? {} : { scenarios } }),
    traced(seconds, "plan", "agent", { type: "tool-result", callId, tool: "propose_plan", result }),
  ];
  const acceptedAs = (seconds: number, names: string) =>
    traced(seconds, "plan", "harness", { type: "journal", level: "info", message: `The plan was accepted: ${names}.` });
  const OPEN = "The plan is not closed yet.";
  const ACCEPTED = "The plan was accepted with its scenarios: the agent said the brief is covered.";
  const planned = (lines: readonly string[]) =>
    ofType(threadOf(lines), "plan_accepted").map(({ scenarios }) => scenarios.map(({ id, title }) => `${id} ${title}`));

  it("gives a plan accepted on a call that proposes nothing the scenarios the agent proposed before", () => {
    assert.deepEqual(
      planned([
        ...propose(1, "p1", [{ id: "a", title: "First", level: "smoke" }], OPEN),
        ...propose(2, "p2", [{ id: "b", title: "Second", level: "smoke" }], OPEN),
        ...propose(3, "p3", [{ id: "a", title: "First, again", level: "smoke" }], OPEN),
        ...propose(4, "p4", [], ACCEPTED),
      ]),
      [["a First, again", "b Second"]],
    );
  });

  it("tells each scenario of an accepted plan with all the plan says of it a person reads, and leaves out what it cannot read", () => {
    const scenario = {
      id: "search",
      title: "Search a customer",
      intent: "Finds a customer by name.",
      kind: "functional",
      level: "functional",
      case: "nominal",
      effect: "write",
      application: "shop",
      domain: "customers",
      feature: "customer-search",
      sources: [{ source: "specs", item: "Search" }, { source: "shop" }, { item: "no source" }, "specs"],
      data: [{ value: "Ada", from: "made-up" }, { value: "Ada" }, { from: "shop" }],
      steps: [
        {
          action: "Search Ada.",
          actions: [3, 4],
          expects: [{ result: "Ada is listed.", shows: ["Ada", 7], absent: ["Bob"] }, { result: "No text." }, { shows: ["x"] }],
        },
        { action: "Put back the customer.", actions: [5], restores: true, expects: "none" },
        { action: "Look again.", restores: "yes", expects: [] },
        { expects: [] },
      ],
    };
    const events = threadOf([
      ...propose(1, "p1", [scenario, { title: "No identifier", level: "smoke" }, "search", { id: "bare", level: "smoke", sources: "specs" }], ACCEPTED),
    ]);
    assert.deepEqual(ofType(events, "plan_accepted")[0]?.scenarios, [
      {
        id: "search",
        title: "Search a customer",
        level: "functional",
        application: "shop",
        case: "nominal",
        intent: "Finds a customer by name.",
        kind: "functional",
        effect: "write",
        domain: "customers",
        feature: "customer-search",
        sources: [{ source: "specs", item: "Search" }, { source: "shop" }],
        data: [{ value: "Ada", from: "made-up" }],
        steps: [
          {
            action: "Search Ada.",
            expects: [
              { result: "Ada is listed.", shows: ["Ada"], absent: ["Bob"] },
              { result: "No text.", shows: [], absent: [] },
            ],
          },
          { action: "Put back the customer.", expects: [], restores: true },
          { action: "Look again.", expects: [] },
        ],
      },
      { id: "bare", title: "bare", level: "smoke" },
    ]);
  });

  it("gives an accepted plan the scenarios the harness names when it journals the acceptance, in that order, and no other", () => {
    assert.deepEqual(
      planned([
        ...propose(
          1,
          "p1",
          [
            { id: "a", title: "First", level: "smoke" },
            { id: "twin", title: "Set aside", level: "smoke" },
          ],
          OPEN,
        ),
        ...propose(2, "p2", [{ id: "b", title: "Second", level: "smoke" }], OPEN),
        traced(3, "plan", "agent", { type: "tool-call", callId: "p3", tool: "propose_plan", arguments: { scenarios: [] } }),
        acceptedAs(3, "b, a, unknown"),
        traced(3, "plan", "agent", { type: "tool-result", callId: "p3", tool: "propose_plan", result: ACCEPTED }),
      ]),
      [["b Second", "a First"]],
    );
    assert.deepEqual(planned([...propose(1, "p1", [{ id: "a", level: "smoke" }], OPEN), acceptedAs(2, "no scenario"), ...propose(2, "p2", [], ACCEPTED)]), [
      [],
    ]);
  });

  it("gives a plan accepted with no earlier proposal no scenario, and starts each plan phase and each plan after an accepted one from none", () => {
    assert.deepEqual(
      planned([
        ...propose(1, "p1", [], ACCEPTED),
        ...propose(2, "p2", [{ id: "a", level: "smoke" }], OPEN),
        traced(3, "plan", "harness", { type: "started" }),
        ...propose(4, "p3", [], ACCEPTED),
        ...propose(5, "p4", [{ id: "b", level: "smoke" }], OPEN),
        acceptedAs(6, "b"),
        ...propose(6, "p5", [], ACCEPTED),
        ...propose(7, "p6", [{ id: "c", level: "smoke" }], ACCEPTED),
      ]),
      [[], [], ["b b"], ["c c"]],
    );
  });

  it("ends a plan as refused or warned about, as accepted with its scenarios, or as still open", () => {
    const events = threadOf([
      ...propose(1, "p1", [{ id: "a" }], { error: "Refused (PLAN-SHOWN): scenario a names a text nothing showed." }),
      ...propose(2, "p2", [{ id: "a" }, { id: "a2" }], "Warning (PLAN-DUPLICATE): scenario a2 repeats scenario a."),
      ...propose(3, "p3", [], "The plan is not closed yet. It holds 1 scenario."),
      ...propose(
        4,
        "p4",
        [{ id: "a", title: "A scenario", level: "smoke", case: "nominal", application: "shop" }, { id: "b" }, null, 3, { title: "Without an identifier" }],
        "The plan was accepted with 2 scenarios.\nNext: answer with one sentence.",
      ),
      ...propose(5, "p5", undefined, "The plan was accepted with 0 scenarios."),
      traced(6, "plan", "agent", { type: "tool-call", callId: "p6", tool: "propose_plan", arguments: null }),
      traced(6, "plan", "agent", { type: "tool-result", callId: "p6", tool: "propose_plan", result: "The plan was accepted." }),
      traced(7, "plan", "agent", { type: "tool-call", callId: "o1", tool: "other_tool", arguments: {} }),
      traced(7, "plan", "agent", { type: "tool-result", callId: "o1", tool: "other_tool", result: "The plan was accepted, it says." }),
    ]);
    assert.deepEqual(
      ofType(events, "action_finished").map(({ outcome }) => outcome),
      ["failed", "failed", "done", "passed", "passed", "passed", "passed"],
    );
    assert.deepEqual(ofType(events, "plan_accepted"), [
      {
        id: 9,
        at: at(4),
        type: "plan_accepted",
        scenarios: [
          // The scenario b has no level, and its pass names none: the plan is told without it.
          { id: "a", title: "A scenario", level: "smoke", application: "shop", case: "nominal" },
        ],
      },
      { id: 12, at: at(5), type: "plan_accepted", scenarios: [] },
      { id: 15, at: at(6), type: "plan_accepted", scenarios: [] },
    ]);
  });

  it("makes a note of what the harness and the command journal, and a refusal of an error, with its code when it has one", () => {
    const thread = new RankedThread();
    const lines = [
      traceLine(traced(1, "plan", "harness", { type: "journal", level: "info", message: "The plan was accepted:\n 2 scenarios." })),
      traceLine(
        traced(2, "plan", "harness", { type: "journal", level: "error", message: "[PLAN-ELEMENT] The plan was refused:\nits element designated nothing." }),
      ),
      traceLine(traced(3, "plan", "harness", { type: "journal", level: "error", message: "The plan could not be read." })),
      traceLine(traced(4, "plan", "harness", { type: "journal", level: "error" })),
      journalLine(entry(5, "prerequisites", "error", "[ENV-DOWN] The application shop does not answer.")),
      journalLine(entry(6, "summary", "info", "1 test passed.")),
    ];
    assert.deepEqual(
      lines.flatMap((line) => (line === undefined ? [] : thread.add(line))),
      [
        { id: 1, at: at(1), type: "note", phase: "plan", text: "The plan was accepted:\n 2 scenarios." },
        { id: 2, at: at(2), type: "refusal", phase: "plan", code: "PLAN-ELEMENT", text: "The plan was refused:\nits element designated nothing." },
        { id: 3, at: at(3), type: "refusal", phase: "plan", text: "The plan could not be read." },
        { id: 4, at: at(4), type: "refusal", phase: "plan", text: "" },
        { id: 5, at: at(5), type: "refusal", phase: "prerequisites", code: "ENV-DOWN", text: "The application shop does not answer." },
        { id: 6, at: at(6), type: "note", phase: "summary", text: "1 test passed." },
      ],
    );
  });

  it("tells once an error the harness traced and the command relayed in its journal, whichever is read first, under the name of its source when it has one", () => {
    const thread = new RankedThread();
    const refused = "[PLAN-ELEMENT] The plan was refused by the harness: its element designated nothing.";
    const closed = "The scenario a was closed: failed.";
    const lines = [
      traceLine(traced(1, "plan", "harness", { type: "journal", level: "error", message: refused })),
      traceLine(traced(2, "plan", "harness", { type: "journal", level: "error", message: refused })),
      traceLine(traced(3, "write", "harness", { type: "journal", level: "error", message: closed })),
      traceLine(traced(4, "card", "harness", { type: "journal", level: "error", message: "The source does not answer." }, "orders-db")),
      journalLine(entry(5, "cartography", "error", "orders-db: The source does not answer.")),
      journalLine(entry(6, "design", "error", refused)),
      journalLine(entry(6, "design", "error", refused)),
      journalLine(entry(6, "design", "error", closed)),
      journalLine(entry(7, "design", "error", "The design state could not be written.")),
      traceLine(traced(7, "write", "harness", { type: "journal", level: "error", message: "The design state could not be written." })),
    ];
    assert.deepEqual(
      lines.flatMap((line) => (line === undefined ? [] : thread.add(line))).map((event) => [event.id, event.type, "phase" in event ? event.phase : ""]),
      [
        [1, "refusal", "plan"],
        [2, "refusal", "plan"],
        [3, "scenario_closed", ""],
        [4, "refusal", "card"],
        [5, "refusal", "plan"],
      ],
    );
  });

  it("makes a refusal of each error the command journals in the cartography or the design that no trace tells, the same message twice when it is journaled twice", () => {
    const thread = new RankedThread();
    const lines = [
      entry(1, "cartography", "error", "[SOURCE-DOWN] orders-db does not answer."),
      entry(2, "design", "error", CHANGED),
      entry(2, "design", "error", "No branch was created and no file was written."),
      entry(2, "design", "info", "Pass functional: 0 tests."),
      entry(2, "design", "error", CHANGED),
    ];
    assert.deepEqual(
      lines.flatMap((text) => {
        const line = journalLine(text);
        return line === undefined ? [] : thread.add(line);
      }),
      [
        { id: 1, at: at(1), type: "refusal", phase: "survey", code: "SOURCE-DOWN", text: "orders-db does not answer." },
        { id: 2, at: at(2), type: "refusal", phase: "plan", text: CHANGED },
        { id: 3, at: at(2), type: "refusal", phase: "plan", text: "No branch was created and no file was written." },
        { id: 4, at: at(2), type: "refusal", phase: "plan", text: CHANGED },
      ],
    );
  });

  it("names the scenario a refusal is about: one of the plan being built the text names, or the one whose test is written or reviewed", () => {
    const refused = (seconds: number, phase: "plan" | "write" | "review", message: string) =>
      traced(seconds, phase, "harness", { type: "journal", level: "error", message });
    const events = threadOf([
      traced(1, "plan", "harness", { type: "started" }),
      traced(1, "plan", "agent", { type: "tool-call", callId: "p", tool: "propose_plan", arguments: { scenarios: [{ id: "search", level: "smoke" }] } }),
      refused(2, "plan", "[PLAN-LEVEL] The plan was refused by the harness: scenario search is of the level smoke."),
      refused(3, "plan", "[PLAN-START] The plan was refused by the harness: scenario browse opens no address, unlike scenario search."),
      refused(4, "plan", "The design failed: one test per scenario of the plan."),
      traced(5, "write", "harness", { type: "journal", level: "info", message: "The scenario open-shop was opened." }),
      refused(6, "write", "[TEST-CHECK] The test could not be run."),
      refused(7, "review", "The review could not be read."),
      traced(8, "write", "agent", { type: "stopped", reason: { limit: "actions" } }),
      traced(9, "write", "harness", { type: "journal", level: "info", message: "The scenario open-shop was closed: passed." }),
      refused(10, "write", "The design failed."),
    ]);
    assert.deepEqual(
      ofType(events, "refusal").map(({ code, scenario }) => [code, scenario]),
      [
        ["PLAN-LEVEL", "search"],
        ["PLAN-START", "search"],
        [undefined, undefined],
        ["TEST-CHECK", "open-shop"],
        [undefined, "open-shop"],
        [undefined, "open-shop"],
        [undefined, undefined],
      ],
    );
  });

  it("makes a refusal of a task the harness stopped, with the limit it reached, and of an error of the session of an agent", () => {
    const events = threadOf([
      traced(1, "write", "agent", { type: "stopped", reason: { limit: "actions", counters: { actions: 40 } } }),
      traced(2, "write", "agent", { type: "error", error: { name: "ModelResponseError", message: "The model answered with status 503." } }),
      traced(3, "card", "agent", { type: "error", error: "lost" }),
      traced(4, "card", "agent", { type: "error" }),
    ]);
    assert.deepEqual(events, [
      { id: 1, at: at(1), type: "refusal", phase: "write", text: "actions" },
      { id: 2, at: at(2), type: "refusal", phase: "write", text: "The model answered with status 503." },
      { id: 3, at: at(3), type: "refusal", phase: "card", text: "lost" },
      { id: 4, at: at(4), type: "refusal", phase: "card", text: "" },
    ]);
  });

  it("leaves out the end of a phase, the counts of the harness and the end of a turn", () => {
    const events = threadOf([
      traced(1, "plan", "harness", { type: "usage", requests: 16 }),
      traced(2, "plan", "harness", { type: "finished", outcome: "truncated" }),
      traced(3, "card", "harness", { type: "inventory", items: 3 }, "orders-db"),
      traced(4, "survey", "harness", { type: "survey", answers: true }, "orders-db"),
      traced(5, "plan", "agent", { type: "end", counters: { iterations: 2 } }),
    ]);
    assert.deepEqual(events, []);
  });
});

describe("the thread of a design that plans level by level", () => {
  const plan = (seconds: number, level: string) => [
    traced(seconds, "plan", "harness", { type: "started" }),
    traced(seconds, "plan", "harness", {
      type: "message",
      text: `Plan tests.\n<brief>\ncover the profile\n</brief>\nThis plan is of the level ${level} alone.`,
    }),
  ];
  const written = (seconds: number, scenario: string, verdict: string) => [
    traced(seconds, "write", "harness", {
      type: "journal",
      level: "info",
      message: `The scenario ${scenario} was opened; its test is apps/shop/tests/${scenario}.spec.ts.`,
    }),
    traced(seconds, "write", "harness", { type: "started" }),
    traced(seconds, "write", "harness", {
      type: "journal",
      level: verdict === "passed" ? "info" : "error",
      message: `The scenario ${scenario} was closed: ${verdict}; its test is apps/shop/tests/${scenario}.spec.ts.`,
    }),
  ];
  const events = threadOf([
    ...plan(1, "smoke"),
    traced(2, "plan", "agent", { type: "tool-call", callId: "p", tool: "propose_plan", arguments: { scenarios: [{ id: "open-shop" }] } }),
    traced(2, "plan", "agent", { type: "tool-result", callId: "p", tool: "propose_plan", result: "The plan was accepted with 1 scenario." }),
    ...written(3, "open-shop", "passed"),
    traced(4, "write", "harness", { type: "started" }),
    ...plan(5, "functional"),
    ...written(6, "search-order", "failed"),
    traced(7, "plan", "harness", { type: "started" }),
    traced(7, "review", "harness", { type: "message", text: "Scenarios kept: this plan is of the level business alone." }),
    traced(8, "write", "harness", { type: "journal", level: "info", message: "The scenario without-level was opened." }),
    traced(8, "write", "agent", { type: "tool-call", callId: "w", tool: "run_test", arguments: { content: "test();" } }),
    traced(8, "write", "agent", { type: "tool-result", callId: "w", tool: "run_test", result: "Run of the file: passed." }),
    traced(9, "write", "harness", { type: "journal", level: "info", message: "The scenario without-level was closed: passed." }),
  ]);

  it("gives the request of a plan the level it asks for", () => {
    assert.deepEqual(
      ofType(events, "harness_message").map(({ to, level }) => [to, level]),
      [
        ["planner", "smoke"],
        ["planner", "functional"],
        ["plan_reviewer", undefined],
      ],
    );
  });

  it("gives a scenario of an accepted plan the level of the pass when it names none", () => {
    assert.deepEqual(ofType(events, "plan_accepted")[0]?.scenarios, [{ id: "open-shop", title: "open-shop", level: "smoke" }]);
  });

  it("closes each scenario with its verdict and the level of its pass, and none once a new plan starts without saying its level", () => {
    assert.deepEqual(
      ofType(events, "scenario_closed").map(({ scenario, level, verdict }) => [scenario, level, verdict]),
      [
        ["open-shop", "smoke", "passed"],
        ["search-order", "functional", "failed"],
        ["without-level", undefined, "passed"],
      ],
    );
  });

  it("starts the writing of a test with the scenario the harness opened, and without one once it is closed", () => {
    assert.deepEqual(
      ofType(events, "phase_started").flatMap(({ phase, scenario }) => (phase === "write" ? [scenario] : [])),
      ["open-shop", undefined, "search-order"],
    );
  });

  it("names a file after the tool when the harness opened its scenario without saying where its test is", () => {
    assert.deepEqual(ofType(events, "action_started").at(-1)?.look, { kind: "file", name: "run_test", lines: ["test();"] });
  });
});

describe("the texts of a thread", () => {
  /** A text far longer than a thread ever cut, on several lines. */
  const LONG = Array.from({ length: 400 }, (_, rank) => `line ${rank} ${"x".repeat(240)}`).join("\n");

  it("are whole: a message, a note, a refusal, the answer of a tool, and every text its arguments hold, however deep", () => {
    const [said, sent, noted, refused, called, answered] = threadOf([
      traced(1, "plan", "agent", { type: "text", text: LONG }),
      traced(2, "plan", "harness", { type: "message", text: LONG }),
      traced(3, "plan", "harness", { type: "journal", level: "info", message: LONG }),
      traced(4, "plan", "harness", { type: "journal", level: "error", message: `[CODE] ${LONG}` }),
      traced(5, "plan", "agent", {
        type: "tool-call",
        callId: "c",
        tool: "t",
        arguments: { text: LONG, files: [{ content: LONG }, 7, null], deep: { deeper: { short: "kept", on: true } } },
      }),
      traced(6, "plan", "agent", { type: "tool-result", callId: "c", result: LONG }),
    ]);
    for (const event of [said, sent, noted, refused]) assert.ok(event !== undefined && "text" in event && event.text === LONG, event?.type);
    assert.ok(answered?.type === "action_finished" && answered.result === LONG);
    assert.ok(called?.type === "action_started");
    assert.deepEqual(called.arguments, { text: LONG, files: [{ content: LONG }, 7, null], deep: { deeper: { short: "kept", on: true } } });
  });

  it("cut a runaway of more than a megabyte, and mark the cut, wherever it is", () => {
    const runaway = "r".repeat(1_048_577);
    const [said, called, answered] = threadOf([
      traced(1, "plan", "agent", { type: "text", text: runaway }),
      traced(2, "plan", "agent", { type: "tool-call", callId: "c", tool: "t", arguments: { deep: [runaway] } }),
      traced(3, "plan", "agent", { type: "tool-result", callId: "c", result: runaway }),
    ]);
    const kept = `${"r".repeat(1_048_576)}…`;
    assert.ok(said?.type === "agent_message" && said.text === kept);
    assert.ok(called?.type === "action_started");
    assert.deepEqual(called.arguments, { deep: [kept] });
    assert.ok(answered?.type === "action_finished" && answered.result === kept);
  });

  it("show every line of a page or of a file an action looked at, whole", () => {
    const [, page, file] = threadOf([
      traced(1, "plan", "agent", { type: "tool-call", callId: "a", tool: "shop_snapshot" }),
      traced(2, "plan", "agent", { type: "tool-result", callId: "a", result: { page: LONG } }),
      traced(3, "write", "agent", { type: "tool-call", callId: "b", tool: "run_test", arguments: { content: LONG } }),
      traced(4, "write", "agent", { type: "tool-result", callId: "b", result: "Kept." }),
    ]);
    assert.ok(page?.type === "action_finished" && page.look?.lines.join("\n") === LONG);
    assert.ok(file?.type === "action_started" && file.look?.lines.join("\n") === LONG);
  });
});
