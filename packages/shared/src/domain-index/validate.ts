import { Ajv2020 } from "ajv/dist/2020.js";
import { repeated, validate } from "./schema-validation.ts";
import { domainIndexSchema, domainSubmissionSchema } from "./schema.ts";
import type { DomainIndex, DomainIndexSubmission, IndexError, IndexValidation } from "./types.ts";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const checkSubmission = ajv.compile<DomainIndexSubmission>(domainSubmissionSchema);
const checkIndex = ajv.compile<DomainIndex>(domainIndexSchema);

/**
 * Validates what the cartographer hands in: the schema, then unique domain identifiers.
 *
 * @param value - The submission, as the agent wrote it.
 * @returns The submission, or every error found, each with its location.
 */
export function validateDomainSubmission(value: unknown): IndexValidation<DomainIndexSubmission> {
  return validate(checkSubmission, value, (submission) => duplicateDomains(submission));
}

/**
 * Validates a domain index: the schema, unique domain and source identifiers, references to listed sources only, a
 * card fingerprint for sources read only, and a status that is `complete` only when every source was read.
 *
 * @param value - The index.
 * @returns The index, or every error found, each with its location.
 */
export function validateDomainIndex(value: unknown): IndexValidation<DomainIndex> {
  return validate(checkIndex, value, (index) => {
    const listed = new Set(index.sources.map((source) => source.id));
    const errors = [...duplicateDomains(index), ...duplicateSources(index), ...unlistedSources(index, listed), ...cardsOfUnreadSources(index)];
    if (index.status === "complete" && index.sources.some((source) => source.state === "not_read")) {
      errors.push({ path: "/status", message: "/status is complete although a source was not read." });
    }
    return errors;
  });
}

function duplicateDomains({ domains }: DomainIndexSubmission): IndexError[] {
  return repeated(
    domains.map((domain) => domain.id),
    "/domains",
    "id",
    "domain",
  );
}

function duplicateSources({ sources }: DomainIndex): IndexError[] {
  return repeated(
    sources.map((source) => source.id),
    "/sources",
    "id",
    "source",
  );
}

function cardsOfUnreadSources({ sources }: DomainIndex): IndexError[] {
  return sources.flatMap((source, i) =>
    source.state === "not_read" && source.cardFingerprint !== undefined
      ? [{ path: `/sources/${i}/cardFingerprint`, message: `/sources/${i}/cardFingerprint is given although ${source.id} was not read.` }]
      : [],
  );
}

function unlistedSources(index: DomainIndex, listed: ReadonlySet<string>): IndexError[] {
  const groups = [
    ...index.domains.flatMap((domain, i) => domain.references.map((r, j) => [`/domains/${i}/references/${j}`, r.source] as const)),
    ...index.unassigned.map((r, j) => [`/unassigned/${j}`, r.source] as const),
  ];
  return groups
    .filter(([, source]) => !listed.has(source))
    .map(([path, source]) => ({ path: `${path}/source`, message: `${path}/source names ${source}, which is not a listed source.` }));
}
