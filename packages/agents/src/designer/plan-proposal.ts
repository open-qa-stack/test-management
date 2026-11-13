import type { PlanReview, TestPlan, ToolDefinition } from "@open-qa-stack/domain";
import type { Journal } from "../common/journal.ts";
import { heldVariables, type DeclaredSecret } from "./spec-rules.ts";
import { MAX_TESTS, MIN_TESTS } from "./test-proposals.ts";

/** Name of the tool the designer submits its test plan with. */
export const PLAN_TOOL = "propose_plan";

/** What a plan is checked against. */
export interface PlanRules {
  /** Identifiers of the sources a scenario may cite: those of the index, and every knowledge source and application the agent has tools of. */
  readonly sources: readonly string[];
  /** The values no plan may hold: the plan is written to the design state. */
  readonly secrets: readonly DeclaredSecret[];
  /** Decides whether a plan that passes the rules may be carried out. */
  readonly review: PlanReview;
}

/**
 * The test plan of a design, submitted with `propose_plan` before any test is run or proposed.
 *
 * @remarks
 * A plan holds between `MIN_TESTS` and `MAX_TESTS` scenarios, each with a slug of its own, a title, its
 * intent, its kind, the result it expects and at least one source it relies on; the schema of the tool
 * checks all but the slugs and the values of the declared variables, which no plan may hold. A plan that
 * breaks these rules is refused, and the agent may submit another. One that keeps them goes to the review,
 * one plan at a time:
 * accepted, it is kept, and no other may be submitted; refused, the design stops, and no test may be run or
 * proposed.
 */
export class PlanProposal {
  private readonly rules: PlanRules;
  private readonly journal: Journal;
  private plan: TestPlan | undefined;
  private refusal: string | undefined;

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
   * Why the review refused the plan, if it did.
   *
   * @returns The reason, or `undefined` while no plan was refused.
   */
  public get refused(): string | undefined {
    return this.refusal;
  }

  /**
   * Why a test may not be run or proposed yet: no plan accepted, or a plan refused.
   *
   * @returns The message for the agent, or `undefined` once a plan is accepted.
   */
  public blocked(): string | undefined {
    if (this.refusal !== undefined) return `The plan was refused: ${this.refusal} The design is stopped; call no more tools.`;
    if (this.plan === undefined) return `No test plan is accepted yet. Submit the plan with ${PLAN_TOOL} first: each scenario with its title, its intent, its kind, the expected result and its sources.`;
    return undefined;
  }

  /**
   * The tool the agent submits its plan with.
   *
   * @returns The tool.
   */
  public tool(): ToolDefinition {
    return {
      name: PLAN_TOOL,
      description: `Submits the test plan, before any test is run or proposed: between ${MIN_TESTS} and ${MAX_TESTS} scenarios, which verify what the brief aims at; each test carries out one of them.`,
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
                id: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$", description: "A slug, unique in the plan, such as search-customer-by-name; the test written for it names it." },
                title: { type: "string", minLength: 1 },
                intent: { type: "string", minLength: 1, description: "What the scenario verifies, and why, in one sentence." },
                kind: { type: "string", enum: ["functional", "visual", "accessibility", "other"] },
                expected: { type: "string", minLength: 1, description: "What the test expects of the application." },
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
              },
              required: ["id", "title", "intent", "kind", "expected", "sources"],
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
    const errors = this.errors(plan);
    if (errors.length > 0) {
      for (const error of errors) this.journal.record("error", `The plan was refused by the harness: ${error}`);
      return { error: ["The plan was refused. Fix it, then submit it again.", ...errors.map((error) => `- ${error}`)].join("\n") };
    }
    const decision = await this.rules.review.review(plan);
    // Plans submitted in one turn are reviewed at once: another may have been decided meanwhile.
    if (this.refusal !== undefined) return { error: this.blocked()! };
    if (this.plan !== undefined) return { error: "A plan was already accepted; carry it out." };
    if (!decision.accepted) {
      this.refusal = decision.reason;
      this.journal.record("error", `The plan was refused: ${decision.reason} The design stops; no test is written.`);
      return { error: this.blocked()! };
    }
    this.plan = plan;
    this.journal.record("info", `The plan was accepted: ${plan.scenarios.map((scenario) => scenario.id).join(", ")}.`);
    return "The plan was accepted. For each scenario, do its steps with the browser tools and see what the screen shows after each action; then write the test, asserting what you saw, run it and fix it, and propose it with its scenario.";
  }

  /** What the rules refuse in a plan its schema accepts: the count, the kinds and the sources are the schema's. */
  private errors(plan: TestPlan): string[] {
    const ids = plan.scenarios.map((scenario) => scenario.id);
    const repeated = [...new Set(ids.filter((id, at) => ids.indexOf(id) !== at))].map((id) => `The id ${id} is given to several scenarios; give each its own.`);
    const text = plan.scenarios.flatMap((scenario) => [scenario.id, scenario.title, scenario.intent, scenario.expected, ...scenario.sources.map((source) => source.item ?? "")]).join("\n");
    return [...repeated, ...heldVariables(text, this.rules.secrets).map((variable) => `The plan holds the value of ${variable}; leave it out: the plan is written to the design state.`)];
  }
}
