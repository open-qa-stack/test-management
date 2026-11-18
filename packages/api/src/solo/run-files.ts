/** The files a run of the command line writes to, absolute. */
export interface RunFiles {
  /** The identifier of the run: `oqas-` and the date it started. */
  readonly id: string;
  /** Its journal, which exists from its start on. */
  readonly journal: string;
  /** Its state, which the run writes when it ends. */
  readonly state: string;
  /** Its traces, in the order they started. */
  readonly traces: readonly string[];
}
