import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";
import type { CommandOutcome, CommandRunner, StepCommand } from "@open-qa-stack/domain";
import { answer, scriptedServer, toolCalls, type ScriptedServer } from "@open-qa-stack/testing";
import { liveRuntime, soloCommand, SoloRun, type RunEntry, type SoloRunState } from "../src/index.ts";

export const MODEL = "test-model";

export const WITNESS = "postgresql://shop:w1tness-pass@127.0.0.1:5999/shop";

export const workspace = mkdtempSync(join(tmpdir(), "oqas-cli-"));

export let site: Server;

export let siteUrl = "";

beforeAll(async () => {
  site = createServer((_request, response) => response.writeHead(200).end("ok"));
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => site.close(() => resolve()));
  rmSync(workspace, { recursive: true, force: true });
});

export const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

/** The configuration of a test repository: one API of the shop, one document, a base declared for another environment. */
export function configText(modelUrl: string, changes: Record<string, unknown> = {}): string {
  return JSON.stringify({
    formatVersion: 1,
    applications: [
      {
        id: "shop",
        name: "Shop",
        type: "api",
        authentication: { method: "none" },
        environments: [
          { name: "local", apis: [{ name: "backend", baseUrl: siteUrl }] },
          { name: "staging", apis: [{ name: "backend", baseUrl: "http://127.0.0.1:1" }] },
        ],
      },
    ],
    knowledge: [
      { id: "order-specs", type: "document", path: "specs/orders.md", attachments: [{ application: "shop", environment: "local" }] },
      { id: "shop-db", type: "postgresql", connectionStringEnv: "SHOP_DB_URL", attachments: [{ application: "shop", environment: "staging" }] },
    ],
    model: { mode: "provider-key", provider: "openai", baseUrl: modelUrl, model: MODEL },
    autonomy: { level: "autonomous" },
    // The review of a plan by an agent of its own has its sessions, which the design of the agents tests.
    // One level and no visual test: a design is then one pass, which the passes of a design test by themselves.
    design: { reviewPlan: false, reviewTests: false, reviewCode: false, levels: ["functional"], visualTests: false },
    ...changes,
  });
}

/** A test repository with a remote, its configuration, a document and the base of the tests. */
export function repository(config: string | undefined): string {
  const root = mkdtempSync(join(workspace, "repo-"));
  const remote = mkdtempSync(join(workspace, "remote-"));
  git(remote, "init", "-q", "--bare", "-b", "main");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Test Maintainer");
  git(root, "config", "user.email", "maintainer@example.com");
  git(root, "config", "commit.gpgsign", "false");
  mkdirSync(join(root, "specs"));
  writeFileSync(join(root, "specs", "orders.md"), "# Orders\n\nA customer places an order.\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "tests", private: true, devDependencies: { "@playwright/test": "1.64.1" } }));
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/@playwright/test": { version: "1.64.1" } } }),
  );
  writeFileSync(join(root, ".gitignore"), ".oqas/\nnode_modules/\n");
  // The repository is a Playwright project already: the command runs in one that was initialised.
  writeFileSync(join(root, "playwright.config.ts"), "export default {};\n");
  // The types of @playwright/test the proposed tests are checked against: npm, a double here, installs nothing.
  mkdirSync(join(root, "node_modules", "@playwright", "test"), { recursive: true });
  writeFileSync(
    join(root, "node_modules", "@playwright", "test", "package.json"),
    JSON.stringify({ name: "@playwright/test", version: "1.64.1", types: "index.d.ts" }),
  );
  writeFileSync(
    join(root, "node_modules", "@playwright", "test", "index.d.ts"),
    "export interface APIResponse { ok(): boolean; text(): Promise<string>; }\nexport interface APIRequestContext { get(url: string): Promise<APIResponse>; }\nexport interface Page { goto(url: string): Promise<unknown>; }\ninterface Extending { extend<T>(fixtures: { [K in keyof T]: (given: { context: { newPage(): Promise<T[K]> } }, use: (value: T[K]) => Promise<void>) => Promise<void> }): TestType; }\ntype TestType = ((title: string, body: (fixtures: { request: APIRequestContext }) => Promise<void>) => void) & ((title: string, details: { tag: string[] }, body: (fixtures: { request: APIRequestContext }) => Promise<void>) => void) & { step<T>(title: string, body: () => Promise<T>): Promise<T> } & Extending;\nexport declare const test: TestType;\nexport declare function expect(value: unknown, message?: string): { toBe(expected: unknown): void; toContain(expected: string): void };\n",
  );
  if (config !== undefined) writeFileSync(join(root, "oqas.json"), config);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "chore: start the test repository");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-q", "origin", "main");
  return root;
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
export class FakeRunner implements CommandRunner {
  public readonly commands: StepCommand[] = [];
  private readonly root: string;
  private readonly script: Script;

