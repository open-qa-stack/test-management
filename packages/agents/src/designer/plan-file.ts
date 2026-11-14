import type { PlannedExpect, PlannedScenario, PlannedStep } from "@open-qa-stack/domain";
import { oneLine } from "./one-line.ts";

/** What the name of the file of a plan ends with, after the identifier of its design. */
export const PLAN_FILE_SUFFIX = ".plan.md";

/** How the part of the file the harness reads again starts: its heading, then the opening of its block. */
const RECORD_START = "\n## Record\n\n```json\n";
/** How the file ends: the closing of the block of its record. */
const RECORD_END = "\n```\n";

/** The accepted plan of a design, as its file records it. */
export interface PlanRecord {
  readonly formatVersion: 1;
  /** Identifier of the design, which names the file. */
  readonly design: string;
  /** Name of the environment the tests run against. */
  readonly environment: string;
  /** The brief the design started from, in the developer's words, when one was given. */
  readonly brief?: string;
  /** The scenarios of the plan, in its order. */
  readonly scenarios: readonly PlannedScenario[];
}

/**
 * Writes the file of an accepted plan: a page a person reads, then the record the harness reads again.
 *
 * @remarks
 * The page is Markdown: the design, then each scenario with its intent, its sources, its data and its steps,
 * each text on one line, an action and a result without the full stop they may end with. It is rendered from the record and never read. The record is the last part, a
 * `json` block under the heading `Record`.
 *
 * @param record - The plan.
 * @returns The text of the file.
 */
export function planFileText(record: PlanRecord): string {
  return [
    `# Test plan ${record.design}`,
    "",
    `- Environment: ${record.environment}`,
    ...(record.brief === undefined ? [] : [`- Brief: ${flat(record.brief)}`]),
    "",
    "The harness wrote this file from the plan it accepted, and reads its last part again. Edit neither part by hand: a file whose two parts differ is not read.",
    "",
    ...record.scenarios.flatMap(scenarioLines),
    `${RECORD_START.trim()}\n${JSON.stringify(record, null, 2)}${RECORD_END}`,
  ].join("\n");
}

/**
 * Reads the file of a plan.
 *
 * @param text - The text of the file.
 * @returns The plan it records; `undefined` when the record is missing, is no JSON, has another format
 * version, or when the file is not exactly what the harness writes for it, such as one edited by hand.
 */
export function readPlanFile(text: string): PlanRecord | undefined {
  const start = text.lastIndexOf(RECORD_START);
  if (start === -1 || !text.endsWith(RECORD_END)) return undefined;
  try {
    const record = JSON.parse(text.slice(start + RECORD_START.length, -RECORD_END.length)) as PlanRecord;
    return record.formatVersion === 1 && planFileText(record) === text ? record : undefined;
  } catch {
    return undefined;
  }
}

/** The lines of a scenario of the page: what it is, what it relies on, then its steps. */
function scenarioLines(scenario: PlannedScenario, at: number): string[] {
  const sources = scenario.sources.map(({ source, item }) => (item === undefined ? source : `${source}: ${flat(item)}`));
  const data = scenario.data.map((entry) => `${JSON.stringify(entry.value)} (${entry.from})`);
  return [
    `## ${at + 1}. ${scenario.id}`,
    "",
    `${oneLine(scenario.title)} (${scenario.kind}, ${scenario.case}). Application ${scenario.application}, domain ${scenario.domain}.`,
    "",
    `- Intent: ${flat(scenario.intent)}`,
    `- Sources: ${sources.join("; ")}`,
    `- Data: ${data.length === 0 ? "none" : data.join("; ")}`,
    "",
    ...scenario.steps.flatMap(stepLines),
  ];
}

/** The lines of a step of the page: its action, then each result it expects with its texts. */
function stepLines(step: PlannedStep, at: number): string[] {
  return [`### Step ${at + 1}. ${oneLine(step.action)}`, "", ...step.expects.flatMap((expect, k) => expectLines(expect, `${at + 1}.${k + 1}`))];
}

/** The lines of an expect of the page: its result, then each text the screen shows or no longer shows. */
function expectLines(expect: PlannedExpect, number: string): string[] {
  return [
    `Expect ${number}: ${oneLine(expect.result)}.`,
    ...expect.shows.map((text) => `- shows ${JSON.stringify(text)}`),
    ...expect.absent.map((text) => `- no longer shows ${JSON.stringify(text)}`),
    "",
  ];
}

/** A text with its spaces collapsed, on one line of the page. */
function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
