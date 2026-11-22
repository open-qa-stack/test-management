/** A test asked for that the test repository does not hold: no file of the path, or no test of the title in it. */
export class UnknownTestError extends Error {
  /**
   * @param path - The path of the file.
   * @param title - The titles of the test, if one was asked for.
   */
  constructor(path: string, title?: string) {
    super(title === undefined ? `The test repository holds no file of tests ${path}.` : `The file ${path} holds no test "${title}".`);
    this.name = "UnknownTestError";
  }
}
