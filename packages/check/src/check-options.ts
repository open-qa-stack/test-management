/** Which packages the check tests. */
export type PackageChoice =
  /** Every package. */
  | { readonly kind: "all" }
  /** Those named, by name or folder, separated by commas, with their dependents. */
  | { readonly kind: "named"; readonly names: string }
  /** Those a change touches since a revision, with their dependents. */
  | { readonly kind: "affected"; readonly since: string };

/**
 * How the tests run: all of them on this machine; a part of the tests of the root, among parts that run on other
 * machines; the packages that have a test script of their own; or the merge of the reports the parts wrote.
 */
export type TestMode =
  { readonly kind: "all" } | { readonly kind: "part"; readonly index: number; readonly count: number } | { readonly kind: "own" } | { readonly kind: "merge" };

/** What the check is asked to do. */
export interface CheckOptions {
  readonly packages: PackageChoice;
  /** Whether it runs the steps before the tests: type check, lint, format, build, coverage directives, secrets. */
  readonly before: boolean;
  /** How it runs the tests; none to run no test. */
  readonly tests: TestMode | undefined;
}

/** What the check says when it cannot read its arguments. */
export const USAGE = [
  "check: run it with nothing to check every package, or give:",
  "  --affected <revision> or --packages <names or folders, separated by commas>, to test some packages and their dependents;",
  "  --only static, to run the steps before the tests alone, or --only tests, to run the tests alone;",
  "  --part <index>/<count>, --part own or --merge, to run part of the tests on this machine, as the continuous integration does.",
].join("\n");

/**
 * Reads the arguments of the check.
 *
 * @param args - The arguments, after the program.
 * @returns What it is asked to do; `undefined` for arguments it does not read.
 */
export function checkOptions(args: readonly string[]): CheckOptions | undefined {
  let packages: PackageChoice = { kind: "all" };
  let only: string | undefined;
  let tests: TestMode | undefined;
  const rest = [...args];
  while (rest.length > 0) {
    const option = rest.shift();
    if (option === "--merge") {
      tests = { kind: "merge" };
      continue;
    }
    const value = rest.shift();
    if (value === undefined) return undefined;
    if (option === "--affected") packages = { kind: "affected", since: value };
    else if (option === "--packages") packages = { kind: "named", names: value };
    else if (option === "--only" && (value === "static" || value === "tests")) only = value;
    else if (option === "--part" && partOf(value) !== undefined) tests = partOf(value);
    else return undefined;
  }
  // A part of the tests, or their merge, is a run of tests alone.
  if (tests !== undefined && only === "static") return undefined;
  return { packages, before: tests === undefined && only !== "tests", tests: only === "static" ? undefined : (tests ?? { kind: "all" }) };
}

/** Reads a part of the tests: `own`, or its index among a count, from 1. */
function partOf(value: string): TestMode | undefined {
  if (value === "own") return { kind: "own" };
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (match === null) return undefined;
  const [index, count] = [Number(match[1]), Number(match[2])];
  return index >= 1 && index <= count ? { kind: "part", index, count } : undefined;
}
