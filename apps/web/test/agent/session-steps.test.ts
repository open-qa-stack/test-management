import assert from "node:assert/strict";
import type { ActionFinishedEvent, Session, SessionPhase, SessionScript, Step } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { scriptOf } from "../../src/agent/session-steps.ts";
import { iconOf } from "../../src/agent/tool-icon.ts";
import { COMPLETED, fixtureScript, numbered, QUEUED, REFUSAL, RUNNING, SESSION_ID, type EventBody } from "./session-fixture.ts";

/** A session nobody asked anything in, whose agents are working. */
const UNASKED: Session = { id: SESSION_ID, openedAt: RUNNING.openedAt, lastEventAt: RUNNING.lastEventAt, state: "running" };

/** A session that stopped without ending, and so without a result. */
const INTERRUPTED: Session = { ...RUNNING, state: "interrupted" };

/**
 * The script of a session whose events are given without rank nor date.
 *
 * @param bodies - The events, in order.
 * @param session - The session; the one whose agents are working by default.
 * @returns Its script.
 */
const scriptWith = (bodies: readonly EventBody[], session: Session = RUNNING): SessionScript => scriptOf(session, numbered(bodies));

/**
 * The starts of the passes of a script.
 *
 * @param script - The script.
 * @returns The title, the summary and whether it is a part, for each.
 */
const passes = (script: SessionScript): (readonly [string, string, boolean])[] =>
  script.steps.flatMap((step) => (step.kind === "pass" ? [[step.title, step.summary, step.minor === true] as const] : []));

/**
 * The only step a few events make.
 *
 * @param bodies - The events, in order.
 * @returns The step.
 */
function only(bodies: readonly EventBody[]): Step {
  const { steps } = scriptWith(bodies);
  assert.equal(steps.length, 1);
  return steps[0]!;
}

describe("the script of a session", () => {
  const script = fixtureScript();
  const { steps } = script;

  it("carries the identifier of the session, and where it is: queued, live while its agents work, ended in any other state", () => {
    assert.deepEqual([script.id, script.stage, script.sources, steps.length], [SESSION_ID, "live", [], 13]);
    assert.equal(fixtureScript(QUEUED).stage, "queued");
    assert.equal(fixtureScript({ ...RUNNING, state: "archived" as Session["state"] }).stage, "ended");
    assert.equal(fixtureScript(COMPLETED).stage, "ended");
    assert.equal(fixtureScript(INTERRUPTED).stage, "ended");
  });

  it("starts a pass at each phase, a plan named after the level its request asks for, the writing of a test as a part", () => {
    assert.deepEqual(passes(script), [
      ["Configuration", "", false],
      ["Plan · smoke", "", false],
      ["Écriture d’un test", "search", true],
    ]);
    assert.deepEqual(steps[0], { kind: "pass", at: "14:44:06", title: "Configuration", summary: "" });
    assert.deepEqual(steps[10], { kind: "pass", at: "14:44:18", title: "Écriture d’un test", summary: "search", minor: true });
  });

  it("tells what the person, the harness and an agent said, a reasoning apart", () => {
    assert.deepEqual(steps[3], { kind: "say", from: "user", at: "14:44:09", text: "tester la recherche d'un client" });
    assert.deepEqual(steps[4], { kind: "say", from: "harness", to: "planner", at: "14:44:10", text: "This plan is of the level smoke alone." });
    assert.deepEqual(steps[5], { kind: "say", from: "planner", at: "14:44:11", text: "I should open the application first.", thinking: true });
    assert.deepEqual(steps[11], { kind: "say", from: "writer", at: "14:44:19", text: "I write the test now." });
  });

  it("makes one step of an action and its end, with its tool, what it answered, how long it took and the page the agent looked at", () => {
    assert.deepEqual(steps[6], {
      kind: "tool",
      from: "planner",
      at: "14:44:12",
      tool: "customer_management_goto",
      title: "A ouvert / dans customer-management",
      detail: '{"url":"http://localhost:3020/"}',
      durationMs: 900,
      look: { kind: "page", name: "http://localhost:3020/", lines: ['- heading "Customers"', '- textbox "Search..."'] },
    });
  });

  it("keeps the outcome of an action whose answer says it passed or failed", () => {
    assert.deepEqual(steps[7], {
      kind: "tool",
      from: "planner",
      at: "14:44:14",
      tool: "propose_plan",
      title: "A proposé un plan de 1 scénario(s)",
      detail: "The plan was accepted: search.",
      durationMs: 40,
      outcome: "passed",
    });
  });

  it("leaves an action pending until its tool answered", () => {
    assert.deepEqual(steps[12], { kind: "tool", from: "writer", at: "14:44:20", tool: "run_test", title: "A joué le test", pending: true });
  });

  it("lists the scenarios of a plan the harness accepted, each with its level, its case and its application", () => {
    assert.deepEqual(steps[8], {
      kind: "plan",
      at: "14:44:16",
      title: "Plan accepté par le harnais",
      scenarios: [{ priority: "smoke", title: "Search a customer", source: "nominal · customer-management" }],
    });
  });

  it("tells a refusal as a verdict of the harness about its phase, with the code of the gate", () => {
    assert.deepEqual(steps[9], {
      kind: "verdict",
      at: "14:44:17",
      accepted: false,
      code: "PLAN-ELEMENT",
      about: "Plan",
      text: REFUSAL,
    });
  });

  it("tells a note as a line of the harness", () => {
    assert.deepEqual(steps[1], { kind: "note", at: "14:44:07", text: "The configuration is valid; the run targets the environment local." });
  });
});

