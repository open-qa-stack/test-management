import type { PlannedScenario, ToolDefinition } from "@open-qa-stack/domain";
import type { Journal } from "../common/journal.ts";
import { TESTS_LIST_TOOL } from "./existing-tests.ts";
import { PLAN_TOOL } from "./plan-proposal.ts";
import { refusalText } from "./refusal.ts";

/** Name of the tool the agent that plans asks for the repair of tests the repository has with. */
export const REPAIR_TOOL = "repair_tests";

/** Most tests one design repairs. */
const MAX_REPAIRS = 10;

/** A test to repair: the file it is, and the scenario of the plan that wrote it, which its repair keeps to. */
export interface TestRepair {
  /** Its path, relative to the root of the test repository. */
  readonly path: string;
  /** The scenario its test does, as the plan of the design that wrote it gives it. */
  readonly scenario: PlannedScenario;
}

/**
 * The repair of tests the repository has, which the agent that plans asks for instead of a plan when the
 * brief asks to fix tests: each is written again, in its own file, from the scenario of the plan that wrote it.
 *
 * @remarks
 * Only a test a design wrote can be repaired: its plan gives the scenario the agent that writes keeps to. A
 * path that is no test of the repository, or a test no plan records, is refused, with what to do. A design
 * plans new tests or repairs existing ones, not both: the repair is refused once scenarios were submitted.
 * Once a repair is asked, the session that plans is over.
 */
export class TestRepairs {
  readonly #planned: ReadonlyMap<string, PlannedScenario>;
  readonly #present: readonly string[];
  readonly #planning: () => boolean;
  readonly #journal: Journal;
  #chosen: readonly TestRepair[] | undefined;

  /**
   * @param planned - The scenario of the plan of each test a design wrote, by its path, as `plannedTests` gives them.
   * @param present - The paths of the test files the repository has.
   * @param planning - Whether scenarios of a plan were submitted already.
   * @param journal - Where the repair asked is written.
   */
  public constructor(planned: ReadonlyMap<string, PlannedScenario>, present: readonly string[], planning: () => boolean, journal: Journal) {
    this.#planned = planned;
    this.#present = present;
    this.#planning = planning;
    this.#journal = journal;
  }

  /**
   * The tests to repair, once the agent asked for their repair.
   *
   * @returns Them, in the order asked; `undefined` while none is asked.
   */
  public get chosen(): readonly TestRepair[] | undefined {
    return this.#chosen;
  }

  /**
   * What the agent is told of every call once a repair is asked: the session that plans is over.
   *
   * @returns The message.
   */
  public closed(): string {
    return "The repair is accepted, and this session is over. Answer with one sentence; call no more tools.";
  }

  /**
   * The tool the agent asks for the repair with.
   *
   * @returns The tool.
   */
  public tool(): ToolDefinition {
    return {
      name: REPAIR_TOOL,
      description: `Asks for the repair of tests the repository has, instead of a plan: call it when the brief asks to fix tests, with the paths ${TESTS_LIST_TOOL} gives. The agent that writes runs each test, looks at the page where it fails, and fixes it in its own file, keeping to the scenario of the plan that wrote it. A test written by hand cannot be repaired: plan a scenario for what it verifies with ${PLAN_TOOL} instead.`,
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            minItems: 1,
            maxItems: MAX_REPAIRS,
            items: { type: "string", minLength: 1 },
            description: "The path of each test to repair, as the tests of the repository list it.",
          },
        },
        required: ["paths"],
        additionalProperties: false,
      },
      execute: async (args) => this.#ask([...new Set((args as { paths: string[] }).paths)]),
    };
  }

  #ask(paths: readonly string[]): { accepted: true; next: string } | { error: string } {
    if (this.#planning())
      return {
        error: refusalText([
          {
            code: "REPAIR-PLANNED",
            message: `scenarios of a plan were submitted already: a design plans new tests or repairs those that exist, not both. Go on with ${PLAN_TOOL}.`,
          },
        ]),
      };
    const refusals = paths.flatMap((path) => {
      if (!this.#present.includes(path))
        return [{ code: "REPAIR-UNKNOWN", message: `the repository has no test at ${path}. Call ${TESTS_LIST_TOOL} for the paths of its tests.` }];
      if (!this.#planned.has(path))
        return [
          {
            code: "REPAIR-UNPLANNED",
            message: `no plan records the scenario of ${path}, which was not written by a design. Leave it out, or plan a scenario for what it verifies with ${PLAN_TOOL} instead.`,
          },
        ];
      return [];
    });
    const ids = paths.flatMap((path) => this.#planned.get(path)?.id ?? []);
    const shared = paths.filter((path) => ids.filter((id) => id === this.#planned.get(path)?.id).length > 1);
    if (shared.length > 0)
      refusals.push({
        code: "REPAIR-SAME-SCENARIO",
        message: `${shared.join(", ")} were written for scenarios of the same name, in different plans: ask for the repair of one of them only.`,
      });
    if (refusals.length > 0) return { error: refusalText(refusals) };
    this.#chosen = paths.map((path) => ({ path, scenario: this.#planned.get(path)! }));
    this.#journal.record("info", `The tests to repair: ${paths.join(", ")}.`);
    return { accepted: true, next: this.closed() };
  }
}