  public constructor(root: string, script: Script = {}) {
    this.root = root;
    this.script = script;
  }

  public async run(step: StepCommand): Promise<CommandOutcome> {
    this.commands.push(step);
    const [program, ...args] = step.command;
    const ok = (stdout = ""): CommandOutcome => ({ exitCode: 0, stdout, stderr: "" });
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
export const isFinalRun = (command: StepCommand) =>
  command.command[1] === "test" && !command.command.includes("--list") && !command.command.includes("--update-snapshots=missing");

export const submit = (name: string, args: unknown, id: string) => ({ id, name, arguments: args });

export const mapped = {
  id: "orders",
  label: "Orders",
  description: "Placing an order.",
  elements: [{ file: "orders.md", role: "How an order is placed." }],
  body: "`orders.md` says how an order is placed.",
};

export const index = {
  domains: [{ id: "orders", label: "Orders", description: "Placing and following an order.", from: [{ source: "order-specs", domain: "orders" }] }],
};

export const spec = (title: string) =>
  `import { test, expect } from "../../../../shared/fixtures.ts";\n\ntest("${title}", async ({ request }) => {\n  await test.step("1. Get the orders", async () => {\n    const response = await request.get("/orders");\n    expect(await response.text()).toContain("A customer places an order");\n    expect("${title}").toBe("${title}");\n  });\n});\n`;

export const IDS = ["test-1", "test-2", "test-3"];

export const scenario = (id: string) => ({
  id,
  title: `The ${id} scenario`,
  intent: `Verifies ${id}.`,
  kind: "functional",
  level: "functional",
  effect: "read",
  case: id === "test-3" ? "negative" : "nominal",
  application: "shop",
  domain: "orders",
  feature: "listing",
  sources: [{ source: "order-specs", item: "Orders" }],
  // The value a scenario enters tells it from the others, which get the same orders.
  data: [{ value: id, from: "made-up" }],
  steps: [{ action: "Get the orders", actions: [], expects: [{ result: "The orders answer", shows: ["A customer places an order"], absent: [] }] }],
});

export const plan = submit("propose_plan", { scenarios: IDS.map(scenario) }, "plan");

/** The answer that ends a session of a design. */
export const ended = { body: answer(MODEL, "Done.") };

/** A read of the orders, which changes nothing. */
export const read = (id = "read") => ({ body: toolCalls(MODEL, [submit("order_specs_read_section", { number: 1 }, id)]) });

/** The replies of the session of a scenario: its test is run, then closed, then the agent answers. */
export const written = (id: string) => [
  { body: toolCalls(MODEL, [submit("run_test", { content: spec(id) }, `r-${id}`)]) },
  { body: toolCalls(MODEL, [submit("propose_test", {}, `p-${id}`)]) },
  ended,
];

/**
 * The replies of the model for the whole chain: the check of the server, the card, the index, then the
 * session that plans — a read of the orders, the plan, an answer — and the session of each of three
 * scenarios.
 */
/** The reply of the session that plans that submits the plan. */
export const planned = { body: toolCalls(MODEL, [plan]) };

export const chain = () => [
  { body: { data: [] } },
  // The document is mapped by the agent that reads it: it reads it, hands its domain in with its file, then ends.
  { body: toolCalls(MODEL, [submit("order_specs_read_file", {}, "c0")]) },
  { body: toolCalls(MODEL, [submit("write_domain", mapped, "c1")]) },
  { body: answer(MODEL, "One domain.") },
  { body: toolCalls(MODEL, [submit("submit_index", index, "x1")]) },
  { body: answer(MODEL, "One domain.") },
  read(),
  planned,
  ended,
  ...IDS.flatMap(written),
  ...Array.from({ length: 4 }, () => ended),
];

export interface Run {
  readonly code: number;
  readonly root: string;
  readonly err: string;
  readonly out: string;
  readonly server: ScriptedServer;
  readonly runner: FakeRunner;
}

export async function solo(
  replies: readonly { body: unknown }[],
  setup: {
    config?: (modelUrl: string) => string | undefined;
    environment?: string;
    root?: (config: string | undefined) => string;
    script?: Script;
    modelUrl?: string;
    command?: boolean;
    follow?: boolean;
    now?: () => Date;
    brief?: string;
    resume?: string;
  } = {},
): Promise<Run> {
  const server = await scriptedServer(replies);
  const modelUrl = setup.modelUrl ?? server.baseUrl;
  const config = setup.config === undefined ? configText(modelUrl) : setup.config(modelUrl);
  const root = (setup.root ?? repository)(config);
  const runner = new FakeRunner(root, setup.script);
  let err = "";
  let out = "";
  try {
    const code =
      setup.command === true
        ? await soloCommand(
            setup.resume === undefined
              ? [
                  "--repository",
                  root,
                  ...(setup.environment === undefined ? [] : ["--environment", setup.environment]),
                  ...(setup.brief === undefined ? [] : ["--brief", setup.brief]),
                  "--force-cartography",
                  ...(setup.follow === true ? ["--follow"] : []),
                ]
              : ["--repository", root, "--resume", setup.resume],
            { env: { SHOP_DB_URL: WITNESS }, cwd: workspace, stdout: { write: (text) => (out += text) }, stderr: { write: (text) => (err += text) }, runner },
          )
        : await new SoloRun({
            repositoryRoot: root,
            ...(setup.environment === undefined ? {} : { environment: setup.environment }),
            ...(setup.resume === undefined ? {} : { resume: setup.resume }),
            env: { SHOP_DB_URL: WITNESS },
            write: (line) => (err += line),
            print: (line) => (out += line),
            openRuntime: (resolved) => liveRuntime(resolved, {}),
            runner,
            now: setup.now ?? (() => new Date("2026-11-13T12:00:00.000Z")),
          }).run();
    return { code, root, err, out, server, runner };
  } finally {
    await server.close();
  }
}

export const stateOf = (root: string, runId = "oqas-2026-11-13T12-00-00-000Z") =>
  JSON.parse(readFileSync(join(root, ".oqas", "runs", `${runId}.json`), "utf8")) as SoloRunState;

export const journalOf = (root: string) =>
  readFileSync(join(root, ".oqas", "runs", "oqas-2026-11-13T12-00-00-000Z.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as RunEntry);

/** Every file git does not track, ignored ones included, but the types the tests are checked against. */
export const untracked = (root: string) =>
  git(root, "status", "--porcelain", "--untracked-files=all", "--ignored")
    .split("\n")
    .filter((line) => line !== "" && !line.includes("node_modules/"))
    .join("\n");

/** The identifier of the first run of each test, and the clock of the run that resumes it. */
export const FIRST_RUN = "oqas-2026-11-13T12-00-00-000Z";

export const later = (hour: number) => () => new Date(`2026-11-13T${hour}:00:00.000Z`);

/** A configuration whose tasks stop at their nth model call. */
export const boundedTo = (maxIterations: number) => (url: string) => configText(url, { autonomy: { level: "bounded", task: { maxIterations } } });

/** The names of the tools the model was offered in a request. */
export const offered = (body: unknown) => (body as { tools: { function: { name: string } }[] }).tools.map((tool) => tool.function.name);

/** The files of the tests a run tried while it designed them. */
export const tried = (runner: FakeRunner) =>
  runner.commands
    .filter((command) => command.command.includes("--update-snapshots=missing"))
    .flatMap((command) => command.command.filter((arg) => arg.endsWith(".spec.ts")));
