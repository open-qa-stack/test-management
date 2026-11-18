/** Raised when a change is made from a revision of the configuration that another replaced since. */
export class StaleRevisionError extends Error {
  /** The revision the change was made from. */
  readonly basedOn: number;
  /** The revision in force. */
  readonly inForce: number;

  /**
   * @param basedOn - The revision the change was made from; 0 for none.
   * @param inForce - The revision in force; 0 for none.
   */
  constructor(basedOn: number, inForce: number) {
    super(`The change was made from the revision ${basedOn} of the configuration, and the revision in force is ${inForce}.`);
    this.name = "StaleRevisionError";
    this.basedOn = basedOn;
    this.inForce = inForce;
  }
}
