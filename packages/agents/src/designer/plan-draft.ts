import type { PlanEnd, SetAsideScenario } from "@open-qa-stack/domain";
import type { Journal } from "../common/journal.ts";
import type { DuplicateJudge, JudgedDuplicate } from "./duplicate-judge.ts";
import { coveredBy, type Verified } from "./verified.ts";

/** Scenarios set aside in a row after which the harness tells the agent it may say the brief is covered. */
export const HINTED_DUPLICATES_IN_A_ROW = 2;
/** Scenarios set aside in a row after which the harness asks for no more: the agent has nothing new to verify. */
export const MAX_DUPLICATES_IN_A_ROW = 3;
/** The code of the check that sets aside a scenario another covers, by what their tests would do. */
export const PLAN_DUPLICATE = "PLAN-DUPLICATE";

/** What a draft needs of the scenarios it holds. */
export interface DraftRules<S> {
  /** What a scenario does and verifies, for the comparison by the code. */
  readonly verified: (scenario: S) => Verified;
  /** What a scenario does and verifies, as the judge reads it. */
  readonly described: (scenario: S) => string;
  /** The model that judges what the code could not tell; the comparison by the code alone without it. */
  readonly judge?: DuplicateJudge;
  /** The clock of the dates. */
  readonly now: () => Date;
}

/**
 * The scenarios of a plan while the harness still asks the agent for more.
 *
 * @remarks
 * The agent submits scenarios in several calls: those of a call are added to the draft, and one that bears
 * the slug of a scenario of the draft replaces it. Each scenario added passes two guards against
 * duplicates, in order. The harness first compares what its test would do with each scenario kept, by
 * `coveredBy`. The judge, when there is one, is then asked about those the code let through; the harness
 * keeps of its answer only what names a scenario submitted and one kept before it, and goes on without it
 * when it fails. A duplicate is set aside with who decided, why and when: it is never lost.
 *
 * The harness stops asking once the agent submits nothing more: it says the brief is covered, or, with no
 * scenario kept at all, that no test can do what the brief asks. Duplicates in
 * a row are answered by degrees: the first is told to the agent; from `HINTED_DUPLICATES_IN_A_ROW`, the
 * agent is told it may say the brief is covered; at `MAX_DUPLICATES_IN_A_ROW`, the harness asks for no
 * more. A plan that is full is closed as well, which guards a design against scenarios without end.
 */
export class PlanDraft<S extends { readonly id: string; readonly title: string; readonly intent: string }> {
  private readonly rules: DraftRules<S>;
  private readonly journal: Journal;
  private kept: readonly S[] = [];
  private readonly aside: SetAsideScenario[] = [];
  private streak = 0;

  /**
   * @param rules - What the draft needs of its scenarios.
   * @param journal - Where each scenario set aside is written.
   */
  public constructor(rules: DraftRules<S>, journal: Journal) {
    this.rules = rules;
    this.journal = journal;
  }

  /**
   * The scenarios kept so far.
   *
   * @returns Them, in the order of the plan.
   */
  public get scenarios(): readonly S[] {
    return this.kept;
  }

  /**
   * The scenarios set aside so far.
   *
   * @returns Them, in the order they were submitted.
   */
  public get setAside(): readonly SetAsideScenario[] {
    return this.aside;
  }

  /**
   * The draft as it would be with the scenarios of a call, before any is compared.
   *
   * @param submitted - The scenarios of the call.
   * @returns The scenarios kept, those of the call in place of the ones whose slug they bear, then the others.
   */
  public with(submitted: readonly S[]): S[] {
    const given = new Map(submitted.map((scenario) => [scenario.id, scenario]));
    const held = new Set(this.kept.map((scenario) => scenario.id));
    return [...this.kept.map((scenario) => given.get(scenario.id) ?? scenario), ...submitted.filter((scenario) => !held.has(scenario.id))];
  }

