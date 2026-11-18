import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { RUNS_FOLDER, runStateFile, type RunState } from "@open-qa-stack/domain";
import type { RunReference, RunStore, StoredState } from "@open-qa-stack/engine";

/** The states of the runs of a test repository as the command line keeps them: a JSON file per run, `<stateDir>/runs/<run>.json`. */
export class FileRunStore implements RunStore {
  private readonly repositoryRoot: string;

  /** @param repositoryRoot - Absolute path of the test repository. */
  public constructor(repositoryRoot: string) {
    this.repositoryRoot = repositoryRoot;
  }

  /** {@inheritDoc @open-qa-stack/engine#RunStore.location} */
  public location(run: RunReference): string {
    return posix.join(run.stateDir, RUNS_FOLDER, runStateFile(run.runId));
  }

  /** {@inheritDoc @open-qa-stack/engine#RunStore.read} */
  public async read(run: RunReference): Promise<StoredState> {
    const where = join(this.repositoryRoot, run.stateDir, RUNS_FOLDER, runStateFile(run.runId));
    return { where, state: await readJson(where) };
  }

  /** {@inheritDoc @open-qa-stack/engine#RunStore.readAll} */
  public async readAll(stateDir: string): Promise<readonly unknown[]> {
    const folder = join(this.repositoryRoot, stateDir, RUNS_FOLDER);
    const names = await readdir(folder).catch(() => []);
    return Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => readJson(join(folder, name))));
  }

  /** {@inheritDoc @open-qa-stack/engine#RunStore.write} */
  public async write(run: RunReference, state: RunState): Promise<void> {
    const path = join(this.repositoryRoot, this.location(run));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
  }
}

/** The JSON of a file, or `undefined` when it cannot be read or parsed. */
function readJson(path: string): Promise<unknown> {
  return readFile(path, "utf8")
    .then((text) => JSON.parse(text) as unknown)
    .catch(() => undefined);
}
