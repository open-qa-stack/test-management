import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  scriptOf,
  type ActionFinishedEvent,
  type AgentRole,
  type ScriptWording,
  type Session,
  type SessionEvent,
  type SessionPhase,
  type Step,
  type UnrankedEvent,
} from "../src/sessions/index.ts";

/** An event without its rank nor its date, which the tests give in order. */
type EventBody = UnrankedEvent extends infer Event ? (Event extends unknown ? Omit<Event, "at"> : never) : never;

const RUNNING: Session = {
  id: "session-1",
  request: "Test the search.",
  openedAt: "2026-11-13T14:44:05.000Z",
  lastEventAt: "2026-11-13T14:44:06.000Z",
  state: "running",
};
const UNASKED: Session = { id: "session-1", openedAt: RUNNING.openedAt, lastEventAt: RUNNING.lastEventAt, state: "running" };
const INTERRUPTED: Session = { ...RUNNING, state: "interrupted" };

/** The words of a presentation that says each thing as what it is. */
const WORDING: ScriptWording = {
  phase: (phase) => `phase ${phase}`,
  tool: (tool, args) => `${tool} ${JSON.stringify(args)}`,
  planAccepted: "plan accepted",
  scope: "scope",
  interrupted: "interrupted",
  verdicts: (tests) => `${tests} verdicts`,
  closed: (scenarios) => `${scenarios} closed`,
  opened: (day, time) => `opened ${day} ${time}`,
};

/** Ranks events from 1 and dates them a second apart, from 14:44:06. */
function numbered(bodies: readonly EventBody[]): SessionEvent[] {
  return bodies.map((body, index) => ({ ...body, id: index + 1, at: `2026-11-13T14:44:${String(6 + index).padStart(2, "0")}.000Z` }) as SessionEvent);
}

/** The steps of a session whose events are given without rank nor date. */
function stepsOf(bodies: readonly EventBody[], session: Session = RUNNING): readonly Step[] {
  return scriptOf(session, numbered(bodies), WORDING).steps;
}

