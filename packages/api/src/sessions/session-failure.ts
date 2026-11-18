import type { ProblemCode } from "@open-qa-stack/shared/sessions";

/** Why a request about sessions cannot be answered: every code of a problem but the one of an unexpected error. */
export type SessionFailure = Exclude<ProblemCode, "error">;
