/** A test asked for that no design of the test repository gave for a person to review. */
export class UnknownProposalError extends Error {
  /** @param id - The identifier asked for. */
  constructor(id: string) {
    super(`No test the agents wrote bears the identifier ${id}.`);
    this.name = "UnknownProposalError";
  }
}
