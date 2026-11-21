/** Where the values of the variables a person gives are kept, out of the test repository. */
export interface SecretStore {
  /**
   * @returns Every value kept, by the name of its variable; none when nothing was ever kept.
   * @throws When the values kept cannot be read.
   */
  read(): Promise<Record<string, string>>;

  /**
   * Keeps these values in place of those kept.
   *
   * @param values - Every value to keep, by the name of its variable.
   * @throws When they cannot be kept; those kept before stay.
   */
  write(values: Readonly<Record<string, string>>): Promise<void>;
}
