/** A file could not be read as a recording. */
export class RecordingFormatError extends Error {
  /** Name of the error class, kept when the error is serialised. */
  public override readonly name = "RecordingFormatError";
}
