import type { ProblemCode } from "@open-qa-stack/shared/sessions";

/** Why a call to the API failed: the code of the problem the API answered, or `unreachable` when no answer came. */
export type ApiErrorCode = ProblemCode | "unreachable";

/**
 * An error of the API, in the one shape every screen shows: what to tell the person, the status that came with
 * it, and the code the console decides on.
 */
export class ApiError extends Error {
  /** The HTTP status of the answer; `0` when the instance could not be reached. */
  public readonly status: number;
  /** Why the call failed. */
  public readonly code: ApiErrorCode;

  /**
   * @param message - What to tell the person.
   * @param status - The HTTP status of the answer, or `0` when there was none.
   * @param code - Why the call failed.
   */
  public constructor(message: string, status: number, code: ApiErrorCode) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}
