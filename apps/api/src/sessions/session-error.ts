import { problemOf } from "../problems/problem-kinds.ts";
import type { Problem } from "@open-qa-stack/domain/sessions";
import type { SessionFailure } from "./session-failure.ts";

/** Raised when a request about sessions cannot be answered; the API answers it with its problem. */
export class SessionError extends Error {
  /** Why the request cannot be answered. */
  readonly failure: SessionFailure;

  /**
   * @param failure - Why the request cannot be answered.
   * @param message - What to tell the client, in a sentence that says what to do when something can be done.
   */
  constructor(failure: SessionFailure, message: string) {
    super(message);
    this.name = "SessionError";
    this.failure = failure;
  }

  /** @returns The problem a client is told: that of its failure, with its message as the detail. */
  problem(): Problem {
    return problemOf(this.failure, this.message);
  }
}
