import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import {
  lockedPlaywrightVersion,
  networkFailureAddresses,
  testVerdicts,
  type CommandOutcome,
  type CommandRunner,
  type ReportedTest,
  type ListedTest,
  type TestVerdict,
  type Verdict,
} from "@open-qa-stack/domain";
import type { ResolvedConfig } from "@open-qa-stack/shared";
import { LocalRunner } from "./local-runner.ts";
import { listedTests, reportedTests } from "./reporter-json.ts";
import { baseUrlVariable, ENVIRONMENT_VARIABLE } from "./test-repository-base.ts";

/** Folder of the runs, in the state folder of the test repository. */
export const RUNS_FOLDER = "runs";

/** Longest wait for an address to answer, in milliseconds, when none is given. */
const REACH_TIMEOUT_MS = 5000;

/** Longest install, list or run, in milliseconds. */
const STEP_TIMEOUT_MS = 30 * 60_000;

/** Prints, for each address in its arguments, whether an HTTP response came within the time limit, its first argument. */
const REACH_SCRIPT = `const [limit, ...urls] = process.argv.slice(1);
Promise.all(urls.map((url) => fetch(url, { redirect: "manual", signal: AbortSignal.timeout(Number(limit)) }).then(() => ({ url, answers: true }), (e) => ({ url, answers: false, error: String(e.cause?.code ?? e.cause?.errors?.[0]?.code ?? e.name) }))))
  .then((found) => console.log(JSON.stringify(found)));`;

/** What a run needs. */
export interface PinnedRunOptions {
  /** The resolved configuration. */
  readonly config: ResolvedConfig;
  /** Name of the environment the tests run against. */
  readonly environment: string;
  /** Absolute path of the test repository. */
  readonly repositoryRoot: string;
  /** The test files to run, relative to the test repository: those the designer wrote. */
  readonly tests: readonly string[];
  /** Runs the commands of the steps; a `LocalRunner` in the test repository by default. */
  readonly runner?: CommandRunner;
  /** The environment the test accounts are read from; that of the process by default. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** A preparation already made, such as that of the trials, reused rather than installing again. */
  readonly preparation?: Promise<Preparation>;
  /** Longest wait for an address to answer, in milliseconds. */
  readonly reachTimeoutMs?: number;
  /** The clock of the dates; the system clock by default. */
  readonly now?: () => Date;
}

/** Whether an address answered from where the tests run. */
export interface CheckedAddress {
  readonly url: string;
  readonly answers: boolean;
  readonly error?: string;
}

/** What a run wrote to the test repository. */
export interface RunResult {
  readonly formatVersion: 1;
  readonly producedAt: string;
  readonly environment: string;
  /** Version of `@playwright/test` the lockfile installs, when it could be read. */
  readonly playwright?: string;
  /** The addresses checked before the run, then those checked again after it. */
  readonly addresses: readonly CheckedAddress[];
  /** Exit code of the runner, when the tests ran: recorded, never read as a verdict. */
  readonly runnerExitCode?: number;
  /** The JSON of the reporter, relative to the test repository, when the tests ran and it could be read. */
  readonly report?: string;
  /** The output of the runner, relative to the test repository, kept when its JSON is missing, empty or unreadable. */
  readonly runnerOutput?: string;
  readonly tests: readonly TestVerdict[];
}

/** A run made ready: the version installed, or why the tests cannot run. */
export type Preparation = { readonly ok: true; readonly version: string } | { readonly ok: false; readonly reason: string; readonly version?: string };

/** What running files gave: the verdicts, the addresses checked, and what the runner left. */
export interface FilesRun extends Pick<RunResult, "addresses" | "runnerExitCode" | "report" | "runnerOutput" | "tests"> {
  /** The tests of the reporter's JSON, when it could be read. */
  readonly reported?: readonly ReportedTest[];
}

/** What a run produced. */
export interface RunOutcome {
  /** Where the result was written. */
  readonly resultPath: string;
  readonly result: RunResult;
}

/**
 * Runs the generated tests with the real runner, at the version of `@playwright/test` the lockfile of the
 * test repository installs, and pronounces a verdict per test from the reporter's JSON.
 *
 * @remarks
 * The steps run on the machine, in the test repository, with no container: the dependencies are installed
 * from the lockfile, then the browsers of that version; the version installed is compared to the locked
 * one, the runner lists the tests, every declared address of the environment is called, and the tests run
 * with the JSON reporter. A step that fails stops the run: no test is `passed`. The result is written to `<stateDir>/runs/run-<date>.json`;
 * nothing is committed.
 */
