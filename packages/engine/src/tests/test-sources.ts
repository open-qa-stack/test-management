import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existingTests, TestRepository, type ExistingTest } from "@open-qa-stack/agents";
import {
  DEFAULT_REPOSITORY,
  TestChangeRefusedError,
  UnknownTestError,
  type ConfigurationQueries,
  type RepositoryTest,
  type TestChange,
  type TestEdit,
  type TestSource,
  type TestStorePort,
} from "@open-qa-stack/domain";
import { changedTest } from "@open-qa-stack/tools";
import { NoRepositoryError } from "../sessions/no-repository-error.ts";
import type { RepositoryTests } from "./repository-tests.ts";

/** What the operations on the source of the tests are given. */
export interface TestSourcesHost {
  /** Absolute path of the test repository; `undefined` for a host that has none, which reads and changes none. */
  readonly repository: string | undefined;
  /** What tells the revision in force of the configuration, which names the folder of the applications. */
  readonly configuration: ConfigurationQueries;
  /** The tests of the repository, which tell a test as its file is once changed. */
  readonly tests: RepositoryTests;
  /** What keeps the tests under their identifiers, with their history. */
  readonly identities: TestStorePort;
  /** Gives the identifier of a test that bears none; a random UUID by default. */
  readonly newId?: () => string;
}

/**
 * The operations on the source of the tests of the test repository: read the file of a test, and change a test — its
 * own title, or the text of one of its steps — as a person asks in the console or the command.
 *
 * @remarks
 * Only the files the tests are listed from are read or written: those of the folder of the applications of the
 * revision in force. A change rewrites the literal it is about, from the syntax tree of the file, and keeps the rest of
 * the file as it is. A test changed for the first time is given its identifier, as its tag `@oqas-id-…`, in the same
 * write: its history is kept under it from then on, and follows the test once renamed.
 *
 * The file is committed alone on the branch checked out, with the identity git knows in the test repository, and
 * nothing else the repository has changed or staged. A change is refused before anything is written when the file
 * cannot be committed so: no branch, a merge or a rebase under way, changes of the file not committed. A commit git
 * refuses puts the file back as it was.
 */
export class TestSources {
  readonly #host: TestSourcesHost;

  /** @param host - The repository, the configuration, the tests and what keeps them under their identifiers. */
  constructor(host: TestSourcesHost) {
    this.#host = host;
  }

  /**
   * @param path - The path of a file of tests, relative to the root of the test repository.
   * @returns Its text as it is now.
   * @throws `NoRepositoryError` for a host without a test repository.
   * @throws `UnknownTestError` when the repository lists no file of tests of the path.
   */
  async read(path: string): Promise<TestSource> {
    const { content } = await this.#file(path);
    return { path, content };
  }

  /**
   * Changes a test of the repository, and keeps it under its identifier, given to it if it bore none, at its new place.
   *
   * @param change - The test, by its path and its titles, and what changes of it.
   * @returns The test as its file now tells it, with its identifier.
   * @throws `NoRepositoryError` for a host without a test repository.
   * @throws `UnknownTestError` when the repository holds no such test.
   * @throws `TestChangeRefusedError` when the change cannot be written.
   */
  async change({ path, title, change }: TestChange): Promise<RepositoryTest> {
    const file = await this.#file(path);
    const { content, title: changed, id } = await changedTest(path, file.content, title, change, this.#host.newId ?? randomUUID);
    const repository = new TestRepository(this.#host.repository!);
    const problem = await repository.fileProblem(path);
    if (problem !== undefined) throw new TestChangeRefusedError(problem);
    const target = join(this.#host.repository!, path);
    await writeFile(target, content);
    try {
      await repository.commitFile(path, commitMessage(title, change, changed));
    } catch (error) {
      await writeFile(target, file.content);
      throw new TestChangeRefusedError(`git refused to commit ${path}, which is left as it was: ${refusalOf(error)}`);
    }
    await this.#host.identities.identify([{ id, path, title: changed, was: { path, title } }]);
    return (await this.#host.tests.listed()).items.find((test) => test.path === path && test.title === changed)!;
  }

  /** The file of tests of a path, among those the tests are listed from. */
  async #file(path: string): Promise<ExistingTest> {
    const { repository, configuration } = this.#host;
    if (repository === undefined) throw new NoRepositoryError("No test can be read or changed");
    const revision = await configuration.inForce();
    const files = revision === undefined ? [] : await existingTests(repository, revision.document.repository?.appsDir ?? DEFAULT_REPOSITORY.appsDir);
    const file = files.find((candidate) => candidate.path === path);
    if (file === undefined) throw new UnknownTestError(path);
    return file;
  }
}

/** The message of the commit of a change to a test: what changed, and of which test. */
function commitMessage(title: string, edit: TestEdit, changed: string): string {
  return "title" in edit ? `test: rename "${title}" to "${changed}"` : `test: reword step ${edit.step} of "${title}"`;
}

/** What git said when it refused a commit, in one line. */
function refusalOf(error: unknown): string {
  const said = (error as { readonly stderr?: unknown }).stderr;
  const text = typeof said === "string" && said.trim() !== "" ? said : String(error);
  return text.trim().split("\n")[0]!;
}
