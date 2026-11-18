/** An application of a project. */
export interface Application {
  readonly id: string;
  readonly name: string;
}

/** The project of an instance, as far as the console names it. */
export interface Project {
  /** Its name; left out when the instance has no project yet. */
  readonly name?: string;
  readonly applications: readonly Application[];
}