export class PinnedRun {
  private readonly options: PinnedRunOptions;
  private readonly runner: CommandRunner;
  private prepared: Promise<Preparation> | undefined;
  private readonly env: Readonly<Record<string, string | undefined>>;

  /** @param options - What the run needs. */
  public constructor(options: PinnedRunOptions) {
    this.options = options;
    this.runner = options.runner ?? new LocalRunner(options.repositoryRoot);
    this.env = options.env ?? process.env;
  }

  /**
   * Runs the tests.
   *
   * @returns The result and where it was written.
   * @throws Error when a command cannot be called, or the result cannot be written.
   */
  public async run(): Promise<RunOutcome> {
    const { config, repositoryRoot } = this.options;
    const now = this.options.now ?? (() => new Date());
    const stamp = now().toISOString();
    const runDir = posix.join(config.repository.stateDir, RUNS_FOLDER, `run-${stamp.replace(/[:.]/g, "-")}`);
    const result = await this.steps(runDir, stamp);
    const resultPath = join(repositoryRoot, `${runDir}.json`);
    await mkdir(join(repositoryRoot, config.repository.stateDir, RUNS_FOLDER), { recursive: true });
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    return { resultPath, result };
  }

  /**
   * Makes the run ready, once: installs the dependencies from the lockfile, then the browsers of the
   * locked version, and checks the version installed; or takes the preparation it was given.
   *
   * @returns The version installed, or why the tests cannot run.
   * @throws Error when a command cannot be called.
   */
  public prepare(): Promise<Preparation> {
    this.prepared ??= this.options.preparation ?? this.install();
    return this.prepared;
  }

  /**
   * Lists the given files, checks the addresses, runs the files and pronounces the verdicts. The run must be
   * prepared.
   *
   * @param files - The test files, relative to the test repository.
   * @param runDir - The folder of this run, relative to the test repository.
   * @param options - Arguments given to the runner when the files run, such as `--update-snapshots=missing`.
   * @returns The verdicts, the addresses checked, and what the runner left.
   * @throws Error when a command cannot be called.
   */
  public async runFiles(files: readonly string[], runDir: string, options: readonly string[] = []): Promise<FilesRun> {
    const notRun = (reason: string): FilesRun => ({ addresses: [], tests: files.map((id) => ({ id, verdict: "not_run", reason })) });
    const list = await this.step(["node_modules/.bin/playwright", "test", "--list", "--reporter=json", ...files]);
    const listed = list.exitCode === 0 ? listedTests(list.stdout) : undefined;
    if (listed === undefined) return notRun(`The runner could not list the tests: ${firstLine(list)}`);
    const checked = await this.reach(this.addresses());
    if (!checked.ran) return notRun(`The addresses could not be checked: ${checked.reason}`);
    const before = checked.addresses;
    const silent = before.filter((address) => !address.answers);
    if (silent.length > 0) return { addresses: before, tests: blocked(listed, silent) };
    const report = posix.join(runDir, "report.json");
    await mkdir(join(this.options.repositoryRoot, runDir), { recursive: true });
    const output = posix.join(runDir, "test-results");
    const ran = await this.step(["node_modules/.bin/playwright", "test", "--reporter=json", `--output=${output}`, ...options, ...files], { PLAYWRIGHT_JSON_OUTPUT_FILE: report });
    const reported = reportedTests(await readFile(join(this.options.repositoryRoot, report), "utf8").catch(() => ""));
    if (reported === undefined) {
      const runnerOutput = posix.join(runDir, "runner-output.txt");
      await writeFile(join(this.options.repositoryRoot, runnerOutput), `${ran.stdout}\n${ran.stderr}`);
      return { addresses: before, runnerExitCode: ran.exitCode, runnerOutput, tests: testVerdicts({ listed, addresses: this.addresses(), unreachable: new Set() }) };
    }
    // A check after the run that could not run confirms nothing: no address is then found unreachable.
    const recheck = await this.reach(networkFailureAddresses(reported, this.addresses()));
    const after = recheck.ran ? recheck.addresses : [];
    const unreachable = new Set(after.filter((address) => !address.answers).map((address) => address.url));
    return { addresses: [...before, ...after], runnerExitCode: ran.exitCode, report, reported, tests: testVerdicts({ listed, reported, addresses: this.addresses(), unreachable }) };
  }

  private async steps(runDir: string, producedAt: string): Promise<RunResult> {
    const { environment, tests } = this.options;
    const base = { formatVersion: 1 as const, producedAt, environment };
    const prepared = await this.prepare();
    const version = prepared.version === undefined ? {} : { playwright: prepared.version };
    if (!prepared.ok) return { ...base, ...version, addresses: [], tests: tests.map((id) => ({ id, verdict: "not_run" as Verdict, reason: prepared.reason })) };
    const { reported: _reported, ...ran } = await this.runFiles(tests, runDir);
    return { ...base, ...version, ...ran };
  }

