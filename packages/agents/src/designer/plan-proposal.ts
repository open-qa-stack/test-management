import type {
  ExpectedElement,
  PlanEnd,
  PlannedExpect,
  PlannedScenario,
  PlanReview,
  ScenarioLevel,
  SetAsideScenario,
  TestPlan,
  ToolDefinition,
  UncoveredRequest,
} from "@open-qa-stack/domain";
import { redactText, scopedToolName, secretForms } from "@open-qa-stack/tools";
import type { Journal } from "../common/journal.ts";
import type { DuplicateJudge } from "./duplicate-judge.ts";
import { checkable, observed, sameText } from "./observed.ts";
import { PlanDraft } from "./plan-draft.ts";
import { planEndText } from "./plan-end.ts";
import { journalRefusals, maskedRefusals, refusalText, repeatedText, type Refusal } from "./refusal.ts";
import { GUIDED_REFUSALS, RefusalStreak } from "./refusal-streak.ts";
import { baseUrlVariable } from "@open-qa-stack/shared";
import { onTab } from "./tab-variable.ts";
import { screenScope, type ScreenWatch, type ShownElement, type WatchedAction } from "./screen-watch.ts";
import type { SourceWatch } from "./source-watch.ts";
import { heldVariables, type DeclaredSecret } from "./spec-rules.ts";
import type { Verified } from "./verified.ts";

/** Name of the tool the designer submits its test plan with. */
export const PLAN_TOOL = "propose_plan";
/** What the `from` of a value the test invents says. */
export const MADE_UP = "made-up";
/** The last line of what the agent is told while no plan is accepted. */
export const PLAN_NEXT = `Next: read what the brief is about and do it once on the screens, then call ${PLAN_TOOL}.`;
/** How what the agent is told of the plan accepted ends: its session is over. */
/** What a scenario of each level would add to a plan that holds none, as the agent is told before it closes the plan. */
const LEVEL_HINTS: Readonly<Record<ScenarioLevel, string>> = {
  smoke: "one scenario of one step that opens the first address of the application and expects one text of the page.",
  functional:
    "one scenario for each behaviour of a screen the brief is about, such as each way to search, each rule of a form, each message — many small scenarios, each on one screen.",
  business: "one scenario for each whole journey the brief is about, through several screens to its result.",
  "cross-application": "one scenario that does an action in one application and checks its effect in another.",
  "end-to-end": "one scenario that follows a journey through three applications or more.",
};
/** The levels of a test that acts on several applications. */
const CROSSING: ReadonlySet<ScenarioLevel> = new Set(["cross-application", "end-to-end"]);
const SESSION_OVER = "Next: answer with one sentence. Call no more tools.";
/** Plans the gates of the harness may refuse before the design stops. */
export const MAX_REFUSED_PLANS = 6;
/** How many of the last texts of a source a refused value is told with. */
const LAST_TEXTS = 5;
/** Longest part of a text of a source a refused value is told with. */
const MAX_TOLD_TEXT = 200;
/** What the agent is told of the actions of a step. */
const ACTIONS_FIELD =
  'The numbers of the actions that did this step when you explored, in the order a test does them, as the results of the browser tools gave them in "action", such as [3, 4] for a step done by the actions 3 and 4. The first action of a scenario opens an address; scenarios may cite the same actions, such as those that sign in. Empty for an application without screens.';
/** The words of the action of a step that types a value in a field; the key Enter pressed types none. */
const TYPING = /\b(?:types?|(?<!\bpress(?:es)?\s+(?:the\s+)?)enters?|fill(?:s|\s+in)?|inputs?|search(?:es)?\s+for)\b/i;
/** The words of the action of a step that opens an address. */
const NAVIGATING = /\b(?:navigates?\s+to|go(?:es)?\s+to|visits?)\b/i;
/** The words of the action of a step that clicks an element. */
const CLICKING = /\b(?:clicks?|press(?:es)?|opens?|taps?)\b/i;
/** Most actions of an application a refusal lists with their numbers, the last ones. */
const MAX_LISTED_ACTIONS = 10;
/** The words that join another action to the one that types, such as the click that sends a form: the step does more than type. */
const JOINED = /\b(?:and|then)\b/i;

/** A result a step expects, as the agent submits it: the harness adds the elements. */
type SubmittedExpect = Omit<PlannedExpect, "elements">;

/** A step of a scenario, as the agent submits it: the harness writes its code from the actions it cites. */
export interface SubmittedStep {
  /** What the user does, in one sentence. */
  readonly action: string;
  /** The numbers of the actions of the exploration that did the step, in order, as the results of the browser tools gave them. */
  readonly actions: readonly number[];
  /** What the step expects after the action. */
  readonly expects: readonly SubmittedExpect[];
}

/** A scenario of a plan, as the agent submits it. */
export interface SubmittedScenario extends Omit<PlannedScenario, "steps"> {
  /** The steps, in the order the user does them. */
  readonly steps: readonly SubmittedStep[];
}

/** A test plan, as the agent submits it with `propose_plan`. */
export interface SubmittedPlan {
  readonly scenarios: readonly SubmittedScenario[];
  /** What the brief asks and the application does not let a test do, when the agent found some. */
  readonly uncovered?: readonly UncoveredRequest[];
  /** The numbers of the proposals and the warnings of the harness the agent accepts, when it was told some. */
  readonly accepts?: readonly number[];
}

/** An expected text of a plan whose element the screens showed, with where the plan names it. */
interface LocatedText {
  /** Where the plan names the text, such as `scenario a, expect 2.1`. */
  readonly where: string;
  /** Identifier of the application of its scenario. */
  readonly application: string;
  readonly text: string;
  /** The element, as its locator was checked on the page. */
  readonly element: ShownElement;
}

/** What the harness asked the agent, once, about an element several elements share the locator of. */
interface Question extends LocatedText {
  /** Its number, which the agent accepts it by. */
  readonly number: number;
}

/** What a plan is checked against. */
export interface PlanRules {
  /** Identifiers of the sources a scenario may cite: those of the index, and every knowledge source and application the agent has tools of. */
  readonly sources: readonly string[];
  /** Identifiers of the applications a scenario may be about. */
  readonly applications: readonly string[];
  /** Identifiers of the domains of the index. */
  readonly domains: readonly string[];
  /** The levels of the pyramid of tests the plan is asked for. */
  readonly levels: readonly ScenarioLevel[];
  /** The values no plan may hold: the plan is written to the design state. */
  readonly secrets: readonly DeclaredSecret[];
  /** The addresses no expected text may hold, as `declaredAddresses` gives them: no test may hold one. */
  readonly addresses: readonly string[];
  /** What the agent saw of the screens, which the expected results of a functional scenario must come from. */
  readonly screens: ScreenWatch;
  /** What the agent read of the knowledge sources, which the data and the texts of a scenario must come from. */
  readonly reads: SourceWatch;
  /** Decides whether a plan that passes the rules may be carried out. */
  readonly review: PlanReview;
  /** The model that judges the scenarios the code could not tell from one another; the comparison by the code alone without it. */
  readonly judge?: DuplicateJudge;
  /** The clock of the dates; the system clock by default. */
  readonly now?: () => Date;
}

