import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scriptedServer, type ScriptedServer } from "@open-qa-stack/testing";
import { configText, FakeRunner, FIRST_RUN, repository, WITNESS, workspace, type Script } from "@open-qa-stack/testing/test-repository";
import type { RunEntry, RunState } from "@open-qa-stack/domain";
import { soloCommand } from "../src/index.ts";

export * from "@open-qa-stack/testing/test-repository";

export interface Ran {
  readonly code: number;
  readonly root: string;
  readonly err: string;
  readonly out: string;
  readonly server: ScriptedServer;
  readonly runner: FakeRunner;
}

/** Runs `oqas` on a test repository, against a model that answers as scripted, with npm and Playwright doubled. */
export async function solo(
  replies: readonly { body: unknown }[],
  setup: {
    config?: (modelUrl: string) => string | undefined;
    environment?: string;
    root?: (config: string | undefined) => string;
    script?: Script;
    modelUrl?: string;
    follow?: boolean;
    /** The clock of the command; the system clock without it. */
    now?: () => Date;
    brief?: string;
    resume?: string;
  } = {},
): Promise<Ran> {
  const server = await scriptedServer(replies);
  const modelUrl = setup.modelUrl ?? server.baseUrl;
  const config = setup.config === undefined ? configText(modelUrl) : setup.config(modelUrl);
  const root = (setup.root ?? repository)(config);
  const runner = new FakeRunner(root, setup.script);
  let err = "";
  let out = "";
  try {
    const code = await soloCommand(
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
      {
        env: { SHOP_DB_URL: WITNESS },
        cwd: workspace,
        stdout: { write: (text) => (out += text) },
        stderr: { write: (text) => (err += text) },
        runner,
        ...(setup.now === undefined ? {} : { now: setup.now }),
      },
    );
    return { code, root, err, out, server, runner };
  } finally {
    await server.close();
  }
}

export const stateOf = (root: string, runId = FIRST_RUN) => JSON.parse(readFileSync(join(root, ".oqas", "runs", `${runId}.json`), "utf8")) as RunState;

export const journalOf = (root: string) =>
  readFileSync(join(root, ".oqas", "runs", `${FIRST_RUN}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as RunEntry);
