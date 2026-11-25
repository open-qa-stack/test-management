import { resultChange, type ResultChange } from "@open-qa-stack/domain";
import type {
  Execution,
  ExecutionFailure,
  ExecutionList,
  QaStep,
  RepositoryTest,
  RepositoryTestAnomaly,
  ReportedStatus,
  TestExecution,
  TestReading,
  TestVersion,
} from "@open-qa-stack/domain";

/** What the runner reported of a test, in the words of the command. */
const REPORTED: Readonly<Record<ReportedStatus, string>> = { expected: "passed", unexpected: "failed", flaky: "passed on a retry", skipped: "skipped" };

/** The tags of a test that a person sorts the tests by, in the order they read them. */
const SORTED_BY = ["level", "domain", "feature", "case"] as const;

/**
 * @param test - A test of the test repository.
 * @returns The line that names it by its file and its titles, with its level, its domain, its functionality and its case when its tags give them.
 */
export function testLine(test: RepositoryTest): string {
  const sorted = SORTED_BY.flatMap((tag) => (test[tag] === undefined ? [] : [`${tag} ${test[tag]}`]));
  return `${test.path} › ${test.title}${sorted.length === 0 ? "" : `  [${sorted.join(", ")}]`}`;
}

/**
 * @param anomaly - What keeps a file of the test repository from being listed as it is.
 * @returns The line that says it, with what it does to the tests of the file.
 */
export function anomalyLine(anomaly: RepositoryTestAnomaly): string {
  return anomaly.kind === "duplicate"
    ? `${anomaly.path}: two tests share the title "${anomaly.title}", which the runner and the results take as one test.`
    : `${anomaly.path}: a syntax error keeps every test of the file from being read.`;
}

/** The lines of a step and of those it holds, indented by how deep it is. */
function stepLines(step: QaStep, depth: number): string[] {
  // The title of a step the harness writes starts with its number already.
  const mark = step.state === "passed" ? "✓" : "✗";
  return [`${"  ".repeat(depth)}${mark} ${step.title} · ${step.duration} ms`, ...step.steps.flatMap((held) => stepLines(held, depth + 1))];
}

/**
 * @param reading - A test of the test repository read in steps.
 * @returns The lines that tell it: the run that ran it last and what came of it, each step with its state and its
 * duration, what the failed assertion expected and received, and whether a trace is kept; or that no run kept ran it.
 */
export function readingLines(reading: TestReading): string[] {
  const { path, run, ranAt, view, traced } = reading;
  if (view === undefined) return [`${path}: no run the instance keeps ran it.`];
  return [
    `${path}, as the run ${run} of ${ranAt} ran it: ${REPORTED[view.status]}.`,
    ...view.steps.flatMap((step) => stepLines(step, 1)),
    ...(view.expected === undefined ? [] : [`Expected: ${view.expected}`]),
    ...(view.received === undefined ? [] : [`Received: ${view.received}`]),
    traced === true ? "A trace of it is kept." : "No trace of it is kept.",
  ];
}

/** How many tests of an execution passed, of how many it ran. */
function tally(execution: Execution): string {
  const passed = execution.results.filter(({ verdict }) => verdict === "passed").length;
  return `${passed} of ${execution.results.length} tests passed`;
}

/** What an execution changed for a test, in the words of the command. */
const CHANGES: Readonly<Record<ResultChange, string>> = { new_failure: "new failure", still_failing: "failed already", fixed: "fixed" };

/** What an execution changed for a test since its last run, after its line; nothing when nothing changed. */
function changeNote(result: Execution["results"][number]): string {
  const change = resultChange(result);
  return change === undefined ? "" : `, ${CHANGES[change]}`;
}

/** What an execution belongs to, in a few words. */
function owner(execution: Pick<Execution, "origin" | "sessionId" | "campaignId">): string {
  if (execution.sessionId !== undefined) return `${execution.origin}, session ${execution.sessionId}`;
  if (execution.campaignId !== undefined) return `${execution.origin}, campaign ${execution.campaignId}`;
  return execution.origin;
}

/**
 * @param execution - An execution of tests.
 * @returns The line that names it, where it comes from, when it ran and how many of its tests passed.
 */
export function executionLine(execution: Execution): string {
  return `${execution.id}  ${owner(execution)}  ${execution.ranAt}  ${tally(execution)}`;
}

/**
 * @param page - A page of the executions of tests.
 * @returns A line per execution, then where the page stands among them all, with how to ask for the next one.
 */
export function executionPageLines(page: ExecutionList): string[] {
  if (page.items.length === 0) return ["No execution of tests to list."];
  const shown = `Executions ${page.start + 1} to ${page.start + page.items.length} of ${page.total}`;
  return [...page.items.map(executionLine), page.next === undefined ? `${shown}.` : `${shown}; the next ones with --before ${page.next}.`];
}

/**
 * @param execution - An execution of tests.
 * @returns Its line, then a line per test it ran with its verdict and what changed since its last run, and where and why a test failed.
 */
export function executionLines(execution: Execution): string[] {
  return [
    `${executionLine(execution)}${execution.commit === undefined ? "" : `, at the commit ${execution.commit}`}.`,
    ...execution.results.flatMap((result) => {
      const { verdict, path, title, version, failure } = result;
      const named = `${verdict.padEnd(7)} ${path} › ${title}${version === undefined ? "" : `, version ${version}`}`;
      return [`${named}${changeNote(result)}`, ...failureLines(failure)];
    }),
  ];
}

/** The line under a test that failed: at which step and why, when the report says it. */
function failureLines(failure: ExecutionFailure | undefined): string[] {
  const told = [failure?.step === undefined ? undefined : `at step ${failure.step.number}, ${failure.step.title}`, failure?.message].filter(
    (part) => part !== undefined,
  );
  return told.length === 0 ? [] : [`        ${told.join(": ")}`];
}

/**
 * @param execution - What came of a test in an execution.
 * @returns The line that names the execution, when it ran, and what came of the test in it, at which version.
 */
export function testExecutionLine({ id, ranAt, result, ...execution }: TestExecution): string {
  return `${id}  ${owner(execution)}  ${ranAt}  ${result.verdict}  ${result.title}${result.version === undefined ? "" : `, version ${result.version}`}`;
}

/**
 * @param version - A version of a test.
 * @returns The line that names it, since when it ran, how many executions ran it, and the commit it was first run at.
 */
export function versionLine(version: TestVersion): string {
  const committed = version.commit === undefined ? "never run committed" : `commit ${version.commit}`;
  return `version ${version.number}  ${version.title}  since ${version.since}  ${version.executions} executions  ${committed}`;
}
