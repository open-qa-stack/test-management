/** Raised when a value is given for a variable the configuration in force does not name. */
export class UnknownSecretError extends Error {
  /** @param name - The name of the variable. */
  constructor(name: string) {
    super(`The configuration in force names no variable ${name}.`);
    this.name = "UnknownSecretError";
  }
}
