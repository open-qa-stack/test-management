/** Raised when a source of documents holds no document of that name. */
export class UnknownDocumentError extends Error {
  /**
   * @param source - The identifier of the source.
   * @param name - The file name asked for.
   */
  constructor(source: string, name: string) {
    super(`The knowledge source ${source} holds no document ${name}.`);
    this.name = "UnknownDocumentError";
  }
}
