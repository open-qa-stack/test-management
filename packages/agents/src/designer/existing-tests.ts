import { readdir, readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import type { PlannedScenario, ToolDefinition } from "@open-qa-stack/domain";
import { writtenValues } from "./assertion-line.ts";
import { DESIGNS_FOLDER, type DesignState } from "./design-state.ts";
import type { CoveringTest } from "./plan-draft.ts";
import { readPlanFile } from "./plan-file.ts";
import { described } from "./scenario-description.ts";
import type { Verified } from "./verified.ts";

/** Name of the tool that lists the tests the repository already has. */
export const TESTS_LIST_TOOL = "tests_list";
/** Name of the tool that gives the text of one of them. */
export const TESTS_READ_TOOL = "tests_read";

/** Most characters of a test given to the agent. */
const MAX_TEST_CHARACTERS = 6000;

/** A test the repository already has, as the agent that plans is told of it. */
export interface ExistingTest {
  /** Its path, relative to the root of the test repository. */
  readonly path: string;
  /** Its title; its path when the file gives none. */
  readonly title: string;
  /** Its tags, such as `@level-functional` and `@domain-customers`. */
  readonly tags: readonly string[];
  /** The titles of its steps, in order. */
  readonly steps: readonly string[];
  readonly content: string;
}

const TITLE = /\btest(?:\.\w+)?\(\s*("(?:[^"\\]|\\.)*")/;
const TAGS = /\btag:\s*(\[[^\]]*\])/;
const STEP = /\btest\.step\(\s*("(?:[^"\\]|\\.)*")/g;

/** A text between double quotes, as a file writes it; the text itself when it cannot be read. */
function unquoted(text: string): string {
  try {
    return JSON.parse(text) as string;
  } catch {
    return text;
  }
}

/** The test files under a folder, each by its path relative to the root of the repository. */
async function testFiles(repositoryRoot: string, folder: string): Promise<string[]> {
  const entries = await readdir(join(repositoryRoot, folder), { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    const path = posix.join(folder, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") found.push(...(await testFiles(repositoryRoot, path)));
    else if (/\.(spec|test)\.ts$/.test(entry.name)) found.push(path);
  }
  return found;
}

/**
 * The tests a repository already has, read from their files: whoever wrote them.
 *
 * @param repositoryRoot - Absolute path of the test repository.
 * @param appsDir - Folder of the applications, relative to the root.
 * @returns Each test file, with its title, its tags and the titles of its steps.
 */
export async function existingTests(repositoryRoot: string, appsDir: string): Promise<ExistingTest[]> {
  const tests: ExistingTest[] = [];
  for (const path of await testFiles(repositoryRoot, appsDir)) {
    const content = await readFile(join(repositoryRoot, path), "utf8");
    const title = TITLE.exec(content)?.[1];
    const tags = TAGS.exec(content)?.[1];
    tests.push({
      path,
      title: title === undefined ? path : unquoted(title),
      tags: tags === undefined ? [] : [...tags.matchAll(/"([^"]+)"/g)].map((match) => match[1]!),
      steps: [...content.matchAll(STEP)].map((match) => unquoted(match[1]!)),
      content,
    });
  }
  return tests;
}

/** What the test of a scenario of an earlier plan does and verifies; `undefined` when the plan did not keep where its lines come from. */
function verifiedOf(scenario: PlannedScenario): Verified | undefined {
  if (scenario.steps.some((step) => step.lines?.length !== step.code.length)) return undefined;
  return {
    application: scenario.application,
    data: scenario.data.map((entry) => entry.value),
    steps: scenario.steps.map((step) => {
      const done = step.lines!.flatMap((line) => [line.code, line.typed ?? ""]);
      return {
        does: done.length === 0 ? [step.action] : done,
        shows: step.expects.flatMap((expect) => expect.shows),
        absent: step.expects.flatMap((expect) => expect.absent),
      };
    }),
  };
}

/**
 * The tests of earlier designs the repository still has and that passed, each by what it does and verifies:
 * what a new scenario is compared with, by the code, as it is with the scenarios of its own plan.
 *
 * @remarks
 * Each is read from the state of its design and the plan that state names. A test whose file is gone, that
 * did not pass, or whose plan cannot be read is left out: it covers nothing.
 *
 * @param repositoryRoot - Absolute path of the test repository.
 * @param stateDir - Folder of the state, relative to the root.
 * @param present - The paths of the test files the repository has.
 * @returns The tests, in the order of their designs.
 */
export async function coveringTests(repositoryRoot: string, stateDir: string, present: readonly string[]): Promise<CoveringTest[]> {
  const folder = join(repositoryRoot, stateDir, DESIGNS_FOLDER);
  const states = (await readdir(folder).catch(() => [])).filter((name) => name.endsWith(".json")).toSorted();
  const covering: CoveringTest[] = [];
  for (const name of states) {
    const state = JSON.parse(await readFile(join(folder, name), "utf8")) as Partial<DesignState>;
    const plan = readPlanFile(await readFile(join(repositoryRoot, state.plan ?? ""), "utf8").catch(() => ""));
    for (const test of state.tests ?? []) {
      const scenario = plan?.scenarios.find((candidate) => candidate.id === test.scenario);
      const verified = scenario === undefined || test.verdict !== "passed" || !present.includes(test.path) ? undefined : verifiedOf(scenario);
      if (verified !== undefined)
        covering.push({
          path: test.path,
          verified,
          described: described(scenario!),
          writes: writtenValues(scenario!),
          visual: scenario!.kind === "visual",
          opens: scenario!.steps.flatMap((step) => step.lines!).filter((line) => line.code.startsWith("await page.goto(")),
        });
    }
  }
  return covering;
}

/**
 * The tools that tell the agent that plans what the repository already tests.
 *
 * @param tests - The tests the repository has.
 * @returns `tests_list`, which names each test with its tags and its steps, all of them or those whose path
 * or tags hold a word; and `tests_read`, which gives the text of one.
 */
export function existingTestTools(tests: readonly ExistingTest[]): ToolDefinition[] {
  return [
    {
      name: TESTS_LIST_TOOL,
      description:
        "Lists the tests the test repository already has: the path of each, its title, its tags (level, domain, functionality, application) and the titles of its steps. Call it before you plan: a scenario a test already verifies is set aside.",
      parameters: {
        type: "object",
        properties: {
          about: {
            type: "string",
            description: "A word the path or a tag of the tests must hold, such as an application, a domain or a functionality; every test without it.",
          },
        },
        additionalProperties: false,
      },
      execute: async (args) => {
        const about = ((args as { about?: unknown }).about ?? "") as string;
        const held = tests.filter((test) => [test.path, ...test.tags].some((text) => text.toLowerCase().includes(about.toLowerCase())));
        return { tests: held.map(({ path, title, tags, steps }) => ({ path, title, tags, steps })) };
      },
    },
    {
      name: TESTS_READ_TOOL,
      description: `Gives the text of a test of the repository, by the path ${TESTS_LIST_TOOL} gave.`,
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Path of the test." } },
        required: ["path"],
        additionalProperties: false,
      },
      execute: async (args) => {
        const { path } = args as { path: string };
        const test = tests.find((candidate) => candidate.path === path);
        if (test === undefined) return { error: `No test at ${path}. Call ${TESTS_LIST_TOOL} for the paths of the tests.` };
        return { path, content: test.content.slice(0, MAX_TEST_CHARACTERS), truncated: test.content.length > MAX_TEST_CHARACTERS };
      },
    },
  ];
}
