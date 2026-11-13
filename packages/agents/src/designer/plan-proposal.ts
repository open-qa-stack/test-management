import type { PlannedScenario, PlanReview, TestPlan, ToolDefinition } from "@open-qa-stack/domain";
import { redactText, scopedToolName, secretForms } from "@open-qa-stack/tools";
import type { Journal } from "../common/journal.ts";
import { checkable, observed } from "./observed.ts";
import { journalRefusals, maskedRefusals, refusalText, repeatedText, type Refusal } from "./refusal.ts";
import { GUIDED_REFUSALS, RefusalStreak } from "./refusal-streak.ts";
import type { ScreenWatch } from "./screen-watch.ts";
import type { SourceWatch } from "./source-watch.ts";
import { heldVariables, type DeclaredSecret } from "./spec-rules.ts";
import { MAX_TESTS, MIN_TESTS } from "./test-proposals.ts";

/** Name of the tool the designer submits its test plan with. */
export const PLAN_TOOL = "propose_plan";
/** What the `from` of a value the test invents says. */
export const MADE_UP = "made-up";
/** The last line of what the agent is told while no plan is accepted. */
export const PLAN_NEXT = `Next: read what the brief is about and do it once on the screens, then call ${PLAN_TOOL}.`;
/** Plans the gates of the harness may refuse before the design stops. */
export const MAX_REFUSED_PLANS = 6;
/** How many of the last texts of a source a refused value is told with. */
const LAST_TEXTS = 5;
/** Longest part of a text of a source a refused value is told with. */
const MAX_TOLD_TEXT = 200;

/** What a plan is checked against. */
export interface PlanRules {
  /** Identifiers of the sources a scenario may cite: those of the index, and every knowledge source and application the agent has tools of. */
  readonly sources: readonly string[];
  /** Identifiers of the applications a scenario may be about. */
  readonly applications: readonly string[];
  /** Identifiers of the domains of the index. */
  readonly domains: readonly string[];
  /** The values no plan may hold: the plan is written to the design state. */
  readonly secrets: readonly DeclaredSecret[];
  /** What the agent saw of the screens, which the expected results of a functional scenario must come from. */
  readonly screens: ScreenWatch;
  /** What the agent read of the knowledge sources, which the data and the texts of a scenario must come from. */
  readonly reads: SourceWatch;
  /** Decides whether a plan that passes the rules may be carried out. */
  readonly review: PlanReview;
  /** Starts carrying out the plan accepted, and gives what the agent is told of it: the sheet of its first scenario. */
  readonly carry: (plan: TestPlan) => string;
}

/**
 * The test plan of a design, submitted with `propose_plan` before any test is run.
 *
 * @remarks
 * A plan holds between `MIN_TESTS` and `MAX_TESTS` scenarios. Each names its case, its application, its
 * domain, its sources, the values its test enters and its steps; each step has one action and the results
 * it expects, with the exact texts the screen shows, or no longer shows, after it. The schema of the tool
 * checks the shape. The gates of the harness refuse, all at once and each with its code, the slugs that
 * repeat, the value of a declared variable, a plan of two functional scenarios or more without a negative
 * one, a functional scenario whose expects name no text, for an application with a user interface a
 * functional scenario none of whose texts appeared, or went, after an action of the agent, a source cited
 * and never read, a value of the data its source never showed, and an expected text no tool showed; the agent may
 * then submit another; from the third refusal of one reason, it is told only what the gate would accept,
 * and the sixth plan the gates refuse stops the design. A plan that keeps these rules goes to the review, one
 * plan at a time: accepted, it is frozen, and no other may be submitted; refused, the design stops.
 */
export class PlanProposal {
  private readonly rules: PlanRules;
  private readonly journal: Journal;
  private plan: TestPlan | undefined;
  private refusal: string | undefined;
  private lastCodes: readonly string[] = [];
  private readonly streak = new RefusalStreak();
  private refusedPlans = 0;

  /**
   * @param rules - What the plan is checked against.
   * @param journal - Where the plan accepted or refused is written.
   */
  public constructor(rules: PlanRules, journal: Journal) {
    this.rules = rules;
    this.journal = journal;
  }

  /**
   * The plan accepted, if any.
   *
   * @returns It, or `undefined` before one is accepted.
   */
  public get accepted(): TestPlan | undefined {
    return this.plan;
  }

