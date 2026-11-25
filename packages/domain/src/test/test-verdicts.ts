import type { ListedTest, ReportedTest } from "./reported-test.ts";
import type { Verdict } from "./verdict.ts";

/** The verdict of a test, and why. */
export interface TestVerdict {
  readonly id: string;
  readonly verdict: Verdict;
  readonly reason: string;
}

/** What the verdicts of a run are pronounced from. */
export interface RunFacts {
  /** The tests the runner listed before the run. */
  readonly listed: readonly ListedTest[];
  /** The tests of the reporter's JSON; none when it is missing, empty or unreadable. */
  readonly reported?: readonly ReportedTest[];
  /** The addresses of the applications the configuration declares, such as `http://localhost:3010/api`. */
  readonly addresses: readonly string[];
  /** The addresses a check made after the run found unreachable. */
  readonly unreachable: ReadonlySet<string>;
}

/** The colours a runner may write in its messages. */
const COLOURS = /\u001b\[[0-9;]*m/g;

/** What a network error looks like in the message of a failed attempt. */
const NETWORK_ERROR = /net::ERR_(?!HTTP_RESPONSE_CODE_FAILURE|ABORTED\b)[A-Z_]+|ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT/;

/**
 * Pronounces the verdict of each listed test from the reporter's JSON.
 *
 * @remarks
 * In doubt, `indeterminate`, never `passed`. A test is `passed` only when the runner expected it to pass, it
 * has an attempt and every attempt passed; `failed` when it did not pass as expected; `blocked` when it
 * failed on a network error towards a declared address that a check after the run found unreachable, and
 * `indeterminate` when that check did not confirm it; `skipped` when skipped for a reason the test gives, and `indeterminate` when it gives none; `indeterminate` when flaky,
 * interrupted, marked as expected to fail, or when the JSON could not be read; `not_run` when listed but
 * absent from the JSON. The exit code of the runner plays no part.
 *
 * @param facts - The listed tests, the reported ones, and the addresses.
 * @returns A verdict for each listed test, in the order of the list.
 */
export function testVerdicts(facts: RunFacts): TestVerdict[] {
  const { reported } = facts;
  if (reported === undefined)
    return facts.listed.map(({ id }) => ({ id, verdict: "indeterminate", reason: "The JSON of the reporter is missing, empty or unreadable." }));
  const byId = new Map(reported.map((test) => [test.id, test]));
  return facts.listed.map(({ id }) => {
    const test = byId.get(id);
    return test === undefined ? { id, verdict: "not_run", reason: "Listed, but absent from the JSON of the reporter." } : { id, ...verdictOf(test, facts) };
  });
}

/**
 * The declared addresses that the failed tests of a report could not reach, to be checked again after the run.
 *
 * @param reported - The tests of the reporter's JSON.
 * @param addresses - The declared addresses.
 * @returns Each address once.
 */
export function networkFailureAddresses(reported: readonly ReportedTest[], addresses: readonly string[]): string[] {
  return [
    ...new Set(
      reported.flatMap((test) => (test.status === "unexpected" ? [networkFailureOf(test, addresses)] : [])).filter((address) => address !== undefined),
    ),
  ];
}

function verdictOf(test: ReportedTest, facts: RunFacts): Omit<TestVerdict, "id"> {
  if (test.status === "skipped")
    return test.skippedFor === undefined
      ? { verdict: "indeterminate", reason: "Skipped, and nothing in the report says why." }
      : { verdict: "skipped", reason: `Skipped: ${test.skippedFor}` };
  if (test.status === "flaky") return { verdict: "indeterminate", reason: "Flaky: it failed, then passed on a retry." };
  if (test.attempts.some((attempt) => attempt.status === "interrupted")) return { verdict: "indeterminate", reason: "An attempt was interrupted." };
  if (test.expectedStatus !== "passed") return { verdict: "indeterminate", reason: `Marked as expected to end ${test.expectedStatus}.` };
  if (test.status === "expected") {
    return test.attempts.length > 0 && test.attempts.every((attempt) => attempt.status === "passed")
      ? { verdict: "passed", reason: "Every attempt passed." }
      : { verdict: "indeterminate", reason: "Reported as expected, without an attempt that passed." };
  }
  const address = networkFailureOf(test, facts.addresses);
  if (address === undefined) return { verdict: "failed", reason: firstError(test) };
  return facts.unreachable.has(address)
    ? { verdict: "blocked", reason: `${address} does not answer: the test could not run.` }
    : { verdict: "indeterminate", reason: `A network error towards ${address}, which answered again after the run.` };
}

/** The declared address a failed test could not reach, when its errors say so. */
function networkFailureOf(test: ReportedTest, addresses: readonly string[]): string | undefined {
  const messages = errorsOf(test).filter((message) => NETWORK_ERROR.test(message));
  return addresses.find((address) => messages.some((message) => names(message, originOf(address))));
}

function firstError(test: ReportedTest): string {
  const error = errorsOf(test)[0];
  return error === undefined ? "Failed, without an error message." : `Failed: ${error.split("\n")[0]}`;
}

/** The messages of the errors of a test, without their colours. */
function errorsOf(test: ReportedTest): string[] {
  return test.attempts.flatMap((attempt) => attempt.errors).map((message) => message.replace(COLOURS, ""));
}

/** The scheme, host and port of an address: what an error message towards it names. */
function originOf(address: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(address)?.[0] ?? address;
}

/** Whether a message names an origin, ending where it ends: `localhost:3010` does not name `localhost:30100`. */
function names(message: string, origin: string): boolean {
  for (let at = message.indexOf(origin); at >= 0; at = message.indexOf(origin, at + 1)) {
    if (!/[\w:.-]/.test(message.charAt(at + origin.length))) return true;
  }
  return false;
}
