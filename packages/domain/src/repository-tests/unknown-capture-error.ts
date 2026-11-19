/** A capture asked for that the latest run of a test did not attach: no run ran the test, or it attached none for the step. */
export class UnknownCaptureError extends Error {
  /**
   * @param path - The path of the test.
   * @param step - The number of the step.
   */
  constructor(path: string, step: number) {
    super(`The latest run of ${path} attached no capture for its step ${step}.`);
    this.name = "UnknownCaptureError";
  }
}