/**
 * The test plan of a design, submitted with `propose_plan` before any test is run.
 *
 * @remarks
 * A plan holds the scenarios its brief needs, as many as it takes, submitted in several calls: the harness
 * keeps those of a call in a `PlanDraft`, sets aside each one another already covers, and asks what the
 * brief still needs, until the agent adds nothing, its last scenarios were duplicates, or the plan is full.
 * A session that ends meanwhile closes the plan with the scenarios kept. Each names its case, its application, its
 * domain, its sources, the values its test enters and its steps; each step has one action and the results
 * it expects, with the exact texts the screen shows, or no longer shows, after it. The schema of the tool
 * checks the shape. The gates of the harness refuse, all at once and each with its code, the slugs that
 * repeat, the value of a declared variable, a plan of two functional scenarios or more without a negative
 * one, a functional scenario whose expects name no text, for an application with a user interface a
 * functional scenario none of whose texts appeared, or went, after an action of the agent, a source cited
 * and never read, a value of the data its source never showed, a value said made up that a screen or a
 * source showed before the agent typed it, an expected text no tool showed — for an application with a user
 * interface, even a value the test types or expects gone, told to type it when it is a value it invents —
 * a text expected gone the screens showed only in a field, a nominal scenario that expects gone a value it
 * typed without a step before that expects it shown, or whose steps type a value the screens searched in
 * vain — one their actions name, or any a field held when they name none — and, for an application with a user interface, a step
 * that types in a scenario without data, and a text expected shown that the screens showed only in a value
 * the agent typed or in the name of a field; a value of the data from an application is one it showed
 * beside what the agent typed; and, for an application with a user interface, a step that cites no action, an
 * action no browser tool returned or one done on another application, a scenario whose first action opens no
 * address, an action cited that typed a value that is none of the data, an action cited whose line of code
 * holds an address of the configuration, having left the screens of its application, and an expected text whose only
 * element has a locator that designated nothing the page showed; the agent may then submit another. Before the gates, the harness takes out of
 * a functional scenario of an application with a user interface each text expected shown by a step that
 * only types, followed by another step, that is a value of its data no screen showed beside the fields: the
 * field echoes it whatever the application answers. The agent is told each text taken out, in the result of
 * the plan accepted. The gates number the expects as the agent wrote them,
 * and pass over one left without a text, which the plan kept goes without. From
 * the third refusal of one reason, the agent is told only what the gate would accept, and the sixth plan the
 * gates refuse stops the design. A plan that keeps these rules is inscribed: the harness writes in each step
 * the lines of code of the actions it cites, and in each expect the element the screens showed each of its
 * texts in, when they showed it in one; the agent writes neither. Before that, the agent is asked once, in a
 * result that is no refusal, about each element several share the locator of: a proposal, when the harness
 * found the locator of one of them alone, or a warning; what it accepts with `accepts` is inscribed so, and
 * what it leaves unanswered is asserted on any of the elements, by their number. It then goes to the review, one plan at a
 * time: accepted, it is frozen, the agent is told that its session is over, and no other may be submitted;
 * refused, the design stops. An application with a user interface nothing was done on is told once, for
 * all its scenarios.
 */
export class PlanProposal {
  private readonly rules: PlanRules;
  private readonly journal: Journal;
  private plan: TestPlan | undefined;
  private refusal: string | undefined;
  private lastCodes: readonly string[] = [];
  private readonly streak = new RefusalStreak();
  private refusedPlans = 0;
  /** The questions asked, by the application and the locator of their element. */
  private readonly asked = new Map<string, Question>();
  /** The scenarios kept while the harness asks for more. */
  private readonly draft: PlanDraft<SubmittedScenario>;
  /** What the agent last said the brief asks and no scenario covers. */
  private uncovered: readonly UncoveredRequest[] = [];
  /** The numbers of the questions the agent accepted. */
  private readonly accepts = new Set<number>();
  private warnedNominal = false;
  /** The calls are taken one at a time: each adds to what the one before kept. */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * @param rules - What the plan is checked against.
   * @param journal - Where the plan accepted or refused is written.
   */
  public constructor(rules: PlanRules, journal: Journal) {
    this.rules = rules;
    this.journal = journal;
    this.draft = new PlanDraft(
      {
        verified: (scenario) => this.verified(scenario),
        described,
        ...(rules.judge === undefined ? {} : { judge: rules.judge }),
        now: rules.now ?? (() => new Date()),
      },
      journal,
    );
  }

  /**
   * Whether scenarios are kept for a plan the harness still asks about.
   *
   * @returns `true` between the first scenarios kept and the plan accepted or refused.
   */
  public get drafted(): boolean {
    return this.plan === undefined && this.refusal === undefined && this.draft.scenarios.length > 0;
  }