describe("the passes of a script", () => {
  it("are named after their phase, a phase that works on one source starting none and counting that source once", () => {
    const script = scriptWith([
      { type: "phase_started", phase: "prerequisites" },
      { type: "phase_started", phase: "survey" },
      { type: "phase_started", phase: "card", source: "orders-db" },
      { type: "phase_started", phase: "card", source: "specs" },
      { type: "phase_started", phase: "card", source: "orders-db" },
      { type: "phase_started", phase: "consolidation" },
      { type: "phase_started", phase: "index" },
      { type: "phase_started", phase: "review" },
      { type: "phase_started", phase: "execution" },
      { type: "phase_started", phase: "summary" },
    ]);
    assert.deepEqual(passes(script), [
      ["Prérequis", "", false],
      ["Cartographie · sources", "", false],
      ["Cartographie · domaines", "", false],
      ["Cartographie · index", "", false],
      ["Relecture du plan", "", true],
      ["Exécution des tests", "", false],
      ["Bilan", "", false],
    ]);
    assert.deepEqual(script.sources, ["orders-db", "specs"]);
    assert.equal(script.steps.length, 7);
  });

  it("name each plan after the level of its own request", () => {
    const script = scriptWith([
      { type: "phase_started", phase: "plan" },
      { type: "harness_message", to: "planner", text: "Plan the smoke tests.", level: "smoke" },
      { type: "phase_started", phase: "plan" },
      { type: "harness_message", to: "planner", text: "Plan the functional tests.", level: "functional" },
    ]);
    assert.deepEqual(
      passes(script).map(([title]) => title),
      ["Plan · smoke", "Plan · functional"],
    );
  });

  it("name the plan that is open, never an earlier one its request gave no level", () => {
    const script = scriptWith([
      { type: "phase_started", phase: "plan" },
      { type: "harness_message", to: "planner", text: "Plan the tests." },
      { type: "phase_started", phase: "plan" },
      { type: "harness_message", to: "planner", text: "Plan the smoke tests.", level: "smoke" },
      { type: "harness_message", to: "planner", text: "The plan is not closed yet.", level: "smoke" },
    ]);
    assert.deepEqual(
      passes(script).map(([title]) => title),
      ["Plan", "Plan · smoke"],
    );
  });

  it("leave a plan unnamed when the harness asks for no level, and name nothing when a level comes outside a plan", () => {
    const unnamed = scriptWith([
      { type: "phase_started", phase: "plan" },
      { type: "harness_message", to: "planner", text: "Answer with one sentence." },
    ]);
    assert.deepEqual(passes(unnamed), [["Plan", "", false]]);
    const outside = scriptWith([
      { type: "phase_started", phase: "write", scenario: "search" },
      { type: "harness_message", to: "writer", text: "Write the smoke test.", level: "smoke" },
    ]);
    assert.deepEqual(passes(outside), [["Écriture d’un test", "search", true]]);
    assert.deepEqual(outside.steps[1], { kind: "say", from: "harness", to: "writer", at: "14:44:07", text: "Write the smoke test." });
  });
});