describe("the script of a session", () => {
  it("carries the identifier of the session, and where it is: queued, live while its agents work, ended in any other state", () => {
    const stages = [{ ...RUNNING, state: "queued" as const }, RUNNING, INTERRUPTED, { ...RUNNING, state: "archived" as Session["state"] }].map(
      (session) => scriptOf(session, [], WORDING).stage,
    );
    assert.deepEqual(stages, ["queued", "live", "ended", "ended"]);
    assert.equal(scriptOf(RUNNING, [], WORDING).id, "session-1");
  });

  it("is titled after what the session was asked, on one line and whole; after the first message of the person; or after its opening", () => {
    assert.equal(scriptOf({ ...RUNNING, request: "  test\n  the search " }, [], WORDING).title, "test the search");
    assert.equal(scriptOf({ ...RUNNING, request: "r".repeat(4000) }, [], WORDING).title, "r".repeat(4000));
    const said = numbered([
      { type: "user_message", text: "a correction", number: 1 },
      { type: "user_message", text: "the request" },
      { type: "user_message", text: "another" },
    ]);
    assert.equal(scriptOf(UNASKED, said, WORDING).title, "the request");
    assert.equal(scriptOf(UNASKED, said.slice(0, 1), WORDING).title, "opened 2026-11-13 14:44:05");
  });

  it("tells what the person, the harness and an agent said, a reasoning apart, a message sent since with its number and its delivery", () => {
    assert.deepEqual(
      stepsOf([
        { type: "user_message", text: "Test the search." },
        { type: "harness_message", to: "planner", text: "Plan it." },
        { type: "agent_message", agent: "planner", text: "I look first.", reasoning: true },
        { type: "agent_message", agent: "planner", text: "Here is the plan.", reasoning: false },
        { type: "user_message", text: "Without the profile.", number: 1 },
        { type: "message_delivered", message: 1, agent: "planner" },
      ]),
      [
        { kind: "say", from: "user", at: "14:44:06", text: "Test the search." },
        { kind: "say", from: "harness", to: "planner", at: "14:44:07", text: "Plan it." },
        { kind: "say", from: "planner", at: "14:44:08", text: "I look first.", thinking: true },
        { kind: "say", from: "planner", at: "14:44:09", text: "Here is the plan." },
        { kind: "say", from: "user", at: "14:44:10", text: "Without the profile.", number: 1 },
        { kind: "delivery", at: "14:44:11", message: 1, to: "planner" },
      ],
    );
  });

  it("starts a pass at each phase, a review or a writing as a part, and none for the work on one source, which it counts once", () => {
    const script = scriptOf(
      RUNNING,
      numbered([
        { type: "phase_started", phase: "configuration" },
        { type: "phase_started", phase: "card", source: "order-specs" },
        { type: "phase_started", phase: "card", source: "order-specs" },
        { type: "phase_started", phase: "review" },
        { type: "phase_started", phase: "write", scenario: "search" },
        { type: "phase_started", phase: "later" as SessionPhase },
      ]),
      WORDING,
    );
    assert.deepEqual(script.sources, ["order-specs"]);
    assert.deepEqual(script.steps, [
      { kind: "pass", at: "14:44:06", title: "phase configuration", summary: "" },
      { kind: "pass", at: "14:44:09", title: "phase review", summary: "", minor: true },
      { kind: "pass", at: "14:44:10", title: "phase write", summary: "search", minor: true },
      { kind: "pass", at: "14:44:11", title: "phase later", summary: "" },
    ]);
  });

  it("names the plan that is open after the level its request asks for, never an earlier one, and nothing when a level comes outside a plan", () => {
    const titles = (bodies: readonly EventBody[]): string[] => stepsOf(bodies).flatMap((step) => (step.kind === "pass" ? [step.title] : []));
    assert.deepEqual(
      titles([
        { type: "harness_message", to: "planner", text: "Too early.", level: "smoke" },
        { type: "phase_started", phase: "plan" },
        { type: "harness_message", to: "planner", text: "No level." },
        { type: "phase_started", phase: "plan" },
        { type: "harness_message", to: "planner", text: "Plan the functional tests.", level: "functional" },
      ]),
      ["phase plan", "phase plan · functional"],
    );
  });

  it("makes one step of an action and its end, by its identifier: pending until the tool answered, then with its answer, its duration, its outcome and what the agent looked at", () => {
    const look = { kind: "page", name: "http://localhost/", lines: ["- heading"] } as const;
    assert.deepEqual(
      stepsOf([
        { type: "action_started", action: "a", agent: "planner", tool: "shop_goto", arguments: { url: "/" } },
        { type: "action_started", action: "b", agent: "planner", tool: "propose_plan", arguments: {} },
        { type: "action_started", action: "c", agent: "writer", tool: "run_test", arguments: {} },
        { type: "action_finished", action: "b", outcome: "failed", result: " Refused:\n name an element. ", durationMs: 40 },
        { type: "action_finished", action: "a", outcome: "done", result: "Opened.", durationMs: 900, look },
        { type: "action_finished", action: "lost", outcome: "passed", result: "Lost.", durationMs: 1 },
        { type: "action_started", action: "d", agent: "writer", tool: "run_test", arguments: {} },
        { type: "action_finished", action: "d", outcome: "flaky" as ActionFinishedEvent["outcome"], result: "1 flaky", durationMs: 10 },
        { type: "action_started", action: "e", agent: "writer", tool: "propose_test", arguments: {} },
        { type: "action_finished", action: "e", outcome: "passed", result: "Kept.", durationMs: 5 },
      ]),
      [
        { kind: "tool", from: "planner", at: "14:44:06", tool: "shop_goto", title: 'shop_goto {"url":"/"}', detail: "Opened.", durationMs: 900, look },
        {
          kind: "tool",
          from: "planner",
          at: "14:44:07",
          tool: "propose_plan",
          title: "propose_plan {}",
          detail: "Refused:\n name an element.",
          durationMs: 40,
          outcome: "failed",
        },
        { kind: "tool", from: "writer", at: "14:44:08", tool: "run_test", title: "run_test {}", pending: true },
        { kind: "tool", from: "writer", at: "14:44:12", tool: "run_test", title: "run_test {}", detail: "1 flaky", durationMs: 10 },
        { kind: "tool", from: "writer", at: "14:44:14", tool: "propose_test", title: "propose_test {}", detail: "Kept.", durationMs: 5, outcome: "passed" },
      ],
    );
  });

  it("ignores the end of an action whose start is no longer one, an event of a type it does not know, and what an agent it does not know says or is asked", () => {
    const stranger = "auditor" as AgentRole;
    assert.deepEqual(
      stepsOf([
        { type: "agent_message", agent: stranger, text: "Hello.", reasoning: false },
        { type: "harness_message", to: stranger, text: "Audit it." },
        { type: "action_started", action: "a", agent: stranger, tool: "tests_list", arguments: {} },
        { type: "message_delivered", message: 1, agent: stranger },
        { type: "archived" } as unknown as EventBody,
        { type: "state_changed", state: "running" },
      ]),
      [],
    );
  });

  it("lists the scenarios of a plan the harness accepted, tells a refusal as a verdict with the code of its gate when it has one, and a note as a line", () => {
    assert.deepEqual(
      stepsOf([
        {
          type: "plan_accepted",
          scenarios: [
            { id: "search", title: "Search a customer", level: "smoke", case: "nominal", application: "shop" },
            { id: "open", title: "Open a customer", level: "functional" },
          ],
        },
        { type: "refusal", phase: "plan", code: "PLAN-ELEMENT", text: "Name an element." },
        { type: "refusal", phase: "write", text: "The run failed." },
        { type: "note", phase: "plan", text: " The plan\n was accepted. " },
      ]),
      [
        {
          kind: "plan",
          at: "14:44:06",
          title: "plan accepted",
          scenarios: [
            { id: "search", title: "Search a customer", level: "smoke", case: "nominal", application: "shop", refusals: [] },
            { id: "open", title: "Open a customer", level: "functional", refusals: [] },
          ],
        },
        { kind: "verdict", at: "14:44:07", accepted: false, code: "PLAN-ELEMENT", about: "phase plan", text: "Name an element.", reason: "Name an element." },
        { kind: "verdict", at: "14:44:08", accepted: false, about: "phase write", text: "The run failed.", reason: "The run failed." },
        { kind: "note", at: "14:44:09", text: "The plan\n was accepted." },
      ],
    );
  });

  it("tells what the session works on as a step of its own: its environment, its applications and the levels asked", () => {
    assert.deepEqual(stepsOf([{ type: "scope_resolved", environment: "local", applications: ["shop"], levels: ["functional"] }]), [
      { kind: "scope", at: "14:44:06", title: "scope", environment: "local", applications: ["shop"], levels: ["functional"] },
    ]);
  });

  it("reads a refusal by its form — the tool or what was refused it opens on, its reason, the page it quotes — and keeps its text whole", () => {
    const page = '\n\nThe page is now at http://localhost:3000/orders:\n- heading "Orders"\n  - button "Search"';
    const texts = [
      `shop_click: The button matches two elements.${page}`,
      `The plan was refused by the harness: scenario search names no element.${page}\n\nTake a snapshot first.`,
      "Name an element.",
      "The design failed:\nno test.",
    ];
    const verdicts = stepsOf(texts.map((text) => ({ type: "refusal", phase: "plan", text })));
    assert.deepEqual(
      verdicts.map((step) => step.kind === "verdict" && [step.text === texts[verdicts.indexOf(step)], step.tool, step.subject, step.reason, step.page]),
      [
        [
          true,
          "shop_click",
          undefined,
          "The button matches two elements.",
          { kind: "page", name: "http://localhost:3000/orders", lines: ['- heading "Orders"', '  - button "Search"'] },
        ],
        [
          true,
          undefined,
          "The plan was refused by the harness",
          "scenario search names no element.\n\nTake a snapshot first.",
          { kind: "page", name: "http://localhost:3000/orders", lines: ['- heading "Orders"', '  - button "Search"'] },
        ],
        [true, undefined, undefined, "Name an element.", undefined],
        [true, undefined, undefined, "The design failed:\nno test.", undefined],
      ],
    );
  });

  it("gives each scenario of an accepted plan the refusals about it since its plan started, and names the scenario of a refusal", () => {
    const steps = stepsOf([
      { type: "refusal", phase: "plan", code: "PLAN-LEVEL", scenario: "search", text: "Too early." },
      { type: "phase_started", phase: "plan" },
      { type: "refusal", phase: "plan", code: "PLAN-LEVEL", scenario: "search", text: "Two screens." },
      { type: "refusal", phase: "plan", code: "PLAN-START", scenario: "search", text: "No address." },
      { type: "refusal", phase: "plan", text: "Unrelated." },
      {
        type: "plan_accepted",
        scenarios: [
          { id: "search", title: "Search", level: "functional" },
          { id: "open", title: "Open", level: "functional" },
        ],
      },
      { type: "refusal", phase: "write", scenario: "search", text: "Later." },
      { type: "plan_accepted", scenarios: [{ id: "search", title: "Search", level: "business" }] },
    ]);
    const plans = steps.filter((step) => step.kind === "plan");
    assert.deepEqual(
      plans.map(({ scenarios }) => scenarios.map(({ id, refusals }) => [id, refusals.map(({ code, scenario, text }) => [code, scenario, text])])),
      [
        [
          [
            "search",
            [
              ["PLAN-LEVEL", "search", "Two screens."],
              ["PLAN-START", "search", "No address."],
            ],
          ],
          ["open", []],
        ],
        [["search", [[undefined, "search", "Later."]]]],
      ],
    );
  });

  it("keeps every text whole, with its lines: a message, a refusal, a note, the title and the answer of an action", () => {
    const long = Array.from({ length: 300 }, (_, rank) => `line ${rank} ${"x".repeat(80)}`).join("\n");
    const steps = stepsOf([
      { type: "harness_message", to: "planner", text: long },
      { type: "refusal", phase: "plan", text: long },
      { type: "note", phase: "plan", text: long },
      { type: "agent_message", agent: "planner", text: long, reasoning: false },
      { type: "action_started", action: "a", agent: "planner", tool: "t", arguments: long },
      { type: "action_finished", action: "a", outcome: "done", result: long, durationMs: 1 },
    ]);
    assert.deepEqual(
      steps.slice(0, 4).map((step) => "text" in step && step.text),
      [long, long, long, long],
    );
    const action = steps[4];
    assert.ok(action?.kind === "tool");
    assert.equal(action.detail, long);
    assert.equal(action.title, `t ${JSON.stringify(long)}`);
  });

  it("tells an interruption, and no other change of state", () => {
    assert.deepEqual(
      stepsOf(
        [
          { type: "state_changed", state: "running" },
          { type: "state_changed", state: "interrupted" },
        ],
        INTERRUPTED,
      ),
      [{ kind: "note", at: "14:44:07", text: "interrupted" }],
    );
  });

  it("closes, once the session ended, on the verdict of each test of its result, named by its title alone, at the time of the last step", () => {
    const completed: Session = {
      ...RUNNING,
      state: "completed",
      result: {
        outcome: "failed",
        durationMs: 1000,
        modelRequests: 3,
        tests: [
          { id: "shop › tests/search.spec.ts:3 › searches a customer", verdict: "passed", reason: "It passed." },
          { id: "opens a customer", verdict: "blocked", reason: "The application did not answer." },
        ],
      },
    };
    const events: readonly EventBody[] = [
      { type: "note", phase: "execution", text: "The tests ran." },
      { type: "scenario_closed", scenario: "search", level: "smoke", verdict: "passed" },
    ];
    assert.deepEqual(stepsOf(events, completed).at(-1), {
      kind: "outcome",
      at: "14:44:06",
      title: "2 verdicts",
      tests: [
        { title: "searches a customer", level: "", verdict: "passed", note: "It passed." },
        { title: "opens a customer", level: "", verdict: "blocked", note: "The application did not answer." },
      ],
    });
    // While the session goes on, or when it left no step, it closes on nothing.
    assert.equal(stepsOf(events, { ...completed, state: "running" }).length, 1);
    assert.deepEqual(stepsOf([], completed), []);
  });

  it("closes on the scenarios the harness closed when no test ran, and on nothing when none was", () => {
    const events: readonly EventBody[] = [
      { type: "scenario_closed", scenario: "search", level: "smoke", verdict: "passed" },
      { type: "scenario_closed", scenario: "open", verdict: "failed" },
      { type: "state_changed", state: "interrupted" },
    ];
    assert.deepEqual(stepsOf(events, INTERRUPTED).at(-1), {
      kind: "outcome",
      at: "14:44:08",
      title: "2 closed",
      tests: [
        { title: "search", level: "smoke", verdict: "passed" },
        { title: "open", level: "", verdict: "failed" },
      ],
    });
    assert.equal(stepsOf(events, RUNNING).length, 1);
    assert.equal(stepsOf(events.slice(2), INTERRUPTED).length, 1);
    assert.deepEqual(stepsOf(events.slice(0, 2), INTERRUPTED), []);
  });
});
describe("the verdict of a reviewer", () => {
  const RECORDED = "Recorded. Answer with one word; call no more tools.";

  it("is a review of its own, with each remark in full, the plumbing of its call kept in it, its one-word reply too", () => {
    assert.deepEqual(
      stepsOf([
        { type: "phase_started", phase: "write", scenario: "search" },
        { type: "harness_message", to: "code_reviewer", text: "The test: …" },
        {
          type: "action_started",
          action: "r",
          agent: "code_reviewer",
          tool: "report_quality",
          arguments: {
            findings: [
              { where: " Step 1 ", what: "The total depends on the data.", rule: "PW-DATA-01", concerns: "plan" },
              { what: "No screenshot ends the step.", rule: " " },
              { where: "Step 2" },
              "not a finding",
            ],
          },
        },
        { type: "action_finished", action: "r", outcome: "done", result: ` ${RECORDED} `, durationMs: 6 },
        { type: "agent_message", agent: "code_reviewer", text: " Done ", reasoning: false },
      ]).slice(2),
      [
        {
          kind: "review",
          from: "code_reviewer",
          at: "14:44:08",
          scenario: "search",
          remarks: [
            { text: "The total depends on the data.", where: "Step 1", rule: "PW-DATA-01", concerns: "plan" },
            { text: "No screenshot ends the step." },
          ],
          tool: "report_quality",
          answer: RECORDED,
          durationMs: 6,
          reply: "Done",
        },
      ],
    );
  });

  it("names the scenario a reviewer of the plan found a duplicate, and what it repeats, and reviews no scenario", () => {
    const [review] = stepsOf([
      { type: "phase_started", phase: "plan" },
      {
        type: "action_started",
        action: "r",
        agent: "plan_reviewer",
        tool: "report_duplicates",
        arguments: {
          duplicates: [
            { id: "search-again", of: "tests/search.spec.ts", reason: "Both search a customer." },
            { id: "alone", reason: "No of." },
          ],
        },
      },
    ]).slice(1);
    assert.deepEqual(review, {
      kind: "review",
      from: "plan_reviewer",
      at: "14:44:07",
      remarks: [{ text: "Both search a customer.", duplicate: { scenario: "search-again", of: "tests/search.spec.ts" } }, { text: "No of." }],
      tool: "report_duplicates",
      pending: true,
    });
  });

  it("finds no remark in an empty list, and none in a call that holds no list: a reviewer reads before it reports", () => {
    const steps = stepsOf([
      { type: "action_started", action: "a", agent: "coherence_reviewer", tool: "report_findings", arguments: { findings: [] } },
      { type: "action_started", action: "b", agent: "coherence_reviewer", tool: "tests_read", arguments: { path: "a.spec.ts" } },
      { type: "action_started", action: "c", agent: "coherence_reviewer", tool: "report_findings", arguments: null },
      { type: "action_started", action: "d", agent: "writer", tool: "report_findings", arguments: { findings: [] } },
    ]);
    assert.deepEqual(
      steps.map((step) => (step.kind === "review" ? step.remarks : step.kind)),
      [[], "tool", "tool", "tool"],
    );
  });

  it("is told refused when the harness refused the call, and then takes no reply", () => {
    const steps = stepsOf([
      { type: "action_started", action: "r", agent: "coherence_reviewer", tool: "report_findings", arguments: { findings: [] } },
      { type: "action_finished", action: "r", outcome: "failed", result: "The arguments do not match.", durationMs: 2 },
      { type: "agent_message", agent: "coherence_reviewer", text: "Pass", reasoning: false },
    ]);
    assert.deepEqual(steps, [
      {
        kind: "review",
        from: "coherence_reviewer",
        at: "14:44:06",
        remarks: [],
        tool: "report_findings",
        answer: "The arguments do not match.",
        durationMs: 2,
        refused: true,
      },
      { kind: "say", from: "coherence_reviewer", at: "14:44:08", text: "Pass" },
    ]);
  });

  it("tells what a reviewer says after its verdict when it is more than a word, or after something else, or a reasoning", () => {
    const steps = stepsOf([
      { type: "action_started", action: "r", agent: "code_reviewer", tool: "report_quality", arguments: { findings: [] } },
      { type: "action_finished", action: "r", outcome: "done", result: "Recorded.", durationMs: 2 },
      { type: "agent_message", agent: "code_reviewer", text: "I think it holds.", reasoning: true },
      { type: "agent_message", agent: "code_reviewer", text: "It is fine overall.", reasoning: false },
      { type: "agent_message", agent: "code_reviewer", text: "Done", reasoning: false },
      { type: "action_started", action: "s", agent: "code_reviewer", tool: "report_quality", arguments: { findings: [] } },
      { type: "action_finished", action: "s", outcome: "done", result: "Recorded.", durationMs: 2 },
      { type: "action_started", action: "t", agent: "code_reviewer", tool: "tests_read", arguments: {} },
      { type: "agent_message", agent: "code_reviewer", text: "Done", reasoning: false },
    ]);
    assert.deepEqual(
      steps.map((step) => (step.kind === "say" ? step.text : step.kind === "review" ? `review ${step.reply ?? ""}` : step.kind)),
      ["review ", "I think it holds.", "It is fine overall.", "Done", "review ", "tool", "Done"],
    );
  });
});

