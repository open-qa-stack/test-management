import type { ExpectedElement, PlannedExpect, PlannedScenario, PlanReview, TestPlan, ToolDefinition } from "@open-qa-stack/domain";
import { redactText, scopedToolName, secretForms } from "@open-qa-stack/tools";
import type { Journal } from "../common/journal.ts";
import { checkable, observed, sameText } from "./observed.ts";
import { journalRefusals, maskedRefusals, refusalText, repeatedText, type Refusal } from "./refusal.ts";
import { GUIDED_REFUSALS, RefusalStreak } from "./refusal-streak.ts";
import type { ScreenWatch, WatchedAction } from "./screen-watch.ts";
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
}

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
 * address, and an action cited that typed a value that is none of the data; the agent may then submit another. Before the gates, the harness takes out of
 * a functional scenario of an application with a user interface each text expected shown by a step that
 * only types, followed by another step, that is a value of its data no screen showed beside the fields: the
 * field echoes it whatever the application answers. The gates number the expects as the agent wrote them,
 * and pass over one left without a text, which the plan kept goes without. From
 * the third refusal of one reason, the agent is told only what the gate would accept, and the sixth plan the
 * gates refuse stops the design. A plan that keeps these rules is inscribed: the harness writes in each step
 * the lines of code of the actions it cites, and in each expect the element the screens showed each of its
 * texts in, when they showed it in one; the agent writes neither. It then goes to the review, one plan at a
 * time: accepted, it is frozen, and no other may be submitted; refused, the design stops.
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
      description: `Submits the test plan, once you have read the sources and done the brief once on the screens. ${MIN_TESTS} to ${MAX_TESTS} scenarios; with two functional scenarios or more, one is negative. Each scenario gives its data (every value the test enters, with the source that showed it, or "${MADE_UP}" for a value the test invents), then its steps as a user does them. A step has one action, in actions the numbers of the browser actions that did it when you explored, and 0 to 4 expects; an expect states one result seen after the action, with in shows the exact texts the screen then displays and in absent the exact texts it no longer displays. Each step becomes one test.step, and each text one assertion: the harness writes their code and their locators from the actions you cite and the screens you saw; you never write a locator. The harness refuses a value or a text no tool showed you.`,
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
                id: {
                  type: "string",
                  pattern: "^[a-z0-9]+(-[a-z0-9]+)*$",
                  description: "A slug, unique in the plan, such as search-order-by-customer; it names the test file.",
                },
                title: { type: "string", minLength: 1 },
                intent: { type: "string", minLength: 1, description: "What the scenario verifies, and why, in one sentence." },
                kind: { type: "string", enum: ["functional", "visual", "accessibility", "other"] },
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
              required: ["id", "title", "intent", "kind", "case", "application", "domain", "sources", "data", "steps"],
              additionalProperties: false,
            },
          },
        },
        required: ["scenarios"],
        additionalProperties: false,
      },
      execute: async (args) => this.submit(args as SubmittedPlan),
    };
  }

  private async submit(submitted: SubmittedPlan): Promise<string | { error: string }> {
    // Once a plan is refused, the designer refuses every call before it reaches a tool.
    if (this.plan !== undefined) return { error: "A plan was already accepted; carry it out." };
    const { plan: checked, emptied, echoes } = this.withoutEchoes(submitted);
    const refusals = this.errors(checked, emptied);
    if (refusals.length > 0) return this.refuse(refusals);
    const plan = this.inscribed(withoutEmptied(checked, emptied));
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
    for (const echo of echoes) this.journal.record("info", this.masked(echo));
    this.journal.record("info", `The plan was accepted: ${plan.scenarios.map((scenario) => scenario.id).join(", ")}.`);
    return `The plan was accepted.\n\n${this.rules.carry(plan)}`;
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
      if (scenario.kind !== "functional" || !screens.watches(scenario.application)) return scenario;
      const echoed = (text: string) => scenario.data.some((entry) => sameText(entry.value, text)) && !screens.showsBesideFields(scenario.application, text);
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
  private errors(plan: SubmittedPlan, emptied: ReadonlySet<SubmittedExpect>): Refusal[] {
    const ids = plan.scenarios.map((scenario) => scenario.id);
    const repeated = [...new Set(ids.filter((id, at) => ids.indexOf(id) !== at))].map((id) => ({
      code: "PLAN-ID",
      message: `the id ${id} is given to several scenarios. Give each scenario its own id.`,
    }));
    // The lines of code of the actions a step cites are written to the plan, with what they typed.
    const written = (scenario: SubmittedScenario) =>
      scenario.steps.flatMap((step) => this.cited(scenario, step.actions).flatMap((done) => [done.code, done.typed ?? ""]));
    const text = plan.scenarios.flatMap((scenario) => [...planText(scenario), ...written(scenario)]).join("\n");
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
    return [
      ...repeated,
      ...secrets,
      ...negative,
      ...functional.flatMap((scenario) => [...this.expectErrors(scenario, emptied), ...this.inputErrors(scenario)]),
      ...plan.scenarios.flatMap((scenario) => this.readErrors(scenario)),
      ...plan.scenarios.flatMap((scenario) => this.actionErrors(scenario)),
    ];
  }

  /** What the gates refuse in what a scenario relies on: a source it cites and nothing was read of, a value its source never showed, a text no tool showed. */
  private readErrors(scenario: SubmittedScenario): Refusal[] {
    const { screens, reads, applications } = this.rules;
    // A source without any tool is held to nothing: nothing could be read of it.
    const tool = (source: string) => (screens.watches(source) ? scopedToolName(source, "goto") : reads.firstTool(source));
    const read = (source: string) => (screens.watches(source) ? screens.looks(source) > 0 : tool(source) === undefined || reads.read(source));
    // What the agent typed in a field is no value the application gave.
    const showed = (source: string, text: string) =>
      screens.watches(source) ? screens.showsUntyped(source, text) : tool(source) === undefined || reads.shows(source, text);
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
    const watched = screens.watches(scenario.application);
    // A test finds a text on the screens of its application, as they give it, even a value it types; a base may give it otherwise.
    const seen = (text: string) => (watched ? screens.shows(scenario.application, text) : anywhere(text));
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
              .filter((text) => checkable(text) && seen(text) && !screens.showsBesideFields(scenario.application, text))
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
    if (scenario.case !== "nominal" || !screens.watches(application)) return [];
    const values = scenario.data.map((entry) => entry.value).filter(checkable);
    const typed = values.filter((value) => screens.typed(application, value));
    // What the steps type: the values their actions name, or, when they name none, every value a field held.
    const typing = scenario.steps.filter((step) => TYPING.test(step.action)).map((step) => step.action);
    const named = values.filter((value) => observed(value, typing));
    const entered = typing.length === 0 ? [] : named.length > 0 ? named : typed;
    const fill = scopedToolName(application, "fill");
    const missed = entered
      .filter((value) => screens.unmatched(application, value))
      .map((value) => ({
        code: "PLAN-NOMINAL",
        message: `scenario ${scenario.id} is nominal, and the screens of ${application} found nothing with "${value}": a nominal scenario finds what it searches. Replace "${value}" in data, and in the step that types it, by a part of it, such as a first or a last name, that you searched with ${fill} and found, and expect what it found; or make the scenario negative.`,
        remedy: `Replace "${value}" in data of scenario ${scenario.id}, and in the step that types it, by a part of it that ${fill} found, such as a first or a last name; or make scenario ${scenario.id} negative.`,
      }));
    const expected = scenario.steps.flatMap((step, at) => {
      const shownBefore = scenario.steps.slice(0, at).flatMap((earlier) => earlier.expects.flatMap((expect) => expect.shows));
      return step.expects.flatMap((expect, k) =>
        expect.absent
          .filter((text) => screens.showsBesideFields(application, text))
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
    const typed = this.rules.screens.codes(scenario.application).find((code) => code.includes(".fill("));
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
    if (!screens.watches(application)) return [];
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
          const held = screens.onlyInFields(application, text);
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
      return done?.application === scenario.application ? [done] : [];
    });
  }

  /**
   * The plan as it is kept: each step with the lines of code of the actions it cites, in place of their
   * numbers, and each expect with the element the screens showed each of its texts in, for those they showed
   * in one.
   */
  private inscribed(plan: SubmittedPlan): TestPlan {
    const { screens } = this.rules;
    const scenarios = plan.scenarios.map((scenario) => {
      const element = (text: string, gone: boolean): ExpectedElement[] => {
        const shown = screens.locatorOf(scenario.application, text, gone);
        return shown === undefined ? [] : [{ text, ...shown }];
      };
      const steps = scenario.steps.map(({ action, actions, expects }) => ({
        action,
        code: this.cited(scenario, actions).map((done) => done.code),
        expects: expects.map((expect) => ({
          ...expect,
          elements: [...expect.shows.flatMap((text) => element(text, false)), ...expect.absent.flatMap((text) => element(text, true))],
        })),
      }));
      return { ...scenario, steps };
    });
    return { scenarios };
  }

  /**
   * What the gates refuse in the actions the steps of a scenario of an application with a user interface
   * cite: a step that cites none, an action no browser tool returned or one done on another application,
   * which the harness could write no code from; a first action that opens no address, the test starting on an
   * empty page; and an action that typed a value that is none of the data of the scenario, whose line its
   * test could not keep.
   */
  private actionErrors(scenario: SubmittedScenario): Refusal[] {
    const { screens } = this.rules;
    const { application } = scenario;
    if (!screens.watches(application)) return [];
    const tool = (action: string) => scopedToolName(application, action);
    const done = screens.actions(application);
    const listed = done.slice(-MAX_LISTED_ACTIONS).map((action) => `${action.number}: ${action.code}`);
    const remedy =
      listed.length === 0
        ? `No action was done on ${application} yet. Open the first address of the scenario with ${tool("goto")}, do its steps, then give in actions of each step the numbers the results return in "action".`
        : [`Give in actions of each step the numbers of the actions that did it. The last actions on ${application}, each after its number:`, ...listed].join(
            "\n",
          );
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
        if (cited.application !== application)
          return [
            {
              code: "PLAN-LOCATOR",
              message: `${where} cites the action ${number}, done on ${cited.application}: a test of ${application} acts on ${application} alone. Do the step with the browser tools of ${application}, such as ${tool("click")}, and cite the numbers their results return in "action".`,
              remedy,
            },
          ];
        if (cited.typed === undefined || inData(cited.typed)) return [];
        const typed = JSON.stringify(cited.typed);
        return [
          {
            code: "PLAN-INPUT",
            message: `${where} cites the action ${number}, which typed ${typed}, and ${typed} is no value of the data of the scenario: its test may type only values of its data. Put it in data, with from "${application}" for a value a screen of ${application} showed before you typed it, or from "${MADE_UP}" for one the test invents, such as { "value": ${typed}, "from": "${MADE_UP}" }; or do the step again with a value of the data, and cite that action.`,
          },
        ];
      });
    });
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
    if (empty.length > 0 || !this.rules.screens.watches(scenario.application)) return empty;
    const shows = expects.flatMap(({ expect }) => expect.shows);
    const absent = expects.flatMap(({ expect }) => expect.absent);
    if (this.rules.screens.changedByAction(scenario.application, shows, absent)) return [];
    const tool = (action: string) => scopedToolName(scenario.application, action);
    return [
      {
        code: "PLAN-RESULT",
        message: `no text scenario ${scenario.id} expects appeared, or went, after an action of yours on ${scenario.application}. Do its steps with ${tool("fill")} and ${tool("click")}, read what the result says appeared and went, and expect that.`,
      },
    ];
  }
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