describe("the actions of a script", () => {
  it("keep the file an agent handed in, and say when its submission failed", () => {
    const step = only([
      { type: "action_started", action: "t1", agent: "writer", tool: "propose_test", arguments: {} },
      {
        type: "action_finished",
        action: "t1",
        outcome: "failed",
        result: "Refused.",
        durationMs: 12,
        look: { kind: "file", name: "search-customer.spec.ts", lines: ['test("search", async () => {});'] },
      },
    ]);
    assert.deepEqual(step, {
      kind: "tool",
      from: "writer",
      at: "14:44:06",
      tool: "propose_test",
      title: "A remis le test",
      detail: "Refused.",
      durationMs: 12,
      outcome: "failed",
      look: { kind: "file", name: "search-customer.spec.ts", lines: ['test("search", async () => {});'] },
    });
  });

  it("answer each action by its identifier, whatever the order the tools answer in", () => {
    const { steps } = scriptWith([
      { type: "action_started", action: "a", agent: "planner", tool: "knowledge_domain", arguments: { domain: "customers" } },
      { type: "action_started", action: "b", agent: "planner", tool: "tests_list", arguments: {} },
      { type: "action_finished", action: "b", outcome: "done", result: "No test yet.", durationMs: 3 },
    ]);
    assert.deepEqual(steps, [
      { kind: "tool", from: "planner", at: "14:44:06", tool: "knowledge_domain", title: "A lu le domaine customers", pending: true },
      { kind: "tool", from: "planner", at: "14:44:07", tool: "tests_list", title: "A cherché les tests existants", detail: "No test yet.", durationMs: 3 },
    ]);
  });

  it("ignore the end of an action that never started", () => {
    const { steps } = scriptWith([
      { type: "note", phase: "write", text: "A note." },
      { type: "action_finished", action: "lost", outcome: "passed", result: "Lost.", durationMs: 1 },
    ]);
    assert.deepEqual(steps, [{ kind: "note", at: "14:44:06", text: "A note." }]);
  });

  it("draw a tool after what it works on: a test, a plan, a browser, a database, a document, anything else", () => {
    const tools = [
      "run_test",
      "report_duplicates",
      "tests_read",
      "shop_click",
      "shop_snapshot",
      "orders_db_list_tables",
      "shop_specs_read_section",
      "knowledge_list",
      "remember",
      "something_else",
    ];
    const { steps } = scriptWith(tools.map((tool, index) => ({ type: "action_started", action: `a${index}`, agent: "planner", tool, arguments: {} })));
    assert.deepEqual(tools.map(iconOf), ["play", "layers", "pen", "web", "web", "database", "document", "document", "code", "code"]);
    assert.deepEqual(steps.at(-1), { kind: "tool", from: "planner", at: "14:44:15", tool: "something_else", title: "something_else {}", pending: true });
  });
});

describe("the decisions of the harness in a script", () => {
  it("tell a refusal no gate gave without a code", () => {
    const step = only([{ type: "refusal", phase: "write", text: "The model answered with status 503." }]);
    assert.deepEqual(step, { kind: "verdict", at: "14:44:06", accepted: false, about: "Écriture d’un test", text: "The model answered with status 503." });
  });

  it("give a scenario of a plan the case or the application it has, nothing when it has neither", () => {
    const step = only([
      {
        type: "plan_accepted",
        scenarios: [
          { id: "a", title: "A", level: "smoke", case: "nominal" },
          { id: "b", title: "B", level: "functional", application: "shop" },
          { id: "c", title: "C", level: "e2e" },
        ],
      },
    ]);
    assert.deepEqual(step.kind === "plan" && step.scenarios, [
      { priority: "smoke", title: "A", source: "nominal" },
      { priority: "functional", title: "B", source: "shop" },
      { priority: "e2e", title: "C", source: "" },
    ]);
  });

  it("read a phase this console does not know as a step of the work, when it starts and when it refuses", () => {
    const { steps } = scriptWith([
      { type: "phase_started", phase: "triage" as SessionPhase },
      { type: "refusal", phase: "triage" as SessionPhase, text: "Nothing to triage." },
    ]);
    assert.deepEqual(steps, [
      { kind: "pass", at: "14:44:06", title: "Étape", summary: "" },
      { kind: "verdict", at: "14:44:07", accepted: false, about: "Étape", text: "Nothing to triage." },
    ]);
  });

  it("ignore an event whose type this console does not know", () => {
    const { steps } = scriptWith([{ type: "budget_spent", amount: 3 } as unknown as EventBody, { type: "note", phase: "plan", text: "Noted." }]);
    assert.deepEqual(steps, [{ kind: "note", at: "14:44:07", text: "Noted." }]);
  });

  it("read the outcome of an action this console does not know as none", () => {
    const step = only([
      { type: "action_started", action: "c1", agent: "writer", tool: "run_test", arguments: {} },
      { type: "action_finished", action: "c1", outcome: "flaky" as ActionFinishedEvent["outcome"], result: "1 flaky", durationMs: 10 },
    ]);
    assert.deepEqual(step, { kind: "tool", from: "writer", at: "14:44:06", tool: "run_test", title: "A joué le test", detail: "1 flaky", durationMs: 10 });
  });

  it("tell an interruption, and no other change of state", () => {
    const { steps } = scriptWith(
      [
        { type: "state_changed", state: "running" },
        { type: "state_changed", state: "completed" },
        { type: "state_changed", state: "interrupted" },
      ],
      INTERRUPTED,
    );
    assert.deepEqual(steps, [{ kind: "note", at: "14:44:08", text: "La session s’est arrêtée sans aller à son terme." }]);
  });
});

