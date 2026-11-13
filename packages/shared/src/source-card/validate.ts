import { Ajv2020 } from "ajv/dist/2020.js";
import { repeated, validate } from "../domain-index/schema-validation.ts";
import type { IndexError, IndexValidation } from "../domain-index/types.ts";
import { sourceCardSchema, sourceCardSubmissionSchema } from "./schema.ts";
import type { SourceCard, SourceCardSubmission } from "./types.ts";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const checkSubmission = ajv.compile<SourceCardSubmission>(sourceCardSubmissionSchema);
const checkCard = ajv.compile<SourceCard>(sourceCardSchema);

/**
 * Validates what the cartographer of one source hands in: the schema, then unique domains.
 *
 * @param value - The submission, as the agent wrote it.
 * @returns The submission, or every error found, each with its location.
 */
export function validateSourceCardSubmission(value: unknown): IndexValidation<SourceCardSubmission> {
  return validate(checkSubmission, value, (submission) => domainsOnce(submission.domains));
}

/**
 * Validates a source card: the schema, then unique domains.
 *
 * @param value - The card.
 * @returns The card, or every error found, each with its location.
 */
export function validateSourceCard(value: unknown): IndexValidation<SourceCard> {
  return validate(checkCard, value, (card) => domainsOnce(card.domains));
}

function domainsOnce(domains: readonly { id: string }[]): IndexError[] {
  return repeated(
    domains.map((domain) => domain.id),
    "/domains",
    "id",
    "domain",
  );
}