describe("the run of a test", () => {
  const FILE = {
    kind: "file",
    name: "apps/shop/tests/search.spec.ts",
    lines: ['import { test } from "./fixtures.ts";', "", 'test("Search a customer", async () => {', "});"],
  } as const;
  const SAYS: ScriptWording = { ...WORDING, tool: (tool, _args, subject) => `${tool} ${subject ?? "-"}` };
  const run = (bodies: readonly EventBody[]): readonly Step[] => scriptOf(RUNNING, numbered(bodies), SAYS).steps;

  it("shows the file from the start of the action, named after the test it declares, then each test its run ran", () => {
    const steps = run([
      { type: "action_started", action: "r", agent: "writer", tool: "run_test", arguments: { content: "…" }, look: FILE },
      {
        type: "action_finished",
        action: "r",
        outcome: "passed",
        result: "Run of the file: passed.",
        durationMs: 2400,
        tests: [{ id: "shop › search.spec.ts:3 › Search a customer", verdict: "passed" }],
      },
    ]);
    assert.deepEqual(run([{ type: "action_started", action: "r", agent: "writer", tool: "run_test", arguments: {}, look: FILE }]), [
      {
        kind: "tool",
        from: "writer",
        at: "14:44:06",
        tool: "run_test",
        title: "run_test Search a customer",
        look: FILE,
        subject: "Search a customer",
        pending: true,
      },
    ]);
    assert.deepEqual(steps, [
      {
        kind: "tool",
        from: "writer",
        at: "14:44:06",
        tool: "run_test",
        title: "run_test Search a customer",
        look: FILE,
        subject: "Search a customer",
        detail: "Run of the file: passed.",
        durationMs: 2400,
        outcome: "passed",
        tests: [{ title: "Search a customer", verdict: "passed" }],
      },
    ]);
  });

  it("names a file that declares no test, or several, after its name, and names nothing for a page", () => {
    const several = { ...FILE, lines: ['test("a", () => {});', "test('b', () => {});"] };
    const none = { ...FILE, name: "notes.md", lines: ["test.step"] };
    const page = { kind: "page", name: "http://localhost/", lines: ["- heading"] } as const;
    const subjects = [several, none, page].map((look) => run([{ type: "action_started", action: "a", agent: "writer", tool: "t", arguments: {}, look }])[0]);
    assert.deepEqual(
      subjects.map((step) => step?.kind === "tool" && [step.title, step.subject]),
      [
        ["t search.spec.ts", "search.spec.ts"],
        ["t notes.md", "notes.md"],
        ["t -", undefined],
      ],
    );
  });

  it("names the test once its end shows the file, for a thread that told the file only there", () => {
    const [step] = run([
      { type: "action_started", action: "r", agent: "writer", tool: "run_test", arguments: { content: "…" } },
      { type: "action_finished", action: "r", outcome: "failed", result: "Run of the file: failed.", durationMs: 10, look: FILE },
    ]);
    assert.ok(step?.kind === "tool");
    assert.deepEqual([step.title, step.subject, step.look, step.tests], ["run_test Search a customer", "Search a customer", FILE, undefined]);
  });
});