  /**
   * Closes the plan with the scenarios kept, once the session of the agent ended without another: the agent
   * was asked what is left to cover, and added nothing.
   */
  public async close(): Promise<void> {
    await this.serial(async () => (this.drafted ? this.settle("session-end") : undefined));
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
   * What the agent is told of every call once a plan is accepted: the session that plans is over.
   *
   * @returns The message.
   */
  public closed(): string {
    return "The plan is accepted, and this session is over. Answer with one sentence; call no more tools.";
  }

  /**
   * The message that reminds an agent which stopped before a plan was accepted.
   *
   * @returns The reminder; `undefined` once a plan is accepted or refused by the review.
   */
  public reminder(): string | undefined {
    // An agent that stops once it was asked for more scenarios has none to add.
    if (this.plan !== undefined || this.refusal !== undefined || this.drafted) return undefined;
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
      description: `Submits the test plan, once you have read the sources and done the brief once on the screens. As many scenarios as the brief needs, each verifying something the others do not: one per business rule, information or behaviour the brief is about; with two functional scenarios or more, one is negative. Each scenario gives its data (every value the test enters, with the source that showed it, or "${MADE_UP}" for a value the test invents), then its steps as a user does them. A step has one action, in actions the numbers of the browser actions that did it when you explored, and 0 to 4 expects; an expect states one result seen after the action, with in shows the exact texts the screen then displays and in absent the exact texts it no longer displays. Each step becomes one test.step, and each text one assertion: the harness writes their code and their locators from the actions you cite and the screens you saw; you never write a locator. The harness refuses a value or a text no tool showed you.`,
      parameters: {
        type: "object",
        properties: {
          scenarios: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  pattern: "^[a-z0-9]+(-[a-z0-9]+)*$",
                  description: "A slug, unique in the plan, such as search-order-by-customer; it names the test file.",
                },
                title: { type: "string", minLength: 1 },
                intent: { type: "string", minLength: 1, description: "What the scenario verifies, and why, in one sentence." },
                kind: { type: "string", enum: ["functional", "visual", "accessibility", "other"] },
                level: {
                  type: "string",
                  enum: [...this.rules.levels],
                  description:
                    "Its level in the pyramid of tests. smoke: the application answers — it opens its first address and checks one text, nothing more. functional: one screen does and shows what it must — one behaviour, such as a search by first name, on one screen. business: a whole journey through several screens ends as it must. cross-application: an action in one application has its effect in another. end-to-end: a journey goes through three applications or more.",
                },
                case: {
                  type: "string",
                  enum: ["nominal", "negative"],
                  description: "negative when the input matches nothing, is wrong or is forbidden; nominal otherwise.",
                },
                application: { type: "string", enum: [...this.rules.applications], description: "Identifier of the one application the test is about." },
                domain: { type: "string", enum: [...this.rules.domains], description: "Identifier of the domain of the index the scenario comes from." },
                sources: {
                  type: "array",
                  minItems: 1,
                  items: {
                    type: "object",
                    properties: {
                      source: {
                        type: "string",
                        enum: [...this.rules.sources],
                        description: "Identifier of a source: a knowledge source, or an application for its screens.",
                      },
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
                      from: {
                        type: "string",
                        enum: [...this.rules.sources, MADE_UP],
                        description: `The source or the application whose tool showed you the value, or ${MADE_UP}.`,
                      },
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
                      action: { type: "string", minLength: 1, description: "What the user does, in one sentence, such as: Filter the orders by their status." },
                      actions: {
                        type: "array",
                        maxItems: 12,
                        items: { type: "integer", minimum: 1 },
                        description: ACTIONS_FIELD,
                      },
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
                    required: ["action", "actions", "expects"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["id", "title", "intent", "kind", "level", "case", "application", "domain", "sources", "data", "steps"],
              additionalProperties: false,
            },
          },
          uncovered: {
            type: "array",
            maxItems: 5,
            description:
              "What the brief asks that no scenario covers — a business rule, an information, a behaviour — because the application does not let a test do it, such as an action no screen offers, or because the plan has no room for it: say it here rather than plan another test in its place without a word. Leave it out when the plan covers the brief. A plan may hold no scenario at all when it says here why no test can do what the brief asks.",
            items: {
              type: "object",
              properties: {
                asked: { type: "string", minLength: 1, maxLength: 200, description: "What the brief asks, in one sentence." },
                reason: {
                  type: "string",
                  minLength: 1,
                  maxLength: 400,
                  description: "Why no test does it: what you saw of the application or read of its sources, or that the plan has no room for it.",
                },
              },
              required: ["asked", "reason"],
              additionalProperties: false,
            },
          },
          accepts: {
            type: "array",
            maxItems: 40,
            items: { type: "integer", minimum: 1 },
            description: "The numbers of the proposals and the warnings you accept, once a result of this tool listed some; leave it out before.",
          },
        },
        required: ["scenarios"],
        additionalProperties: false,
      },
      execute: async (args) => this.serial(() => this.submit(args as SubmittedPlan)),
    };
  }

  private async submit(submitted: SubmittedPlan): Promise<string | { error: string }> {
    // Once a plan is refused, the designer refuses every call before it reaches a tool.
    if (this.plan !== undefined) return { error: this.closed() };
    if (this.refusal !== undefined) return { error: this.blocked() };
    const whole = { ...submitted, scenarios: this.draft.with(submitted.scenarios) };
    const count = this.countErrors(whole.scenarios.length, (submitted.uncovered ?? []).length > 0);
    if (count.length > 0) return this.refuse(count);
    const { plan: checked, emptied } = this.withoutEchoes(whole);
    const refusals = this.errors(checked, emptied, submitted.scenarios);
    if (refusals.length > 0) return this.refuse(refusals);
    const kept = withoutEmptied(checked, emptied);
    // Several elements share the locator of an expected text: the agent is asked about each, once.
    const open = kept.scenarios.flatMap((scenario) => this.located(scenario)).filter((located) => located.element.count > 1 && !this.asked.has(keyOf(located)));
    if (open.length > 0) return this.masked(this.ask(open));
    if (submitted.uncovered !== undefined) this.uncovered = submitted.uncovered;
    for (const number of submitted.accepts ?? []) this.accepts.add(number);
    const alone = this.nominalAlone(submitted);
    if (alone !== undefined) return this.masked(alone);
    const aside = await this.draft.keep(submitted.scenarios);
    const end = this.draft.ended(submitted.scenarios.length);
    return end === undefined ? this.masked(this.askMore(aside)) : this.settle(end, aside);
  }

  /**
   * What the gates refuse in how many scenarios a call gives: none for a plan that holds none, unless the
   * call says in `uncovered` why no test can do what the brief asks. A plan holds as many scenarios as its
   * brief takes.
   */
  private countErrors(whole: number, explained: boolean): Refusal[] {
    if (whole > 0 || explained) return [];
    return [
      {
        code: "PLAN-COUNT",
        message:
          "the plan holds no scenario. Give one scenario at least, for what the brief is about; or, when no test can do what the brief asks, say so: give in uncovered what it asks and why, with no scenario.",
      },
    ];
  }

  /** The line that names the levels asked that no scenario kept is of, so that the agent says whether the brief holds some. */
  private missingLevels(): string[] {
    const held = new Set(this.draft.scenarios.map((scenario) => scenario.level));
    const missing = this.rules.levels.filter((level) => !held.has(level));
    return missing.length === 0
      ? []
      : [
          `No scenario is of the ${missing.length === 1 ? "level" : "levels"} ${missing.join(", ")} yet, among those asked (${this.rules.levels.join(", ")}): add those the brief calls for.`,
        ];
  }

  /**
   * The warning told once to an agent that closes a plan which leaves in doubt whether its brief is covered:
   * levels asked that no scenario is of, or functional scenarios that are all of what works. The same call
   * again confirms that the brief asks nothing more, and closes the plan.
   */
  private nominalAlone(submitted: SubmittedPlan): string | undefined {
    if (submitted.scenarios.length > 0 || this.draft.scenarios.length === 0 || this.warnedNominal) return undefined;
    const functional = this.draft.scenarios.filter((scenario) => scenario.kind === "functional");
    const nominal = functional.length > 0 && !functional.some((scenario) => scenario.case === "negative");
    const held = new Set(this.draft.scenarios.map((scenario) => scenario.level));
    const missing = this.rules.levels.filter((level) => !held.has(level));
    if (!nominal && missing.length === 0) return undefined;
    this.warnedNominal = true;
    this.journal.record(
      "info",
      `The agent closed a plan that ${[...(nominal ? ["verifies only what works"] : []), ...(missing.length === 0 ? [] : [`holds no scenario of ${missing.join(", ")}`])].join(" and ")}; it was asked once whether the brief calls for more.`,
    );
    return [
      `The plan is not closed yet. It holds ${this.draft.scenarios.map((scenario) => `${scenario.id} (${scenario.level})`).join(", ")}.`,
      ...missing.map((level) => `No scenario is of the level ${level}, which is asked: ${LEVEL_HINTS[level]}`),
      ...(nominal
        ? [
            "It verifies only what works. On the screens of these scenarios, what does the application answer to an input that matches nothing, is wrong or is forbidden?",
          ]
        : []),
      `Next: do it on the screens, then call ${PLAN_TOOL} with only the scenarios to add. If the brief calls for none of this, call ${PLAN_TOOL} with "scenarios": [] again: that confirms it, and closes the plan.`,
    ].join("\n");
  }

  /**
   * What the agent is told once its scenarios are kept and the harness asks for more: those kept, those set
   * aside with why, then what is left to do. It is no refusal: the plan is not closed yet.
   */
  private askMore(aside: readonly SetAsideScenario[]): string {
    const kept = this.draft.scenarios.map((scenario) => scenario.id);
    return [
      `The plan is not closed yet. It holds ${kept.length} ${kept.length === 1 ? "scenario" : "scenarios"}: ${kept.join(", ")}.`,
      ...aside.map(setAsideLine),
      ...(this.draft.repeating
        ? [
            `Reminder: the scenarios you last submitted were duplicates. Once every case of the brief has its scenario, say so: call ${PLAN_TOOL} with "scenarios": [].`,
          ]
        : []),
      ...this.missingLevels(),
      "Does the brief ask a business rule, an information or a behaviour none of these scenarios verifies?",
      `Next: if it does, call ${PLAN_TOOL} with only the scenarios to add, each verifying what none above does; if the brief is covered, call ${PLAN_TOOL} with "scenarios": []. A scenario that bears the id of one above replaces it.`,
    ].join("\n");
  }

  /** Closes the plan with the scenarios kept: it is inscribed, then reviewed, and the session that plans is over. */
  private async settle(end: PlanEnd, aside: readonly SetAsideScenario[] = []): Promise<string | { error: string }> {
    const whole = { scenarios: this.draft.scenarios, ...(this.uncovered.length === 0 ? {} : { uncovered: this.uncovered }) };
    const { plan: checked, emptied, echoes } = this.withoutEchoes(whole);
    const { plan: inscribed, notes } = this.inscribed(withoutEmptied(checked, emptied), this.accepts);
    const setAside = this.draft.setAside;
    const plan: TestPlan = { ...inscribed, ended: end, ...(setAside.length === 0 ? {} : { setAside }) };
    const decision = await this.rules.review.review(plan);
    if (!decision.accepted) {
      this.refusal = decision.reason;
      this.journal.record("error", `The plan was refused: ${decision.reason} The design stops; no test is written.`);
      return { error: this.blocked() };
    }
    this.plan = plan;
    for (const note of [...echoes, ...notes]) this.journal.record("info", this.masked(note));
    // What the brief asks and the plan leaves out is said where a person reads it, not left in an answer of the agent.
    for (const { asked, reason } of plan.uncovered ?? [])
      this.journal.record("error", this.masked(`The plan does not cover what the brief asks: ${asked} ${reason}`));
    this.journal.record("info", `The harness asked for no more scenarios: ${planEndText(end)}`);
    this.journal.record("info", `The plan was accepted: ${plan.scenarios.map((scenario) => scenario.id).join(", ") || "no scenario"}.`);
    // What the harness took out of the plan is told to the agent, not done behind its back.
    return [
      `The plan was accepted with ${plan.scenarios.length} ${plan.scenarios.length === 1 ? "scenario" : "scenarios"}: ${planEndText(end)}`,
      ...aside.map(setAsideLine),
      ...echoes,
      SESSION_OVER,
    ]
      .map((line) => this.masked(line))
      .join("\n");
  }

  /** Takes the calls one at a time, in the order they came. */
  private serial<T>(call: () => Promise<T>): Promise<T> {
    const taken = this.queue.then(call);
    this.queue = taken.catch(() => undefined);
    return taken;
  }

  /** What a scenario does and verifies, for the comparison by the code: each step by the code of the actions it cites, and what they typed, or by its sentence when it cites none. */
  private verified(scenario: SubmittedScenario): Verified {
    return {
      application: scenario.application,
      data: scenario.data.map((entry) => entry.value),
      steps: scenario.steps.map((step) => {
        const done = this.cited(scenario, step.actions).flatMap((action) => [action.code, action.typed ?? ""]);
        return {
          does: done.length === 0 ? [step.action] : done,
          shows: step.expects.flatMap((expect) => expect.shows),
          absent: step.expects.flatMap((expect) => expect.absent),
        };
      }),
    };
  }

  /** Refuses a plan, and counts it: from the third refusal of one reason the agent is told only what the gate would accept, and the last plan stops the design. */
  private refuse(found: readonly Refusal[]): { error: string } {
    // A refusal may name a value of the plan, which may be a declared one.
    const refusals = maskedRefusals(found, (text) => this.masked(text));
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

  /** A text about the plan with the value of every declared variable masked. */
  private masked(text: string): string {
    return redactText(
      text,
      this.rules.secrets.flatMap((secret) => secretForms(secret.value)),
    );
  }

  /**
   * The plan without the echoes of what its steps type, with what the journal says of each: in a functional
   * scenario of an application with a user interface, a text expected shown by a step that only types,
   * followed by another step, that is a value of the data of the scenario no screen showed beside the fields
   * is the field echoing it, whatever the application answers. A text a line beside the fields showed, such
   * as the cell of the row a search found, is what the application answered, and stays. Each expect keeps its
   * place, so that a refusal numbers it as the agent did; those left without a text are given apart.
   */
  private withoutEchoes(plan: SubmittedPlan): { plan: SubmittedPlan; emptied: Set<SubmittedExpect>; echoes: string[] } {
    const { screens } = this.rules;
    const emptied = new Set<SubmittedExpect>();
    const echoes: string[] = [];
    const unechoed = (scenario: SubmittedScenario): SubmittedScenario => {
      if (scenario.kind !== "functional" || !screens.watches(this.scope(scenario))) return scenario;
      const echoed = (text: string) => scenario.data.some((entry) => sameText(entry.value, text)) && !screens.showsBesideFields(this.scope(scenario), text);
      const steps = scenario.steps.map((step, at) => {
        if (at === scenario.steps.length - 1 || !TYPING.test(step.action) || JOINED.test(step.action)) return step;
        const expects = step.expects.map((expect, k) => {
          if (!expect.shows.some(echoed)) return expect;
          for (const text of expect.shows.filter(echoed))
            echoes.push(`The harness took "${text}" out of expect ${at + 1}.${k + 1} of scenario ${scenario.id}: the field echoes what the step types.`);
          const kept = { ...expect, shows: expect.shows.filter((text) => !echoed(text)) };
          if (kept.shows.length + kept.absent.length === 0) emptied.add(kept);
          return kept;
        });
        return { ...step, expects };
      });
      return { ...scenario, steps };
    };
    return { plan: { ...plan, scenarios: plan.scenarios.map(unechoed) }, emptied, echoes };
  }

  /**
   * What the gates refuse in a plan its schema accepts: the count, the kinds, the sources and the shapes are
   * the schema's. The expects the harness emptied of echoes are passed over.
   */
  private errors(plan: SubmittedPlan, emptied: ReadonlySet<SubmittedExpect>, submitted: readonly SubmittedScenario[]): Refusal[] {
    // A scenario that bears the id of one kept replaces it: only the ids of one call may not repeat.
    const ids = submitted.map((scenario) => scenario.id);
    const repeated = [...new Set(ids.filter((id, at) => ids.indexOf(id) !== at))].map((id) => ({
      code: "PLAN-ID",
      message: `the id ${id} is given to several scenarios. Give each scenario its own id.`,
    }));
    // The lines of code of the actions a step cites are written to the plan, with what they typed.
    const written = (scenario: SubmittedScenario) =>
      scenario.steps.flatMap((step) => this.cited(scenario, step.actions).flatMap((done) => [done.code, done.typed ?? ""]));
    const said = (plan.uncovered ?? []).flatMap(({ asked, reason }) => [asked, reason]);
    const text = [...plan.scenarios.flatMap((scenario) => [...planText(scenario), ...written(scenario)]), ...said].join("\n");
    // A text a test would assert may not hold an address of the configuration: no test holds a host, and no text of a plan is dropped later.
    const addressed = plan.scenarios.flatMap((scenario) =>
      scenario.steps.flatMap((step, at) =>
        step.expects.flatMap((expect, k) =>
          [...expect.shows, ...expect.absent].flatMap((expected) =>
            this.rules.addresses
              .filter((address) => expected.includes(address))
              .map((address) => ({
                code: "PLAN-ADDRESS",
                message: `scenario ${scenario.id}, expect ${at + 1}.${k + 1}, names "${expected}", which holds ${address}, an address of the configuration: no test may hold a host. Leave this text out, and expect another text the screen showed after the step, such as a heading, a row or a message.`,
              })),
          ),
        ),
      ),
    );
    // An action that went to an address of the configuration left the screens of its application: its line would hold a host, which no test may.
    const elsewhere = plan.scenarios.flatMap((scenario) =>
      scenario.steps.flatMap((step, at) =>
        this.cited(scenario, step.actions).flatMap((done) =>
          this.rules.addresses
            .filter((address) => done.code.includes(address))
            .slice(0, 1)
            .map((address) => ({
              code: "PLAN-ADDRESS",
              message: `scenario ${scenario.id}, step ${at + 1}, cites the action ${done.number} (${done.code}), which holds ${address}, an address of the configuration: a test of ${scenario.application} acts on the screens of ${scenario.application} alone, reached by a path relative to its base URL. Do the step on those screens, opened with ${scopedToolName(scenario.application, "goto")} and a path such as "/orders", and cite those actions; say in uncovered what only another address offers.`,
            })),
        ),
      ),
    );
    const secrets = heldVariables(text, this.rules.secrets).map((variable) => ({
      code: "PLAN-SECRET",
      message: `the plan holds the value of ${variable}. Leave it out; a test reads it with process.env.${variable}.`,
    }));
    const functional = plan.scenarios.filter((scenario) => scenario.kind === "functional");
    const negative =
      functional.length >= 2 && !functional.some((scenario) => scenario.case === "negative")
        ? [
            {
              code: "PLAN-NEGATIVE",
              message:
                'no functional scenario is negative. One must verify what the application answers when the input matches nothing, is wrong or is forbidden; set its case to "negative".',
            },
          ]
        : [];
    const refused = [
      ...repeated,
      ...secrets,
      ...addressed,
      ...elsewhere,
      ...negative,
      ...functional.flatMap((scenario) => [...this.expectErrors(scenario, emptied), ...this.inputErrors(scenario)]),
      ...plan.scenarios.flatMap((scenario) => this.readErrors(scenario)),
      ...this.unexploredErrors(plan),
      ...plan.scenarios.flatMap((scenario) => this.actionErrors(scenario)),
      ...plan.scenarios.flatMap((scenario) => this.elementErrors(scenario)),
      ...plan.scenarios.flatMap((scenario) => this.levelErrors(scenario)),
    ];
    // A step and its expect of two screens are told once nothing else is wrong: the other refusals say more of what they refuse.
    return refused.length > 0 ? refused : plan.scenarios.flatMap((scenario) => this.screenErrors(scenario));
  }

  /** What the gates refuse in what a scenario relies on: a source it cites and nothing was read of, a value its source never showed, a text no tool showed. */
  private readErrors(scenario: SubmittedScenario): Refusal[] {
    const { screens, reads, applications } = this.rules;
    // A source without any tool is held to nothing: nothing could be read of it.
    const tool = (source: string) => (screens.watches(source) ? scopedToolName(source, "goto") : reads.firstTool(source));
    const read = (source: string) => (screens.watches(source) ? screens.looks(source) > 0 : tool(source) === undefined || reads.read(source));
    // What the agent typed in a field is no value the application gave; the address a click led to is one, such as an identifier no line shows.
    const showed = (source: string, text: string) =>
      screens.watches(source) ? screens.showsUntyped(source, text) || screens.reached(source, text) : tool(source) === undefined || reads.shows(source, text);
    const anywhere = (text: string) => applications.some((application) => screens.shows(application, text)) || reads.shows(undefined, text);
    const unread = [...new Set(scenario.sources.map((cited) => cited.source))]
      .filter((source) => !read(source))
      .map((source) => ({
        code: "PLAN-READ",
        message: `scenario ${scenario.id} cites ${source}, and you have read nothing of it. Call ${tool(source)} first.`,
      }));
    const unshown = scenario.data
      .filter((entry) => entry.from !== MADE_UP && checkable(entry.value) && !showed(entry.from, entry.value))
      .map((entry) => this.dataRefusal(entry.value, entry.from, tool(entry.from)!));
    // A source that returned a value once a field held it read what the test made, such as a row it saved.
    const typedAt = (value: string) => Math.min(...applications.map((application) => screens.typedAt(application, value) ?? Infinity));
    const readFirst = (source: string, value: string) => !screens.watches(source) && (reads.shownAt(source, value) ?? Infinity) < typedAt(value);
    const shownFirst = (value: string) =>
      applications.find((application) => screens.showsBeforeTyped(application, value)) ?? this.rules.sources.find((source) => readFirst(source, value));
    const found = scenario.data
      .filter((entry) => entry.from === MADE_UP && checkable(entry.value))
      .flatMap(({ value }) => {
        const source = shownFirst(value);
        return source === undefined
          ? []
          : [
              {
                code: "PLAN-MADE-UP",
                message: `scenario ${scenario.id} gives "${value}" as ${MADE_UP}, and ${source} showed it before you typed it: the test does not invent it. Give its source instead: { "value": ${JSON.stringify(value)}, "from": "${source}" }.`,
              },
            ];
      });
    const values = scenario.data.map((entry) => entry.value);
    const madeUp = scenario.data.filter((entry) => entry.from === MADE_UP).map((entry) => entry.value);
    const watched = screens.watches(this.scope(scenario));
    // A test finds a text on the screens of its application, as they give it, even a value it types; a base may give it otherwise.
    const seen = (text: string) => (watched ? screens.shows(this.scope(scenario), text) : anywhere(text));
    const texts = scenario.steps.flatMap((step, at) =>
      step.expects.flatMap((expect, k) =>
        [
          ...expect.shows.filter((text) => !seen(text) && (watched || !observed(text, madeUp))).map((text) => ({ text, shown: true })),
          ...expect.absent.filter((text) => !seen(text) && (watched || !observed(text, values))).map((text) => ({ text, shown: false })),
        ]
          .filter(({ text }) => checkable(text))
          .map((expected) => ({ number: `${at + 1}.${k + 1}`, step: at + 1, action: step.action, ...expected })),
      ),
    );
    // The tool that does the step, as its action reads: the one that types, opens an address or clicks; the browser tools otherwise, such as for a step that selects.
    const doing = (action: string) => {
      const tool = TYPING.test(action) ? "fill" : NAVIGATING.test(action) ? "goto" : CLICKING.test(action) ? "click" : undefined;
      return tool === undefined ? "the browser tools" : scopedToolName(scenario.application, tool);
    };
    const unseen = texts.map(({ number, step, action, text, shown }) =>
      watched && shown && observed(text, madeUp)
        ? this.untypedRefusal(scenario, number, text)
        : {
            code: "PLAN-SHOWN",
            message: `scenario ${scenario.id}, expect ${number}, names "${text}", which ${watched ? `no screen of ${scenario.application} showed in this session. Do step ${step}, ${JSON.stringify(action)}, with ${doing(action)}, then copy a text that ${shown ? "appeared" : "went"} after it, as the screen gives it.` : "nothing you read in this session showed. Copy the text as a tool of a source gives it."}`,
          },
    );
    // A field keeps what was typed in it: the line it is on goes only when the field loses the focus.
    const typedOnly = watched
      ? scenario.steps.flatMap((step, at) =>
          step.expects.flatMap((expect, k) =>
            expect.absent
              .filter((text) => checkable(text) && seen(text) && !screens.showsBesideFields(this.scope(scenario), text))
              .map((text) => ({
                code: "PLAN-SHOWN",
                message: `scenario ${scenario.id}, expect ${at + 1}.${k + 1}, names in absent "${text}", which the screens of ${scenario.application} showed only in a field: the field keeps what you typed whatever the application answers. Put in absent a text the action removed, such as a row the search filtered out.`,
              })),
          ),
        )
      : [];
    return [...unread, ...unshown, ...found, ...unseen, ...typedOnly, ...this.nominalErrors(scenario)];
  }

  /**
   * What the gates refuse in a nominal scenario of an application with a user interface: a text it expects
   * gone that holds a value it typed and that a screen showed beside the fields, which says that what it
   * searched found nothing, unless a step before expects the value shown: the scenario then removes what it
   * made or found; and, in one whose steps type, a value of its data the agent searched in vain on the screens.
   */
  private nominalErrors(scenario: SubmittedScenario): Refusal[] {
    const { screens } = this.rules;
    const { application } = scenario;
    if (scenario.case !== "nominal" || !screens.watches(this.scope(scenario))) return [];
    const values = scenario.data.map((entry) => entry.value).filter(checkable);
    const typed = values.filter((value) => screens.typed(this.scope(scenario), value));
    // What the steps type: the values their actions name, or, when they name none, every value a field held.
    const typing = scenario.steps.filter((step) => TYPING.test(step.action)).map((step) => step.action);
    const named = values.filter((value) => observed(value, typing));
    const entered = typing.length === 0 ? [] : named.length > 0 ? named : typed;
    const fill = scopedToolName(application, "fill");
    const missed = entered
      .filter((value) => screens.unmatched(this.scope(scenario), value))
      .map((value) => ({
        code: "PLAN-NOMINAL",
        message: `scenario ${scenario.id} is nominal, and the screens of ${application} found nothing with "${value}": a nominal scenario finds what it searches. Replace "${value}" in data, and in the step that types it, by a part of it, such as a first or a last name, that you searched with ${fill} and found, and expect what it found; or make the scenario negative.`,
        remedy: `Replace "${value}" in data of scenario ${scenario.id}, and in the step that types it, by a part of it that ${fill} found, such as a first or a last name; or make scenario ${scenario.id} negative.`,
      }));
    const expected = scenario.steps.flatMap((step, at) => {
      const shownBefore = scenario.steps.slice(0, at).flatMap((earlier) => earlier.expects.flatMap((expect) => expect.shows));
      return step.expects.flatMap((expect, k) =>
        expect.absent
          .filter((text) => screens.showsBesideFields(this.scope(scenario), text))
          .flatMap((text) => {
            const value = typed.find((candidate) => observed(candidate, [text]) && !observed(candidate, shownBefore));
            return value === undefined
              ? []
              : [
                  {
                    code: "PLAN-NOMINAL",
                    message: `scenario ${scenario.id} is nominal: its data is what it finds, and "${text}" in absent of expect ${at + 1}.${k + 1} says it finds nothing. Put it in shows, or make the scenario negative; if a step removes it, put it in shows of the step before that makes or finds it. If the screens found nothing with "${value}", try a part of it, such as a first or a last name, with the browser tools.`,
                  },
                ];
          }),
      );
    });
    return [...missed, ...expected];
  }

  /**
   * The refusal of an expected text of a scenario of an application with a user interface that is a value it
   * invents no screen showed, not even in a field: the agent never typed it. What the gate would accept is
   * the value typed, as the last line of code that filled a field did, and the answer of the screen expected.
   */
  private untypedRefusal(scenario: SubmittedScenario, number: string, text: string): Refusal {
    const fill = scopedToolName(scenario.application, "fill");
    const typed = this.rules.screens.codes(this.scope(scenario)).find((code) => code.includes(".fill("));
    return {
      code: "PLAN-SHOWN",
      message: `scenario ${scenario.id}, expect ${number}, names "${text}", a value of its data that no field of ${scenario.application} held in this session. Type it with ${fill} and do the step, then expect what the screen answered: the field only echoes the value.`,
      remedy: [
        `Type "${text}" with ${fill} and do the step, then put in shows what the screen answered after it, such as a message or a count of results.`,
        ...(typed === undefined ? [] : [`The last line of code that filled a field, with another value: ${typed}`]),
      ].join("\n"),
    };
  }

  /**
   * What the gates refuse in the input of a functional scenario of an application with a user interface: a
   * step whose action types a value, when the scenario has no data, which its test could type none of; and a
   * text expected shown that the screens showed only in fields, by a value the agent typed, which the field
   * echoes whatever the application answers, or by the name of a field, which no text of the page holds.
   */
  private inputErrors(scenario: SubmittedScenario): Refusal[] {
    const { screens } = this.rules;
    const { application } = scenario;
    if (!screens.watches(this.scope(scenario))) return [];
    const typing =
      scenario.data.length > 0
        ? []
        : scenario.steps
            .map((step, at) => ({ action: step.action, number: at + 1 }))
            .filter(({ action }) => TYPING.test(action))
            .map(({ action, number }) => ({
              code: "PLAN-INPUT",
              message: `scenario ${scenario.id}, step ${number}, "${action}", types a value, and the scenario has no data: its test may type only values of its data. Put the value the step types in data, with from "${application}" for one a screen of ${application} showed, or from "${MADE_UP}" for one the test invents, such as { "value": "zqxw", "from": "${MADE_UP}" }. A step that types nothing, such as one that leaves a field empty, says what it clicks instead.`,
            }));
    const fielded = scenario.steps.flatMap((step, at) =>
      step.expects.flatMap((expect, k) =>
        expect.shows.filter(checkable).flatMap((text) => {
          const held = screens.onlyInFields(this.scope(scenario), text);
          const named = `scenario ${scenario.id}, expect ${at + 1}.${k + 1}, names "${text}", which the screens of ${application} showed only`;
          if (held === "typed")
            return [
              {
                code: "PLAN-INPUT",
                message: `${named} in a field you typed it in: the field echoes what the test types, whatever the application answers. Put in shows what the application answered beside the fields, such as a row, a message or a count of results.`,
              },
            ];
          if (held === "name")
            return [
              {
                code: "PLAN-INPUT",
                message: `${named} as the name of a field: no text of the page holds it, and a test finds the field by it. Put in shows a text the screens showed beside the fields, such as a heading, a row or a count of results.`,
              },
            ];
          return [];
        }),
      ),
    );
    return [...typing, ...fielded];
  }

  /** The actions a step of a scenario cites that the screens know and that were done on its application, in the order cited. */
  private cited(scenario: SubmittedScenario, numbers: readonly number[]): WatchedAction[] {
    return numbers.flatMap((number) => {
      const done = this.rules.screens.action(number);
      return done !== undefined && (done.application === scenario.application || CROSSING.has(scenario.level)) ? [done] : [];
    });
  }

  /** The expected texts of a scenario the screens showed in an element, in the order of the plan. */
  private located(scenario: SubmittedScenario): LocatedText[] {
    const { application } = scenario;
    return scenario.steps.flatMap((step, at) =>
      step.expects.flatMap((expect, k) =>
        [...expect.shows.map((text) => ({ text, gone: false })), ...expect.absent.map((text) => ({ text, gone: true }))].flatMap(({ text, gone }) => {
          const done = this.cited(scenario, step.actions).map((action) => action.number);
          const element = this.rules.screens.locatorOf(this.scope(scenario), text, gone, done);
          return element === undefined ? [] : [{ where: `scenario ${scenario.id}, expect ${at + 1}.${k + 1}`, application, text, element }];
        }),
      ),
    );
  }

  /**
   * What the gates refuse in the elements of the expected texts of a scenario: a text whose only element has
   * a locator that designated nothing the page showed while the screen showed the text, which a test could
   * not find.
   */
  private elementErrors(scenario: SubmittedScenario): Refusal[] {
    const snapshot = scopedToolName(scenario.application, "snapshot");
    return this.located(scenario)
      .filter(({ element }) => element.count === 0)
      .map(({ where, text, element }) => ({
        code: "PLAN-ELEMENT",
        message: `${where}, names "${text}", and its element, ${element.locator}, designated nothing the page showed when the harness looked for it: a test would not find it. Take ${snapshot} of the screen that shows the text, then expect a text as a line of that snapshot gives it, such as the name of a heading or of a row, or the text of a message.`,
      }));
  }

  /**
   * Asks the agent, once, about each element several elements share the locator of: a proposal, when the
   * harness found the locator of one of them alone, which the agent checks; a warning otherwise, which the
   * agent confirms when any of the elements will do. The plan is not accepted yet.
   */
  private ask(open: readonly LocatedText[]): string {
    const told: string[] = [];
    for (const located of open) {
      const key = keyOf(located);
      if (this.asked.has(key)) continue;
      const question = { ...located, number: this.asked.size + 1 };
      this.asked.set(key, question);
      const { number, where, application, text, element } = question;
      const shown = `"${text}" (${where}) is shown by ${element.count} elements of ${application}`;
      const precise = "expect a more precise text, such as the text of the whole row";
      if (element.narrower === undefined) {
        this.journal.record(
          "info",
          this.masked(`The harness warned the agent (${number}) that ${element.count} elements share ${element.locator}, which shows "${text}".`),
        );
        told.push(
          `Warning ${number}: ${shown}, and the harness found no locator of one of them alone. If any of them will do, put ${number} in accepts: the test will then assert that one of them at least shows it, or that none is left. Otherwise ${precise}.`,
        );
      } else {
        this.journal.record(
          "info",
          this.masked(
            `The harness proposed to the agent (${number}) to assert "${text}" on ${element.narrower}: ${element.count} elements share ${element.locator}.`,
          ),
        );
        told.push(
          `Proposal ${number}: ${shown}. The harness proposes to assert it on one of them alone: ${element.narrower}. Check that it is the element you mean: if it is, put ${number} in accepts. Otherwise ${precise}.`,
        );
      }
    }
    return [
      `The plan is not accepted yet. The harness looked on the page for the element of each expected text, and asks you about ${told.length} of them, once:`,
      ...told,
      `Next: call ${PLAN_TOOL} again with the plan, what you correct in it, and accepts. What you leave unanswered is asserted on any of its elements, and is not asked again.`,
    ].join("\n");
  }

  /**
   * The plan as it is kept, and what the journal says of the questions it settles: each step with the lines
   * of code of the actions it cites, in place of their numbers, and each expect with the element the screens
   * showed each of its texts in, for those they showed in one. An element several share the locator of is
   * the one the harness proposed, when the agent accepted it, and any of them otherwise, by their number.
   */
  private inscribed(plan: SubmittedPlan, accepts: ReadonlySet<number>): { plan: TestPlan; notes: string[] } {
    const notes = new Set<string>();
    const elementOf = (located: LocatedText): ExpectedElement => {
      const { text, element } = located;
      if (element.count === 1) return { text, locator: element.locator, field: element.field };
      // The gates refused an element whose locator designated nothing, and each one several share was asked about.
      const question = this.asked.get(keyOf(located))!;
      const { number, element: asked } = question;
      const any = `"${question.text}" is asserted on any of the ${asked.count} elements ${asked.locator}`;
      if (!accepts.has(number)) notes.add(`The agent left ${asked.narrower === undefined ? "warning" : "proposal"} ${number} unanswered: ${any}.`);
      else if (asked.narrower === undefined) notes.add(`The agent accepted warning ${number}: ${any}.`);
      else {
        notes.add(`The agent accepted proposal ${number}: "${question.text}" is asserted on ${asked.narrower}.`);
        return { text, locator: asked.narrower, field: false };
      }
      return { text, locator: asked.locator, field: false, count: asked.count };
    };
    const scenarios = plan.scenarios.map((scenario) => {
      const elements = this.located(scenario).map((located) => ({ where: located.where, element: elementOf(located) }));
      const steps = scenario.steps.map(({ action, actions, expects }, at) => ({
        action,
        ...stepApplication(scenario.application, this.cited(scenario, actions)),
        code: this.cited(scenario, actions).map((done) => (done.application === scenario.application ? done.code : elsewhere(done))),
        expects: expects.map((expect, k) => ({
          ...expect,
          elements: elements.filter(({ where }) => where === `scenario ${scenario.id}, expect ${at + 1}.${k + 1}`).map(({ element }) => element),
        })),
      }));
      const others = screenScope([
        scenario.application,
        ...this.cited(
          scenario,
          scenario.steps.flatMap((step) => step.actions),
        ).map((done) => done.application),
      ])
        .split("+")
        .slice(1);
      return { ...scenario, ...(others.length === 0 ? {} : { applications: others }), steps };
    });
    const uncovered = plan.uncovered ?? [];
    return { plan: { scenarios, ...(uncovered.length === 0 ? {} : { uncovered }) }, notes: [...notes] };
  }

  /**
   * What the gates refuse, once for each application with a user interface nothing was done on, whatever the
   * number of its scenarios and of their steps: the harness could write the code of none of them.
   */
  private unexploredErrors(plan: SubmittedPlan): Refusal[] {
    const { screens } = this.rules;
    const applications = [...new Set(plan.scenarios.map((scenario) => scenario.application))];
    return applications
      .filter((application) => screens.watches(application) && screens.actions(application).length === 0)
      .map((application) => {
        const ids = plan.scenarios.filter((scenario) => scenario.application === application).map((scenario) => scenario.id);
        const goto = scopedToolName(application, "goto");
        return {
          code: "PLAN-LOCATOR",
          message: `you did nothing on the screens of ${application} in this session, and ${ids.length === 1 ? "scenario" : "the scenarios"} ${ids.join(", ")} ${ids.length === 1 ? "is" : "are"} about it: the harness writes the code of each step from the actions that did it. Open the first address of each scenario with ${goto}, do its steps with the browser tools, then give in actions of each step the numbers their results return in "action", such as "actions": [1, 2] for a step done by the actions 1 and 2.`,
        };
      });
  }

  /**
   * What the gates refuse in the actions the steps of a scenario of an application with a user interface
   * something was done on cite: a step that cites none, an action no browser tool returned or one done on another application,
   * which the harness could write no code from; a first action that opens no address, the test starting on an
   * empty page; and an action that typed a value that is none of the data of the scenario, whose line its
   * test could not keep.
   */
  private actionErrors(scenario: SubmittedScenario): Refusal[] {
    const { screens } = this.rules;
    const { application } = scenario;
    const done = screens.actions(this.scope(scenario));
    // An application nothing was done on is told once, for all its scenarios.
    if (done.length === 0) return [];
    const tool = (action: string) => scopedToolName(application, action);
    const listed = done.slice(-MAX_LISTED_ACTIONS).map((action) => `${action.number}: ${action.code}`);
    const remedy = [
      `Give in actions of each step the numbers of the actions that did it. The last actions on ${application}, each after its number:`,
      ...listed,
    ].join("\n");
    const values = scenario.data.map((entry) => entry.value);
    const inData = (typed: string) => typed === "" || values.includes(typed) || (checkable(typed) && observed(typed, values));
    const refusals = scenario.steps.flatMap((step, at): Refusal[] => {
      const where = `scenario ${scenario.id}, step ${at + 1}, ${JSON.stringify(step.action)},`;
      if (step.actions.length === 0)
        return [
          {
            code: "PLAN-LOCATOR",
            message: `${where} cites no action: the harness writes the code of a step from the actions that did it. Do the step with the browser tools of ${application}, such as ${tool("click")}, then give in actions the numbers their results return in "action", such as "actions": [3, 4] for a step done by the actions 3 and 4.`,
            remedy,
          },
        ];
      return step.actions.flatMap((number): Refusal[] => {
        const cited = screens.action(number);
        if (cited === undefined)
          return [
            {
              code: "PLAN-LOCATOR",
              message: `${where} cites the action ${number}, which no browser tool returned in this session. Give in actions the numbers the results of the browser tools of ${application} return in "action"; do the step again if you no longer have them.`,
              remedy,
            },
          ];
        if (cited.application !== application && !CROSSING.has(scenario.level))
          return [
            {
              code: "PLAN-LOCATOR",
              message: `${where} cites the action ${number}, done on ${cited.application}: a test of ${application} acts on ${application} alone. Do the step with the browser tools of ${application}, such as ${tool("click")}, and cite the numbers their results return in "action".`,
              remedy,
            },
          ];
        if (cited.typed === undefined) return [];
        const [credential] = heldVariables(cited.typed, this.rules.secrets);
        if (credential !== undefined)
          return [
            {
              code: "PLAN-INPUT",
              message: `${where} cites the action ${number}, which typed the value of ${credential} as a text: a test never holds it. Do the step again with ${tool("fill")} and the reference of the account in place of the text, such as "value": { "account": "<its name>", "field": "password" }, as the description of ${tool("fill")} gives it, then cite that action.`,
            },
          ];
        if (inData(cited.typed)) return [];
        const typed = JSON.stringify(cited.typed);
        return [
          {
            code: "PLAN-INPUT",
            message: `${where} cites the action ${number}, which typed ${typed}, and ${typed} is no value of the data of the scenario: its test may type only values of its data. Put it in data, with from "${application}" for a value a screen of ${application} showed before you typed it, or from "${MADE_UP}" for one the test invents, such as { "value": ${typed}, "from": "${MADE_UP}" }; or do the step again with a value of the data, and cite that action.`,
          },
        ];
      });
    });
    // A test of several applications opens a tab for each other one: the tab is empty until an address is opened on it.
    const order = this.cited(
      scenario,
      scenario.steps.flatMap((step) => step.actions),
    );
    for (const action of order) {
      const opening = order.find((other) => other.application === action.application)!;
      if (action === opening && action.application !== application && action.tool !== "goto")
        refusals.push({
          code: "PLAN-START",
          message: `scenario ${scenario.id} cites the action ${action.number} (${action.code}) as the first it does on ${action.application}, and it opens no address: its test opens a tab for ${action.application}, empty until an address is opened on it. Open the address with ${scopedToolName(action.application, "goto")}, do the step from there, and cite that action before the action ${action.number}.`,
        });
    }
    const first = this.cited(scenario, scenario.steps[0]!.actions)[0];
    if (first === undefined || first.tool === "goto") return refusals;
    const opened = done.findLast((action) => action.tool === "goto");
    const example = opened === undefined ? "" : `, such as the action ${opened.number} (${opened.code})`;
    return [
      ...refusals,
      {
        code: "PLAN-START",
        message: `scenario ${scenario.id} starts with the action ${first.number} (${first.code}), which opens no address, and its test starts on an empty page. Open the first address of the scenario with ${tool("goto")}, do its steps from there, and cite that action first in step 1${example}.`,
        remedy: `Cite first, in actions of step 1 of scenario ${scenario.id}, an action of ${tool("goto")}${example}, then the actions done after it.`,
      },
    ];
  }

  /**
   * The scope the screens are asked about for a scenario: its application, with those its cited actions
   * were done on when its level is one of a test that acts on several.
   */
  private scope(scenario: SubmittedScenario): string {
    if (!CROSSING.has(scenario.level)) return scenario.application;
    const acted = scenario.steps.flatMap((step) => this.cited(scenario, step.actions).map((action) => action.application));
    return screenScope([scenario.application, ...acted]);
  }

  /**
   * What the gates refuse in the level of a scenario, held to what its cited actions went through: a level the
   * plan is not asked for; a smoke test that does more than open an address; a functional test that leaves its
   * screen; a business test that stays on one. A scenario none of whose actions said where the page was is
   * held to no number of screens.
   */
  private levelErrors(scenario: SubmittedScenario): Refusal[] {
    const { level, id } = scenario;
    const where = `scenario ${id} is of the level ${level}`;
    const refused = (message: string): Refusal[] => [{ code: "PLAN-LEVEL", message }];
    if (!this.rules.levels.includes(level))
      return refused(
        `${where}, which this plan is not asked for. The levels asked: ${this.rules.levels.join(", ")}. Give it one of them, or leave the scenario out and say so in uncovered.`,
      );
    const cited = this.cited(
      scenario,
      scenario.steps.flatMap((step) => step.actions),
    );
    const applications = [...new Set(cited.map((action) => action.application))];
    const acted = `its actions were done on ${applications.length === 1 ? "one application" : `${applications.length} applications`} (${applications.join(", ")})`;
    if (level === "cross-application")
      return applications.length === 2
        ? []
        : refused(
            `${where}, and ${acted}: such a test does an action in one application and checks its effect in another. Do it on both and cite the actions of each, or give it the level ${applications.length === 1 ? "business" : "end-to-end"}.`,
          );
    if (level === "end-to-end")
      return applications.length >= 3
        ? []
        : refused(
            `${where}, and ${acted}: such a test goes through three applications or more. Do the journey through the others too, or give it the level ${applications.length === 1 ? "business" : "cross-application"}.`,
          );
    if (level === "smoke")
      return cited.every((action) => action.tool === "goto")
        ? []
        : refused(
            `${where}, and one of its actions does more than open an address: a smoke test checks that the application answers, nothing more. Keep the action that opens its first address and one text the page then shows, or give it the level functional.`,
          );
    const screens = [...new Set(cited.flatMap((action) => action.screen ?? []))];
    const went = `its actions went through ${screens.length} ${screens.length === 1 ? "screen" : "screens"} (${screens.join(", ")})`;
    if (level === "functional" && screens.length > 1)
      return refused(
        `${where}, and ${went}: a functional test verifies one behaviour of one screen. Give it the level business when it verifies the journey through these screens; otherwise keep the steps of one screen, and open that screen by its address.`,
      );
    if (level === "business" && screens.length === 1)
      return refused(
        `${where}, and ${went}: a business test follows a journey through several screens to its result. Give it the level functional, or do the whole journey on the screens and cite its actions.`,
      );
    return [];
  }

  /**
   * What the gates refuse in the texts a step expects shown: one the screen did not show after any action the
   * step cites, while it did after another action. The step and its expect are then of two screens, and the
   * test written from the cited actions would look for the text where the application does not show it.
   */
  private screenErrors(scenario: SubmittedScenario): Refusal[] {
    const { screens } = this.rules;
    return scenario.steps.flatMap((step, at) => {
      const cited = this.cited(scenario, step.actions).map((action) => action.number);
      if (cited.length === 0) return [];
      return step.expects.flatMap((expect, k) =>
        expect.shows.filter(checkable).flatMap((text): Refusal[] => {
          const after = screens.shownAfter(this.scope(scenario), text);
          if (after.length === 0 || cited.some((number) => after.includes(number))) return [];
          return [
            {
              code: "PLAN-SHOWN",
              message: `scenario ${scenario.id}, expect ${at + 1}.${k + 1}, names "${text}", which the screen did not show after the actions step ${at + 1} cites (${cited.join(", ")}): it showed it after the action ${after.at(-1)}. A test written from these actions would not find it. Cite in actions the ones that led to the screen that showed "${text}", or expect what the screen showed after the action ${cited.at(-1)}.`,
            },
          ];
        }),
      );
    });
  }

  /** The refusal of a value its source never showed, with the last texts a knowledge source returned as what the gate would accept. */
  private dataRefusal(value: string, source: string, tool: string): Refusal {
    const message = `no result of ${source} showed "${value}" in this session. Read it first with ${tool}, or correct the value. A value the test invents has from "${MADE_UP}".`;
    const last = this.rules.reads.last(source, LAST_TEXTS).map((text) => `- ${text.length > MAX_TOLD_TEXT ? `${text.slice(0, MAX_TOLD_TEXT)}…` : text}`);
    return last.length === 0
      ? { code: "PLAN-DATA", message }
      : { code: "PLAN-DATA", message, remedy: [`Read "${value}" with ${tool}, or take a value ${source} showed you last:`, ...last].join("\n") };
  }

  /** What the gates refuse in the expects of a functional scenario, but those the harness emptied of echoes. */
  private expectErrors(scenario: SubmittedScenario, emptied: ReadonlySet<SubmittedExpect>): Refusal[] {
    const told =
      "Give in shows the exact text the screen displays after the action, or in absent the text it no longer displays, as you read it: a name, a number, a message.";
    const expects = scenario.steps
      .flatMap((step, at) => step.expects.map((expect, k) => ({ number: `${at + 1}.${k + 1}`, expect })))
      .filter(({ expect }) => !emptied.has(expect));
    if (expects.length === 0) return [{ code: "PLAN-EXPECT", message: `no step of scenario ${scenario.id} has an expect. ${told}` }];
    const empty = expects
      .filter(({ expect }) => expect.shows.length + expect.absent.length === 0)
      .map(({ number }) => ({ code: "PLAN-EXPECT", message: `expect ${number} of scenario ${scenario.id} names no text. ${told}` }));
    if (empty.length > 0 || !this.rules.screens.watches(this.scope(scenario))) return empty;
    const shows = expects.flatMap(({ expect }) => expect.shows);
    const absent = expects.flatMap(({ expect }) => expect.absent);
    if (this.rules.screens.changedByAction(this.scope(scenario), shows, absent)) return [];
    const tool = (action: string) => scopedToolName(scenario.application, action);
    return [
      {
        code: "PLAN-RESULT",
        message: `no text scenario ${scenario.id} expects appeared, or went, after an action of yours on ${scenario.application}. Do its steps with ${tool("goto")}, ${tool("fill")} and ${tool("click")}, read what the page shows once opened and what each result says appeared and went, and expect that.`,
      },
    ];
  }
}

/** The application the expects of a step are asserted on, when it is not that of its test: the one its last cited action was done on. */
function stepApplication(own: string, cited: readonly WatchedAction[]): { readonly application?: string } {
  const last = cited.at(-1)?.application;
  return last === undefined || last === own ? {} : { application: last };
}

/**
 * The line of code of an action done on another application than that of its test. Such a test opens a tab
 * for each other application: the line acts on that tab, and an address is opened on the base address the
 * harness gives for the application, which the test reads from the environment.
 */
function elsewhere(done: WatchedAction): string {
  const based = done.code.replace(/^await page\.goto\((".*")\);$/, `await page.goto(new URL($1, process.env.${baseUrlVariable(done.application)}).href);`);
  return onTab(based, done.application);
}

/** What the agent is told of a scenario set aside: which one covers it, who decided and why. */
function setAsideLine({ id, duplicates, origin, reason }: SetAsideScenario): string {
  return `Set aside (${origin.by === "harness" ? origin.check : "plan reviewer"}): scenario ${id} is a duplicate of ${duplicates}. ${reason}`;
}

/** What a scenario does and verifies, as the judge of duplicates reads it. */
function described(scenario: SubmittedScenario): string {
  const texts = (label: string, list: readonly string[]) => (list.length === 0 ? [] : [`${label} ${list.map((text) => JSON.stringify(text)).join(", ")}`]);
  return [
    `${scenario.title} (${scenario.case}, ${scenario.application}). ${scenario.intent}`,
    ...(scenario.data.length === 0 ? [] : [`Enters: ${scenario.data.map((entry) => JSON.stringify(entry.value)).join(", ")}`]),
    ...scenario.steps.map((step, at) => {
      const expected = step.expects.flatMap((expect) => [expect.result, ...texts("shows", expect.shows), ...texts("no longer shows", expect.absent)]);
      return `${at + 1}. ${step.action}${expected.length === 0 ? "" : ` -> ${expected.join("; ")}`}`;
    }),
  ].join("\n");
}

/** What tells an element of an application from another: its application and its locator. */
function keyOf({ application, element }: Pick<LocatedText, "application" | "element">): string {
  return `${application}\n${element.locator}`;
}

/** A plan without the expects the harness emptied of echoes. */
function withoutEmptied(plan: SubmittedPlan, emptied: ReadonlySet<SubmittedExpect>): SubmittedPlan {
  const scenarios = plan.scenarios.map((scenario) => ({
    ...scenario,
    steps: scenario.steps.map((step) => ({ ...step, expects: step.expects.filter((expect) => !emptied.has(expect)) })),
  }));
  return { ...plan, scenarios };
}

/** Every text of a scenario the agent wrote, which the design state keeps. */
function planText(scenario: SubmittedScenario): string[] {
  return [
    scenario.id,
    scenario.title,
    scenario.intent,
    ...scenario.sources.map((source) => source.item ?? ""),
    ...scenario.data.map((entry) => entry.value),
    ...scenario.steps.flatMap((step) => [step.action, ...step.expects.flatMap((expect) => [expect.result, ...expect.shows, ...expect.absent])]),
  ];
}
