/** Raised when the configuration in force declares no source of that name whose documents the instance keeps. */
export class UnknownDocumentSourceError extends Error {
  /** @param source - The identifier asked for. */
  constructor(source: string) {
    super(`The configuration in force declares no knowledge source ${source} whose documents the instance keeps.`);
    this.name = "UnknownDocumentSourceError";
  }
}
