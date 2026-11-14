import type { PlannedExpect, PlannedScenario, PlanReview, TestPlan, ToolDefinition } from "@open-qa-stack/domain";
import { redactText, scopedToolName, secretForms } from "@open-qa-stack/tools";
import type { Journal } from "../common/journal.ts";
import { checkable, observed, sameText } from "./observed.ts";
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
/** The words of the action of a step that types a value in a field; the key Enter pressed types none. */
const TYPING = /\b(?:types?|(?<!\bpress(?:es)?\s+(?:the\s+)?)enters?|fill(?:s|\s+in)?|inputs?|search(?:es)?\s+for)\b/i;
/** The words that join another action to the one that types, such as the click that sends a form: the step does more than type. */
const JOINED = /\b(?:and|then)\b/i;

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
 * typed without a step before that expects it shown, and, for an application with a user interface, a step
 * that types in a scenario without data, and a text expected shown that the screens showed only in a value
 * the agent typed or in the name of a field; a value of the data from an application is one it showed
 * beside what the agent typed; the agent may then submit another. Before the gates, the harness takes out of
 * a functional scenario of an application with a user interface each text expected shown by a step that
 * only types, followed by another step, that is a value of its data no screen showed beside the fields: the
 * field echoes it whatever the application answers. The gates number the expects as the agent wrote them,
 * and pass over one left without a text, which the plan kept goes without. From
 * the third refusal of one reason, the agent is told only what the gate would accept, and the sixth plan the
 * gates refuse stops the design. A plan that keeps these rules goes to the review, one
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

  private async submit(submitted: TestPlan): Promise<string | { error: string }> {
    // Once a plan is refused, the designer refuses every call before it reaches a tool.
    if (this.plan !== undefined) return { error: "A plan was already accepted; carry it out." };
    const { plan: checked, emptied, echoes } = this.withoutEchoes(submitted);
    const refusals = this.errors(checked, emptied);
    if (refusals.length > 0) return this.refuse(refusals);
    const plan = withoutEmptied(checked, emptied);
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
  private withoutEchoes(plan: TestPlan): { plan: TestPlan; emptied: Set<PlannedExpect>; echoes: string[] } {
    const { screens } = this.rules;
    const emptied = new Set<PlannedExpect>();
    const echoes: string[] = [];
    const unechoed = (scenario: PlannedScenario): PlannedScenario => {
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
  private errors(plan: TestPlan, emptied: ReadonlySet<PlannedExpect>): Refusal[] {
    const ids = plan.scenarios.map((scenario) => scenario.id);
    const repeated = [...new Set(ids.filter((id, at) => ids.indexOf(id) !== at))].map((id) => ({
      code: "PLAN-ID",
      message: `the id ${id} is given to several scenarios. Give each scenario its own id.`,
    }));
    const text = plan.scenarios.flatMap(planText).join("\n");
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
    ];
  }

  /** What the gates refuse in what a scenario relies on: a source it cites and nothing was read of, a value its source never showed, a text no tool showed. */
  private readErrors(scenario: PlannedScenario): Refusal[] {
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
          .map((expected) => ({ number: `${at + 1}.${k + 1}`, ...expected })),
      ),
    );
    const unseen = texts.map(({ number, text, shown }) =>
      watched && shown && observed(text, madeUp)
        ? this.untypedRefusal(scenario, number, text)
        : {
            code: "PLAN-SHOWN",
            message: `scenario ${scenario.id}, expect ${number}, names "${text}", which ${watched ? `no screen of ${scenario.application} showed in this session. Do the step with the browser tools and copy the text as the screen gives it.` : "nothing you read in this session showed. Copy the text as a tool of a source gives it."}`,
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
   * made or found.
   */
  private nominalErrors(scenario: PlannedScenario): Refusal[] {
    const { screens } = this.rules;
    if (scenario.case !== "nominal" || !screens.watches(scenario.application)) return [];
    const typed = scenario.data.map((entry) => entry.value).filter((value) => checkable(value) && screens.typed(scenario.application, value));
    return scenario.steps.flatMap((step, at) => {
      const shownBefore = scenario.steps.slice(0, at).flatMap((earlier) => earlier.expects.flatMap((expect) => expect.shows));
      return step.expects.flatMap((expect, k) =>
        expect.absent
          .filter((text) => screens.showsBesideFields(scenario.application, text))
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
  }

  /**
   * The refusal of an expected text of a scenario of an application with a user interface that is a value it
   * invents no screen showed, not even in a field: the agent never typed it. What the gate would accept is
   * the value typed, as the last line of code that filled a field did, and the answer of the screen expected.
   */
  private untypedRefusal(scenario: PlannedScenario, number: string, text: string): Refusal {
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
  private inputErrors(scenario: PlannedScenario): Refusal[] {
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

  /** The refusal of a value its source never showed, with the last texts a knowledge source returned as what the gate would accept. */
  private dataRefusal(value: string, source: string, tool: string): Refusal {
    const message = `no result of ${source} showed "${value}" in this session. Read it first with ${tool}, or correct the value. A value the test invents has from "${MADE_UP}".`;
    const last = this.rules.reads.last(source, LAST_TEXTS).map((text) => `- ${text.length > MAX_TOLD_TEXT ? `${text.slice(0, MAX_TOLD_TEXT)}…` : text}`);
    return last.length === 0
      ? { code: "PLAN-DATA", message }
      : { code: "PLAN-DATA", message, remedy: [`Read "${value}" with ${tool}, or take a value ${source} showed you last:`, ...last].join("\n") };
  }

  /** What the gates refuse in the expects of a functional scenario, but those the harness emptied of echoes. */
  private expectErrors(scenario: PlannedScenario, emptied: ReadonlySet<PlannedExpect>): Refusal[] {
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
function withoutEmptied(plan: TestPlan, emptied: ReadonlySet<PlannedExpect>): TestPlan {
  const scenarios = plan.scenarios.map((scenario) => ({
    ...scenario,
    steps: scenario.steps.map((step) => ({ ...step, expects: step.expects.filter((expect) => !emptied.has(expect)) })),
  }));
  return { ...plan, scenarios };
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
