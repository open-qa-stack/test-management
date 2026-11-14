import type { PlannedScenario, ToolDefinition } from "@open-qa-stack/domain";
import type { Journal } from "../common/journal.ts";

/** Code of the journal entries that say a writer looked beyond its sheet. */
export const BEYOND_SHEET = "SHEET-BEYOND";

/**
 * Watches what the agent that writes a scenario looks at beyond its sheet, so that a plan that left it
 * something to find shows in the journal.
 *
 * @remarks
 * The sheet gives the writer the code of each step and the element of each text: a call of a browser tool or
 * of a tool of a source is a look beyond it, journaled with the scenario, the tool, and whether a run had
 * failed before. A call before any failed run is a gap of the plan; one after a failed run is the look a
 * repair needs. Doing again an action of the sheet is no such look: the tool then returns a line of code the
 * sheet gives.
 */
export class SheetWatch {
  private readonly scenario: PlannedScenario;
  private readonly failedRuns: () => number;
  private readonly journal: Journal;
  private readonly given: ReadonlySet<string>;
  private looks = 0;

  /**
   * @param scenario - The scenario the session writes.
   * @param failedRuns - How many runs of the scenario failed so far.
   * @param journal - Where the looks are written.
   */
  public constructor(scenario: PlannedScenario, failedRuns: () => number, journal: Journal) {
    this.scenario = scenario;
    this.failedRuns = failedRuns;
    this.journal = journal;
    this.given = new Set(scenario.steps.flatMap((step) => step.code));
  }

  /**
   * The tools of the session that look at the application or at a source, watched.
   *
   * @param tools - The browser tools and the tools of the sources.
   * @returns The same tools, each call of which is journaled when it looks beyond the sheet.
   */
  public watched(tools: readonly ToolDefinition[]): ToolDefinition[] {
    return tools.map((tool) => ({
      ...tool,
      execute: async (args) => {
        const result = await tool.execute(args);
        const code = (result as { code?: unknown } | null)?.code;
        if (typeof code !== "string" || !this.given.has(code)) this.look(tool.name);
        return result;
      },
    }));
  }

  /** Journals how many calls looked beyond the sheet, once the session is over. */
  public close(): void {
    this.journal.record("info", `Scenario ${this.scenario.id}: ${this.looks} calls beyond its sheet.`);
  }

  private look(tool: string): void {
    this.looks += 1;
    const failed = this.failedRuns();
    const when = failed === 0 ? "before any failed run" : `after failed run ${failed}`;
    this.journal.record("info", `[${BEYOND_SHEET}] Scenario ${this.scenario.id}, ${when}: ${tool}.`);
  }
}