describe("the end of a script", () => {
  const CLOSED: readonly EventBody[] = [
    { type: "phase_started", phase: "write", scenario: "search" },
    { type: "scenario_closed", scenario: "search", level: "smoke", verdict: "passed" },
    { type: "scenario_closed", scenario: "create", verdict: "failed" },
  ];

  it("closes on the verdict of each test of the result, named by its title alone, at the time of the last step", () => {
    const { steps } = fixtureScript(COMPLETED);
    assert.equal(steps.length, 14);
    assert.deepEqual(steps.at(-1), {
      kind: "outcome",
      at: "14:44:20",
      title: "Verdict de l’exécution : 1 test(s)",
      tests: [{ title: "Rechercher un client par son nom", level: "", verdict: "passed", note: "Every attempt passed." }],
    });
  });

  it("prefers the tests of the result to the scenarios the harness closed, and names a test its runner prefixes with nothing as it is", () => {
    const session: Session = {
      ...COMPLETED,
      result: {
        ...COMPLETED.result!,
        outcome: "failed",
        tests: [...COMPLETED.result!.tests, { id: "Créer un client", verdict: "failed", reason: "An assertion failed." }],
      },
    };
    const last = scriptWith(CLOSED, session).steps.at(-1);
    assert.deepEqual(last, {
      kind: "outcome",
      at: "14:44:06",
      title: "Verdict de l’exécution : 2 test(s)",
      tests: [
        { title: "Rechercher un client par son nom", level: "", verdict: "passed", note: "Every attempt passed." },
        { title: "Créer un client", level: "", verdict: "failed", note: "An assertion failed." },
      ],
    });
  });

  it("closes on the scenarios the harness closed when no test ran, after the note of an interruption", () => {
    const { steps } = scriptWith([...CLOSED, { type: "state_changed", state: "interrupted" }], INTERRUPTED);
    assert.deepEqual(steps.slice(1), [
      { kind: "note", at: "14:44:09", text: "La session s’est arrêtée sans aller à son terme." },
      {
        kind: "outcome",
        at: "14:44:09",
        title: "2 test(s) clos par le harnais",
        tests: [
          { title: "search", level: "smoke", verdict: "passed" },
          { title: "create", level: "", verdict: "failed" },
        ],
      },
    ]);
    const empty: Session = { ...COMPLETED, result: { ...COMPLETED.result!, outcome: "stopped", tests: [] } };
    assert.equal(scriptWith(CLOSED, empty).steps.at(-1)?.kind, "outcome");
  });

  it("closes on nothing while the session goes on, when it produced nothing, or when it has no step", () => {
    assert.deepEqual(
      scriptWith(CLOSED).steps.map((step) => step.kind),
      ["pass"],
    );
    assert.deepEqual(
      scriptWith([{ type: "phase_started", phase: "plan" }], INTERRUPTED).steps.map((step) => step.kind),
      ["pass"],
    );
    assert.deepEqual(scriptOf(COMPLETED, []).steps, []);
    assert.deepEqual(scriptWith([{ type: "scenario_closed", scenario: "search", verdict: "passed" }], INTERRUPTED).steps, []);
  });
});