describe("the notes of the harness about each source", () => {
  const kept = (source: string): readonly EventBody[] => [
    { type: "phase_started", phase: "card", source },
    { type: "note", phase: "card", text: `The card of ${source} is up to date; it was kept.` },
  ];

  it("are one step when they say the same of each source in a row, each note kept, whatever starts between them", () => {
    const steps = stepsOf([{ type: "phase_started", phase: "card" }, ...kept("orders-api"), ...kept("orders-db"), ...kept("orders-specs")]);
    assert.deepEqual(steps.slice(1), [
      {
        kind: "repeated",
        at: "14:44:08",
        before: "The card of ",
        after: " is up to date; it was kept.",
        sources: ["orders-api", "orders-db", "orders-specs"],
        notes: [
          { kind: "note", at: "14:44:08", text: "The card of orders-api is up to date; it was kept." },
          { kind: "note", at: "14:44:10", text: "The card of orders-db is up to date; it was kept." },
          { kind: "note", at: "14:44:12", text: "The card of orders-specs is up to date; it was kept." },
        ],
      },
    ]);
  });

  it("find the name of a source as a word of its own, whatever it holds", () => {
    const steps = stepsOf([
      { type: "phase_started", phase: "card", source: "api" },
      { type: "note", phase: "card", text: "The apis of api are read." },
      { type: "phase_started", phase: "card", source: "shop.v2" },
      { type: "note", phase: "card", text: "The apis of shop.v2 are read." },
    ]);
    assert.deepEqual(
      steps.map((step) => step.kind === "repeated" && [step.before, step.after, step.sources]),
      [["The apis of ", " are read.", ["api", "shop.v2"]]],
    );
  });

  it("stay apart when they say something else, name no source, come one alone, or something comes between them", () => {
    const kinds = (bodies: readonly EventBody[]): string[] => stepsOf(bodies).map((step) => step.kind);
    assert.deepEqual(
      kinds([...kept("a"), { type: "phase_started", phase: "card", source: "b" }, { type: "note", phase: "card", text: "The card of b was written." }]),
      ["note", "note"],
    );
    assert.deepEqual(
      kinds([...kept("a"), { type: "phase_started", phase: "index" }, { type: "note", phase: "index", text: "The card of a is up to date; it was kept." }]),
      ["note", "pass", "note"],
    );
    assert.deepEqual(kinds([...kept("a"), { type: "phase_started", phase: "card", source: "b" }, { type: "note", phase: "card", text: "Nothing of it." }]), [
      "note",
      "note",
    ]);
    assert.deepEqual(kinds([...kept("a"), { type: "agent_message", agent: "cartographer", text: "Next.", reasoning: false }, ...kept("b")]), [
      "note",
      "say",
      "note",
    ]);
    assert.deepEqual(
      kinds([
        ...kept("a"),
        { type: "phase_started", phase: "card", source: "b" },
        { type: "note", phase: "card", text: "Kept: b is up to date; it was kept." },
      ]),
      ["note", "note"],
    );
    assert.deepEqual(kinds(kept("a")), ["note"]);
  });
});