  /**
   * Adds the scenarios of a call to the draft, but those another scenario covers.
   *
   * @param submitted - The scenarios of the call, which the gates of the plan accept.
   * @returns The scenarios of the call set aside as duplicates.
   */
  public async keep(submitted: readonly S[]): Promise<readonly SetAsideScenario[]> {
    const fresh = new Set(submitted.map((scenario) => scenario.id));
    const settled = this.kept.filter((scenario) => !fresh.has(scenario.id));
    const duplicates = new Map<string, Omit<SetAsideScenario, "id" | "title" | "intent" | "at">>();
    const passed: S[] = [];
    for (const scenario of submitted) {
      const verified = this.rules.verified(scenario);
      const other = [...settled, ...passed].find((candidate) => coveredBy(verified, this.rules.verified(candidate)));
      if (other === undefined) passed.push(scenario);
      else
        duplicates.set(scenario.id, {
          duplicates: other.id,
          origin: { by: "harness", check: PLAN_DUPLICATE },
          reason: `It does the same steps with the same values as ${other.id}, and expects nothing ${other.id} does not.`,
        });
    }
    for (const { id, of, reason } of await this.judged(settled, passed))
      duplicates.set(id, { duplicates: duplicates.get(of)?.duplicates ?? of, origin: { by: "agent", role: "plan-reviewer" }, reason });
    const at = this.rules.now().toISOString();
    const found = submitted.flatMap(({ id, title, intent }) => {
      const duplicate = duplicates.get(id);
      this.streak = duplicate === undefined ? 0 : this.streak + 1;
      return duplicate === undefined ? [] : [{ id, title, intent, ...duplicate, at }];
    });
    for (const { id, duplicates: of, origin, reason } of found)
      this.journal.record(
        "info",
        `The scenario ${id} was set aside as a duplicate of ${of}, by ${origin.by === "harness" ? `the harness (${origin.check})` : "the plan reviewer"}: ${reason}`,
      );
    this.aside.push(...found);
    this.kept = this.with(submitted).filter((scenario) => !duplicates.has(scenario.id));
    return found;
  }

  /**
   * Whether the last scenarios submitted were duplicates often enough for the agent to be told it may say the brief is covered.
   *
   * @returns `true` from `HINTED_DUPLICATES_IN_A_ROW` duplicates in a row.
   */
  public get repeating(): boolean {
    return this.streak >= HINTED_DUPLICATES_IN_A_ROW;
  }

  /**
   * Why the harness asks for no more scenarios, if it does not.
   *
   * @param submitted - How many scenarios the last call submitted.
   * @returns The reason; `undefined` while the agent may be asked for more.
   */
  public ended(submitted: number): PlanEnd | undefined {
    // An agent that submits nothing says it is done: with scenarios kept, the brief is covered; with none, no test can do what it asks.
    if (submitted === 0) return this.kept.length === 0 ? "none" : "covered";
    return this.streak >= MAX_DUPLICATES_IN_A_ROW ? "exhausted" : undefined;
  }

  /** What the judge finds among the scenarios the code let through, kept only when it names one of them and a scenario before it. */
  private async judged(settled: readonly S[], passed: readonly S[]): Promise<JudgedDuplicate[]> {
    const { judge, described } = this.rules;
    if (judge === undefined || passed.length === 0 || settled.length + passed.length < 2) return [];
    const item = (scenario: S) => ({ id: scenario.id, text: described(scenario) });
    const answered = await judge.judge(settled.map(item), passed.map(item)).catch((error: unknown) => {
      this.journal.record(
        "error",
        `The review of the plan for duplicates failed, and the plan goes on without it: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    });
    const order = [...settled, ...passed].map((scenario) => scenario.id);
    const candidates = new Set(passed.map((scenario) => scenario.id));
    const kept: JudgedDuplicate[] = [];
    for (const verdict of answered) {
      const before = order.indexOf(verdict.of) >= 0 && order.indexOf(verdict.of) < order.indexOf(verdict.id);
      if (candidates.has(verdict.id) && before && !kept.some((other) => other.id === verdict.id)) kept.push(verdict);
      else this.journal.record("info", `The harness left out an answer of the plan reviewer: ${verdict.id} as a duplicate of ${verdict.of}.`);
    }
    return kept;
  }
}
