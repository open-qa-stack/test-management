/** An environment of variables, such as `process.env`. */
export type Environment = Readonly<Record<string, string | undefined>>;

/** An environment that may change while the host runs, read each time a run starts. */
export interface EnvironmentSource {
  /**
   * @returns The environment as it is now.
   * @throws When it cannot be read.
   */
  current(): Promise<Environment>;
}
