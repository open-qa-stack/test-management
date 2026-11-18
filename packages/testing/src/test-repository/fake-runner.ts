import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A command a run has its host run, as far as the doubles read it. */
export interface RanCommand {
  /** The program and its arguments. */
  readonly command: readonly string[];
  /** Variables added to the environment of the command. */
  readonly env?: Readonly<Record<string, string>>;
}

/** How a doubled command ended. */
export interface RanOutcome {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The JSON of the reporter for test files, each one test, with the status the script gives. */
export function report(
  files: readonly string[],
  status: (file: string) => "expected" | "unexpected" | "skipped" = () => "expected",
  error = "Error: the total is wrong",
): string {
  const suites = files.map((file) => {
    const reported = status(file);
    const results =
      reported === "skipped"
        ? [{ status: "skipped", errors: [] }]
        : [{ status: reported === "expected" ? "passed" : "failed", errors: reported === "expected" ? [] : [{ message: error }] }];
    return {
      title: file,
      file,
      specs: [{ title: "the test", file, line: 3, tests: [{ projectName: "shop", status: reported, expectedStatus: "passed", results }] }],
    };
  });
  return JSON.stringify({ suites });
}

/** What the doubles of npm and Playwright answer, when it is not a success. */
export interface Script {
  /** The exit code of `npm --version`. */
  readonly npm?: number;
  /** The exit code of `npm ci`. */
  readonly install?: number;
  /** The error output of a failed `npm ci`. */
  readonly installError?: string;
  /** Whether `npm ci` cannot even be called. */
  readonly installCrash?: boolean;
  /** The status of a test file when the tests run at the end, after the design. */
  readonly final?: (file: string) => "expected" | "unexpected" | "skipped";
  /** The error of a test that fails at the end. */
  readonly finalError?: string;
  /** Whether the declared addresses stop answering once the design is over. */
  readonly downAfterDesign?: boolean;
}

/** Runs the commands of the machine and of the tests: npm and Playwright are answered as scripted, the check of the addresses runs locally. */
export class FakeRunner {
  public readonly commands: RanCommand[] = [];
  private readonly root: string;
  private readonly script: Script;

  public constructor(root: string, script: Script = {}) {
    this.root = root;
    this.script = script;
  }

  public async run(step: RanCommand): Promise<RanOutcome> {
    this.commands.push(step);
    const [program, ...args] = step.command;
    const ok = (stdout = ""): RanOutcome => ({ exitCode: 0, stdout, stderr: "" });
    if (program === "npm" && args[0] === "--version")
      return this.script.npm === undefined ? ok("11.0.0\n") : { exitCode: this.script.npm, stdout: "", stderr: "npm: not found" };
    if (program === "npm" && this.script.installCrash === true) throw new Error("spawn npm EACCES");
    if (program === "npm")
      return this.script.install === undefined
        ? ok()
        : { exitCode: this.script.install, stdout: "", stderr: this.script.installError ?? "npm error 404 Not Found\n" };
    if (program === "node" && args[0] === "-p") return ok("1.64.1\n");
    if (program === "node" && args[0] === "-e") {
      if (this.script.downAfterDesign === true && this.listedTogether)
        return ok(JSON.stringify(args.slice(3).map((url) => ({ url, answers: false, error: "ECONNREFUSED" }))));
      return new Promise((resolve) =>
        execFile(process.execPath, ["-e", args[1]!, ...args.slice(2)], { encoding: "utf8" }, (error, stdout, stderr) =>
          resolve({ exitCode: error === null ? 0 : 1, stdout, stderr }),
        ),
      );
    }
    if (args[0] === "install") return ok();
    const files = args.filter((arg) => arg.endsWith(".spec.ts"));
    if (args.includes("--list")) return ok(report(files));
    const trial = args.includes("--update-snapshots=missing");
    const out = step.env!["PLAYWRIGHT_JSON_OUTPUT_FILE"]!;
    mkdirSync(join(this.root, out, ".."), { recursive: true });
    writeFileSync(join(this.root, out), report(files, trial ? () => "expected" : (this.script.final ?? (() => "expected")), this.script.finalError));
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  /** Whether the tests designed already ran together, at the end. */
  public get finalRuns(): number {
    return this.commands.filter(isFinalRun).length;
  }

  /** Whether the tests designed were listed together, as they are once the design is over. */
  private get listedTogether(): boolean {
    return this.commands.some((command) => command.command.includes("--list") && command.command.filter((arg) => arg.endsWith(".spec.ts")).length > 1);
  }
}

/** A run of the tests at the end: no trial, more than one file. */
export const isFinalRun = (command: RanCommand) =>
  command.command[1] === "test" && !command.command.includes("--list") && !command.command.includes("--update-snapshots=missing");

/** The files of the tests a run tried while it designed them. */
export const tried = (runner: FakeRunner) =>
  runner.commands
    .filter((command) => command.command.includes("--update-snapshots=missing"))
    .flatMap((command) => command.command.filter((arg) => arg.endsWith(".spec.ts")));