  private async install(): Promise<Preparation> {
    const lockfile = await readFile(join(this.options.repositoryRoot, "package-lock.json"), "utf8").catch(() => undefined);
    const version = lockfile === undefined ? undefined : lockedPlaywrightVersion(lockfile);
    if (version === undefined) return { ok: false, reason: "package-lock.json is missing, cannot be read, or does not install @playwright/test." };
    const install = await this.step(["npm", "ci", "--no-audit", "--no-fund", "--no-update-notifier"]);
    if (install.exitCode !== 0) return { ok: false, version, reason: `The dependencies could not be installed: ${firstLine(install)}` };
    const browsers = await this.step(["node_modules/.bin/playwright", "install", "chromium"]);
    if (browsers.exitCode !== 0) return { ok: false, version, reason: `The browsers of Playwright ${version} could not be installed: ${firstLine(browsers)}` };
    const resolved = await this.step(["node", "-p", "require('@playwright/test/package.json').version"]);
    if (resolved.stdout.trim() !== version) return { ok: false, version, reason: `@playwright/test ${resolved.stdout.trim() || "cannot be found"} is installed, the lockfile asks for ${version}.` };
    return { ok: true, version };
  }

  /** Runs a command of a step, with the environment of the tests. */
  private step(command: readonly string[], env: Readonly<Record<string, string>> = {}): Promise<CommandOutcome> {
    return this.runner.run({ command, env: { ...this.projectEnv(), ...env }, timeoutMs: STEP_TIMEOUT_MS });
  }

  /** The addresses of the applications of the environment, as declared: their interface and their APIs. */
  private addresses(): string[] {
    const urls = this.options.config.applications.flatMap((application) => {
      const env = this.environmentOf(application);
      return [env?.uiUrl, ...(env?.apis ?? []).map((api) => api.baseUrl)];
    });
    return [...new Set(urls.filter((url): url is string => url !== undefined))];
  }

  /** Calls each address from where the tests run; when the check itself cannot run, it found nothing. */
  private async reach(urls: readonly string[]): Promise<{ ran: true; addresses: CheckedAddress[] } | { ran: false; reason: string }> {
    if (urls.length === 0) return { ran: true, addresses: [] };
    const timeout = this.options.reachTimeoutMs ?? REACH_TIMEOUT_MS;
    const outcome = await this.runner.run({ command: ["node", "-e", REACH_SCRIPT, String(timeout), ...urls], timeoutMs: STEP_TIMEOUT_MS });
    try {
      return { ran: true, addresses: JSON.parse(outcome.stdout) as CheckedAddress[] };
    } catch {
      return { ran: false, reason: firstLine(outcome) };
    }
  }

  /**
   * The environment of the tests: the environment name, the base address of each application, its interface
   * or else its first API, and the variables of the test accounts, which a test reads to sign in.
   */
  private projectEnv(): Record<string, string> {
    const { config } = this.options;
    const urls = config.applications.flatMap((application) => {
      const env = this.environmentOf(application);
      const base = env?.uiUrl ?? env?.apis?.[0]?.baseUrl;
      return base === undefined ? [] : [[baseUrlVariable(application.id), base] as const];
    });
    const accounts = config.applications.flatMap((application) => (application.authentication.accounts ?? []).flatMap((account) => [account.usernameEnv, account.passwordEnv]));
    const credentials = accounts.flatMap((name) => (this.env[name] === undefined ? [] : [[name, this.env[name]] as const]));
    return { [ENVIRONMENT_VARIABLE]: this.options.environment, ...Object.fromEntries(urls), ...Object.fromEntries(credentials) };
  }

  /** The environment of an application the tests run against, if it declares it. */
  private environmentOf(application: ResolvedConfig["applications"][number]) {
    return application.environments.find((candidate) => candidate.name === this.options.environment);
  }
}

/** Every listed test blocked, with the addresses that do not answer. */
function blocked(listed: readonly ListedTest[], silent: readonly CheckedAddress[]): TestVerdict[] {
  const reason = `${silent.map((address) => address.url).join(", ")} ${silent.length === 1 ? "does" : "do"} not answer: no test was run.`;
  return listed.map(({ id }) => ({ id, verdict: "blocked", reason }));
}

/** The first line a command printed on its error output, or on its standard output. */
function firstLine(outcome: CommandOutcome): string {
  const line = [outcome.stderr, outcome.stdout].flatMap((text) => text.split("\n")).map((text) => text.trim()).find((text) => text !== "");
  return line ?? `exit code ${outcome.exitCode}.`;
}
