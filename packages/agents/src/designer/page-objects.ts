import { readdir, readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import {
  applicationPages,
  applicationVariable,
  PAGES_FOLDER,
  PAGES_INDEX,
  screenMember,
  type PlannedScenario,
  type PlannedStep,
  type ScreenClass,
} from "@open-qa-stack/domain";
import { memberAction } from "./locator-member.ts";
import { PageObjectFile, screenFile } from "./page-object-file.ts";

/** What the page objects of a test repository are written from. */
export interface PageObjectsOptions {
  /** Absolute path of the test repository. */
  readonly repositoryRoot: string;
  /** Folder of the applications, relative to the root. */
  readonly appsDir: string;
  /** The applications whose fixture the repository gives, which holds their page objects. */
  readonly applications: readonly { readonly id: string; readonly name: string }[];
}

/** A file of the page objects, with its text. */
export interface PageFile {
  /** Its path, relative to the root of the test repository. */
  readonly path: string;
  readonly content: string;
}

/** The class a page object declares, as its file writes it. */
const DECLARED = /^export class (\w+)/m;

/**
 * The page objects of a test repository, written from the plans: each action a scenario does on an element
 * of a screen acts on a member of the page object of that screen, which the harness adds when it is not there.
 *
 * @remarks
 * A scenario is written against page objects when the fixtures of the repository give each application it
 * acts on, and line by line: an action whose screen the exploration did not tell, or that this does not read
 * as an element found by its role, its label or its text, stays as the browser tool returned it.
 */
export class PageObjects {
  readonly #options: PageObjectsOptions;
  /** The page objects read or written, by the path of their file. */
  readonly #files = new Map<string, { readonly screen: ScreenClass; readonly object: PageObjectFile }>();

  /** @param options - The repository and the applications its fixtures give. */
  public constructor(options: PageObjectsOptions) {
    this.#options = options;
  }

  /**
   * Writes the scenarios against the page objects, which are added to as needed.
   *
   * @param scenarios - The scenarios of a plan.
   * @returns The scenarios, each line of code that acts on an element acting on its member.
   */
  public async apply<Scenario extends PlannedScenario>(scenarios: readonly Scenario[]): Promise<Scenario[]> {
    const given = new Set(this.#options.applications.map((application) => application.id));
    const applied: Scenario[] = [];
    for (const scenario of scenarios) {
      const acted = scenario.steps.flatMap((step) => (step.lines ?? []).map((line) => line.application));
      if ([scenario.application, ...acted].every((application) => given.has(application))) {
        const steps: PlannedStep[] = [];
        for (const step of scenario.steps) steps.push(await this.#step(step));
        applied.push({ ...scenario, steps });
      } else applied.push(scenario);
    }
    return applied;
  }

  /**
   * The files to write: each page object, and for each application the file that gathers those of its folder.
   *
   * @returns The files, by their path.
   */
  public async files(): Promise<PageFile[]> {
    const { repositoryRoot, appsDir, applications } = this.#options;
    const files: PageFile[] = [...this.#files].map(([path, { object }]) => ({ path, content: object.content }));
    for (const application of applications) {
      const folder = posix.join(appsDir, application.id, PAGES_FOLDER);
      const screens = new Map<string, ScreenClass>();
      for (const file of await readdir(join(repositoryRoot, folder)).catch(() => [])) {
        const name = file.endsWith(".page.ts") ? DECLARED.exec(await readFile(join(repositoryRoot, folder, file), "utf8"))?.[1] : undefined;
        if (name !== undefined) screens.set(file, { name, file });
      }
      for (const [path, { screen }] of this.#files) if (posix.dirname(path) === folder) screens.set(screen.file, screen);
      files.push({ path: posix.join(folder, PAGES_INDEX), content: applicationPages(application, [...screens.values()]) });
    }
    return files;
  }

  /** A step, each line of its code that acts on an element of a screen acting on the member of its page object. */
  async #step(step: PlannedStep): Promise<PlannedStep> {
    const { lines } = step;
    if (lines?.length !== step.code.length) return step;
    const code: string[] = [];
    for (const [at, line] of lines.entries()) {
      const acting = line.screen === undefined ? undefined : memberAction(line.code);
      if (acting === undefined) code.push(step.code[at]!);
      else {
        const { screen, object } = await this.#file(line.application, line.screen!);
        const name = object.member(acting.member);
        const located = acting.member.parameters.length === 0 ? name : `${name}(${acting.given.join(", ")})`;
        code.push(`await ${applicationVariable(line.application)}.${screenMember(screen.name)}.${located}.${acting.action};`);
      }
    }
    return { ...step, code };
  }

  /** The page object of a screen of an application, read from its file when the repository has it. */
  async #file(application: string, route: string): Promise<{ readonly screen: ScreenClass; readonly object: PageObjectFile }> {
    const screen = screenFile(route);
    const path = posix.join(this.#options.appsDir, application, PAGES_FOLDER, screen.file);
    const held = this.#files.get(path);
    if (held !== undefined) return held;
    const existing = await readFile(join(this.#options.repositoryRoot, path), "utf8").catch(() => undefined);
    const name = this.#options.applications.find((declared) => declared.id === application)!.name;
    // A file already there keeps the name of its class, whatever a person called it.
    const declared = existing === undefined ? undefined : DECLARED.exec(existing)?.[1];
    const read = { screen: { ...screen, name: declared ?? screen.name }, object: new PageObjectFile(screen, `${route} of ${name}`, existing) };
    this.#files.set(path, read);
    return read;
  }
}