  /**
   * Why the design stopped on its plan, if it did: the review refused it, or the gates refused too many.
   *
   * @returns The reason, or `undefined` while no plan was refused for good.
   */
  public get refused(): string | undefined {
    return this.refusal;
  }

  /**
   * What the agent is told of every call once the review refused the plan.
   *
   * @returns The message, which gives the reason of the review.
   */
  public blocked(): string {
    return `The plan was refused: ${this.refusal} The design is stopped; call no more tools.`;
  }

  /**
   * The message that reminds an agent which stopped before a plan was accepted.
   *
   * @returns The reminder; `undefined` once a plan is accepted or refused by the review.
   */
  public reminder(): string | undefined {
    if (this.plan !== undefined || this.refusal !== undefined) return undefined;
    this.journal.record("info", "The agent stopped without an accepted plan; it was reminded to submit one.");
    const state = this.lastCodes.length === 0 ? "No plan is accepted yet." : `The plan was last refused for: ${this.lastCodes.join(", ")}.`;
    return `You stopped before the end. ${state}\n${PLAN_NEXT}`;
  }

  /**
   * The tool the agent submits its plan with.
   *
   * @returns The tool.
   */
  public tool(): ToolDefinition {
    const texts = (description: string) => ({ type: "array", maxItems: 8, items: { type: "string", minLength: 1 }, description });
    return {
      name: PLAN_TOOL,
      description: `Submits the test plan, once you have read the sources and done the brief once on the screens. ${MIN_TESTS} to ${MAX_TESTS} scenarios; with two functional scenarios or more, one is negative. Each scenario gives its data (every value the test enters, with the source that showed it, or "${MADE_UP}" for a value the test invents), then its steps as a user does them. A step has one action and 0 to 4 expects; an expect states one result seen after the action, with in shows the exact texts the screen then displays and in absent the exact texts it no longer displays. Each step becomes one test.step, and each text one assertion. The harness refuses a value or a text no tool showed you.`,
      parameters: {
        type: "object",
        properties: {
          scenarios: {
            type: "array",
            minItems: MIN_TESTS,
            maxItems: MAX_TESTS,
            items: {
              type: "object",
              properties: {
                id: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$", description: "A slug, unique in the plan, such as search-order-by-customer; it names the test file." },
                title: { type: "string", minLength: 1 },
                intent: { type: "string", minLength: 1, description: "What the scenario verifies, and why, in one sentence." },
                kind: { type: "string", enum: ["functional", "visual", "accessibility", "other"] },
                case: { type: "string", enum: ["nominal", "negative"], description: "negative when the input matches nothing, is wrong or is forbidden; nominal otherwise." },
                application: { type: "string", enum: [...this.rules.applications], description: "Identifier of the one application the test is about." },
                domain: { type: "string", enum: [...this.rules.domains], description: "Identifier of the domain of the index the scenario comes from." },
                sources: {
                  type: "array",
                  minItems: 1,
                  items: {
                    type: "object",
                    properties: {
                      source: { type: "string", enum: [...this.rules.sources], description: "Identifier of a source: a knowledge source, or an application for its screens." },
                      item: { type: "string", description: "The element of the source, such as a section of a document." },
                    },
                    required: ["source"],
                    additionalProperties: false,
                  },
                },
                data: {
                  type: "array",
                  maxItems: 12,
                  items: {
                    type: "object",
                    properties: {
                      value: { type: "string", minLength: 1, description: "A value the test enters, copied exactly as the tool showed it." },
                      from: { type: "string", enum: [...this.rules.sources, MADE_UP], description: `The source or the application whose tool showed you the value, or ${MADE_UP}.` },
                    },
                    required: ["value", "from"],
                    additionalProperties: false,
                  },
                },
                steps: {
                  type: "array",
                  minItems: 1,
                  maxItems: 8,
                  items: {
                    type: "object",
                    properties: {
                      action: { type: "string", minLength: 1, description: "What the user does, in one sentence, such as: Search the orders of Veldane." },
                      expects: {
                        type: "array",
                        maxItems: 4,
                        items: {
                          type: "object",
                          properties: {
                            result: { type: "string", minLength: 1, description: "One result seen after the action, in one sentence." },
                            shows: texts("The exact texts the screen displays for this result, as you read them: a name, a number, a message."),
                            absent: texts("The exact texts the screen no longer displays after the action, such as a row the search filtered out."),
                          },
                          required: ["result", "shows", "absent"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["action", "expects"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["id", "title", "intent", "kind", "case", "application", "domain", "sources", "data", "steps"],
              additionalProperties: false,
            },
          },
        },
        required: ["scenarios"],
        additionalProperties: false,
      },
      execute: async (args) => this.submit(args as TestPlan),
    };
  }

  private async submit(plan: TestPlan): Promise<string | { error: string }> {
    // Once a plan is refused, the designer refuses every call before it reaches a tool.
    if (this.plan !== undefined) return { error: "A plan was already accepted; carry it out." };
    const refusals = this.errors(plan);
    if (refusals.length > 0) return this.refuse(refusals);
    const decision = await this.rules.review.review(plan);
    // Plans submitted in one turn are reviewed at once: another may have been decided meanwhile.
    if (this.refusal !== undefined) return { error: this.blocked() };
    if (this.plan !== undefined) return { error: "A plan was already accepted; carry it out." };
    if (!decision.accepted) {
      this.refusal = decision.reason;
      this.journal.record("error", `The plan was refused: ${decision.reason} The design stops; no test is written.`);
      return { error: this.blocked() };
    }
    this.plan = plan;
    this.journal.record("info", `The plan was accepted: ${plan.scenarios.map((scenario) => scenario.id).join(", ")}.`);
    return `The plan was accepted.\n\n${this.rules.carry(plan)}`;
  }

  /** Refuses a plan, and counts it: from the third refusal of one reason the agent is told only what the gate would accept, and the last plan stops the design. */
  private refuse(found: readonly Refusal[]): { error: string } {
    // A refusal may name a value of the plan, which may be a declared one.
    const forms = this.rules.secrets.flatMap((secret) => secretForms(secret.value));
    const refusals = maskedRefusals(found, (text) => redactText(text, forms));
    this.lastCodes = [...new Set(refusals.map((refusal) => refusal.code))];
    journalRefusals(this.journal, "The plan was refused by the harness", refusals);
    this.refusedPlans += 1;
    if (this.refusedPlans >= MAX_REFUSED_PLANS) {
      this.refusal = `the harness refused ${MAX_REFUSED_PLANS} plans, the last one for ${this.lastCodes.join(", ")}.`;
      this.journal.record("error", `The plan was refused: ${this.refusal} The design stops; no test is written.`);
      return { error: this.blocked() };
    }
    this.streak.record(refusals);
    const { code, times } = this.streak.repeated(refusals);
    return { error: times < GUIDED_REFUSALS ? refusalText(refusals) : repeatedText(code, times, refusals) };
  }

  /** What the gates refuse in a plan its schema accepts: the count, the kinds, the sources and the shapes are the schema's. */
  private errors(plan: TestPlan): Refusal[] {
    const ids = plan.scenarios.map((scenario) => scenario.id);
    const repeated = [...new Set(ids.filter((id, at) => ids.indexOf(id) !== at))].map((id) => ({ code: "PLAN-ID", message: `the id ${id} is given to several scenarios. Give each scenario its own id.` }));
    const text = plan.scenarios.flatMap(planText).join("\n");
    const secrets = heldVariables(text, this.rules.secrets).map((variable) => ({ code: "PLAN-SECRET", message: `the plan holds the value of ${variable}. Leave it out; a test reads it with process.env.${variable}.` }));
    const functional = plan.scenarios.filter((scenario) => scenario.kind === "functional");
    const negative =
      functional.length >= 2 && !plan.scenarios.some((scenario) => scenario.case === "negative")
        ? [{ code: "PLAN-NEGATIVE", message: 'no scenario is negative. One must verify what the application answers when the input matches nothing, is wrong or is forbidden; set its case to "negative".' }]
        : [];
    return [...repeated, ...secrets, ...negative, ...functional.flatMap((scenario) => this.expectErrors(scenario)), ...plan.scenarios.flatMap((scenario) => this.readErrors(scenario))];
  }

  /** What the gates refuse in what a scenario relies on: a source it cites and nothing was read of, a value its source never showed, a text no tool showed. */
  private readErrors(scenario: PlannedScenario): Refusal[] {
    const { screens, reads, applications } = this.rules;
    // A source without any tool is held to nothing: nothing could be read of it.
    const tool = (source: string) => (screens.watches(source) ? scopedToolName(source, "goto") : reads.firstTool(source));
    const read = (source: string) => (screens.watches(source) ? screens.looks(source) > 0 : tool(source) === undefined || reads.read(source));
    const showed = (source: string, text: string) => (screens.watches(source) ? screens.shows(source, text) : tool(source) === undefined || reads.shows(source, text));
    const anywhere = (text: string) => applications.some((application) => screens.shows(application, text)) || reads.shows(undefined, text);
    const unread = [...new Set(scenario.sources.map((cited) => cited.source))].filter((source) => !read(source)).map((source) => ({ code: "PLAN-READ", message: `scenario ${scenario.id} cites ${source}, and you have read nothing of it. Call ${tool(source)} first.` }));
    const unshown = scenario.data.filter((entry) => entry.from !== MADE_UP && checkable(entry.value) && !showed(entry.from, entry.value)).map((entry) => this.dataRefusal(entry.value, entry.from, tool(entry.from)!));
    const values = scenario.data.map((entry) => entry.value);
    const madeUp = scenario.data.filter((entry) => entry.from === MADE_UP).map((entry) => entry.value);
    const gone = (text: string) => (screens.watches(scenario.application) ? screens.shows(scenario.application, text) : anywhere(text)) || observed(text, values);
    const texts = scenario.steps.flatMap((step, at) =>
      step.expects.flatMap((expect, k) => [...expect.shows.filter((text) => !anywhere(text) && !observed(text, madeUp)), ...expect.absent.filter((text) => !gone(text))].filter(checkable).map((text) => ({ number: `${at + 1}.${k + 1}`, text }))),
    );
    const unseen = texts.map(({ number, text }) => ({ code: "PLAN-SHOWN", message: `scenario ${scenario.id}, expect ${number}, names "${text}", which nothing you read or saw in this session showed. Do the step with the browser tools and copy the text as the screen gives it.` }));
    return [...unread, ...unshown, ...unseen];
  }

  /** The refusal of a value its source never showed, with the last texts a knowledge source returned as what the gate would accept. */
  private dataRefusal(value: string, source: string, tool: string): Refusal {
    const message = `no result of ${source} showed "${value}" in this session. Read it first with ${tool}, or correct the value. A value the test invents has from "${MADE_UP}".`;
    const last = this.rules.reads.last(source, LAST_TEXTS).map((text) => `- ${text.length > MAX_TOLD_TEXT ? `${text.slice(0, MAX_TOLD_TEXT)}…` : text}`);
    return last.length === 0 ? { code: "PLAN-DATA", message } : { code: "PLAN-DATA", message, remedy: [`Read "${value}" with ${tool}, or take a value ${source} showed you last:`, ...last].join("\n") };
  }

  /** What the gates refuse in the expects of a functional scenario. */
  private expectErrors(scenario: PlannedScenario): Refusal[] {
    const told = "Give in shows the exact text the screen displays after the action, or in absent the text it no longer displays, as you read it: a name, a number, a message.";
    const expects = scenario.steps.flatMap((step, at) => step.expects.map((expect, k) => ({ number: `${at + 1}.${k + 1}`, expect })));
    if (expects.length === 0) return [{ code: "PLAN-EXPECT", message: `no step of scenario ${scenario.id} has an expect. ${told}` }];
    const empty = expects.filter(({ expect }) => expect.shows.length + expect.absent.length === 0).map(({ number }) => ({ code: "PLAN-EXPECT", message: `expect ${number} of scenario ${scenario.id} names no text. ${told}` }));
    if (empty.length > 0 || !this.rules.screens.watches(scenario.application)) return empty;
    const shows = expects.flatMap(({ expect }) => expect.shows);
    const absent = expects.flatMap(({ expect }) => expect.absent);
    if (this.rules.screens.changedByAction(scenario.application, shows, absent)) return [];
    const tool = (action: string) => scopedToolName(scenario.application, action);
    return [{ code: "PLAN-RESULT", message: `no text scenario ${scenario.id} expects appeared, or went, after an action of yours on ${scenario.application}. Do its steps with ${tool("fill")} and ${tool("click")}, read what the result says appeared and went, and expect that.` }];
  }
}

/** Every text of a scenario the agent wrote, which the design state keeps. */
function planText(scenario: PlannedScenario): string[] {
  return [
    scenario.id,
    scenario.title,
    scenario.intent,
    ...scenario.sources.map((source) => source.item ?? ""),
    ...scenario.data.map((entry) => entry.value),
    ...scenario.steps.flatMap((step) => [step.action, ...step.expects.flatMap((expect) => [expect.result, ...expect.shows, ...expect.absent])]),
  ];
}
