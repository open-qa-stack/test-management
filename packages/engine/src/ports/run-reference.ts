/** A run, as the host of the engine finds what it keeps of it. */
export interface RunReference {
  /** Identifier of the run: `oqas-` and the date it started at. */
  readonly runId: string;
  /** The state folder of the test repository, relative to it, as the configuration names it: where a host that keeps a run beside the tests puts it. */
  readonly stateDir: string;
}