describe("the title of a script", () => {
  it("is what the session was asked, on one line", () => {
    assert.equal(fixtureScript().title, "tester la recherche d'un client");
    assert.equal(scriptOf({ ...RUNNING, request: "  tester\n  la recherche " }, []).title, "tester la recherche");
  });

  it("is the first message of the person when the session carries no request", () => {
    const script = scriptWith(
      [
        { type: "user_message", text: "couvrir le profil" },
        { type: "user_message", text: "et la recherche" },
      ],
      UNASKED,
    );
    assert.equal(script.title, "couvrir le profil");
  });

  it("is when the session was opened when nothing was asked", () => {
    assert.equal(scriptWith([{ type: "phase_started", phase: "survey" }], UNASKED).title, "Session du 2026-11-15 à 14:44:06 UTC");
  });
});

describe("the long texts of a script", () => {
  it("are whole, with their lines; the title of an action alone is put on one line", () => {
    const long = Array.from({ length: 40 }, (_, rank) => `line ${rank} ${"x".repeat(80)}`).join("\n");
    const { steps } = scriptWith([
      { type: "refusal", phase: "plan", text: long },
      { type: "note", phase: "write", text: " The test ran:\n  passed. " },
      { type: "action_started", action: "g", agent: "planner", tool: "shop_goto", arguments: { url: `/a\n  b/${"u".repeat(200)}` } },
      { type: "action_finished", action: "g", outcome: "done", result: long, durationMs: 5 },
    ]);
    assert.deepEqual(
      steps.slice(0, 2).map((step) => "text" in step && step.text),
      [long, "The test ran:\n  passed."],
    );
    const action = steps[2];
    assert.ok(action?.kind === "tool");
    assert.equal(action.title, `A ouvert /a b/${"u".repeat(200)} dans shop`);
    assert.equal(action.detail, long);
  });
});

describe("a message the person sends while the session goes on", () => {
  const SAID: readonly EventBody[] = [
    { type: "user_message", text: "tester la recherche" },
    { type: "agent_message", agent: "planner", text: "I plan.", reasoning: false },
    { type: "user_message", text: "sans le profil", number: 1 },
    { type: "agent_message", agent: "planner", text: "I go on.", reasoning: false },
    { type: "message_delivered", message: 1, agent: "planner" },
  ];

  it("is something the person said, where it happened, with its number; what opened the session has none", () => {
    const { steps } = scriptWith(SAID);
    assert.deepEqual(steps[0], { kind: "say", from: "user", at: "14:44:06", text: "tester la recherche" });
    assert.deepEqual(steps[2], { kind: "say", from: "user", at: "14:44:08", text: "sans le profil", number: 1 });
  });

  it("reaches an agent in a step of its own, which names the message and that agent, when it happened", () => {
    const { steps } = scriptWith(SAID);
    assert.equal(steps.length, 5);
    assert.deepEqual(steps[4], { kind: "delivery", at: "14:44:10", message: 1, to: "planner" });
  });

  it("waits for an agent as long as no delivery came: the script holds none", () => {
    assert.deepEqual(
      scriptWith(SAID.slice(0, 4)).steps.map(({ kind }) => kind),
      ["say", "say", "say", "say"],
    );
  });

  it("never titles the session, which stays named after what opened it, or after its opening when nothing did", () => {
    const corrected = [{ type: "user_message", text: "sans le profil", number: 1 }, ...SAID] as const;
    assert.equal(scriptWith(corrected, UNASKED).title, "tester la recherche");
    assert.equal(scriptWith([corrected[0]], UNASKED).title, "Session du 2026-11-15 à 14:44:06 UTC");
  });

  it("stays waiting when the agent it reached is one the console does not know: that delivery is left out", () => {
    const { steps } = scriptWith([...SAID.slice(0, 4), { type: "message_delivered", message: 1, agent: "auditor" as "planner" }]);
    assert.equal(steps.length, 4);
  });
});

describe("an agent the console does not know", () => {
  it("is left out of the thread, with what the harness asks of it", () => {
    const stranger = "auditor" as "planner";
    const script = scriptOf(
      RUNNING,
      numbered([
        { type: "harness_message", to: stranger, text: "Audit the plan." },
        { type: "agent_message", agent: stranger, text: "Audited.", reasoning: false },
        { type: "action_started", action: "a1", agent: stranger, tool: "tests_list", arguments: {} },
        { type: "agent_message", agent: "planner", text: "The plan is ready.", reasoning: false },
      ]),
    );
    assert.deepEqual(
      script.steps.map((step) => (step.kind === "say" ? step.text : step.kind)),
      ["The plan is ready."],
    );
  });
});
