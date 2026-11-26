import { Ajv2020 } from "ajv/dist/2020.js";
import { repeated, validate } from "./schema-validation.ts";
import { knowledgeBaseSchema, domainSubmissionSchema } from "./schema.ts";
import type { KnowledgeBase, KnowledgeBaseSubmission, KnowledgeBaseError, KnowledgeBaseValidation } from "./types.ts";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const checkSubmission = ajv.compile<KnowledgeBaseSubmission>(domainSubmissionSchema);
const checkKnowledgeBase = ajv.compile<KnowledgeBase>(knowledgeBaseSchema);

/**
 * Validates what the cartographer hands in: the schema, then unique domain identifiers.
 *
 * @param value - The submission, as the agent wrote it.
 * @returns The submission, or every error found, each with its location.
 */
export function validateDomainSubmission(value: unknown): KnowledgeBaseValidation<KnowledgeBaseSubmission> {
  return validate(checkSubmission, value, (submission) => duplicateDomains(submission));
}

/**
 * Validates a knowledge base: the schema, unique domain and source identifiers, references to listed sources only, a
 * card fingerprint for sources read only, and a status that is `complete` only when every source was read.
 *
 * @param value - The knowledge base.
 * @returns The knowledge base, or every error found, each with its location.
 */
export function validateKnowledgeBase(value: unknown): KnowledgeBaseValidation<KnowledgeBase> {
  return validate(checkKnowledgeBase, value, (knowledgeBase) => {
    const listed = new Set(knowledgeBase.sources.map((source) => source.id));
    const errors = [
      ...duplicateDomains(knowledgeBase),
      ...duplicateSources(knowledgeBase),
      ...unlistedSources(knowledgeBase, listed),
      ...cardsOfUnreadSources(knowledgeBase),
    ];
    if (knowledgeBase.status === "complete" && knowledgeBase.sources.some((source) => source.state === "not_read")) {
      errors.push({ path: "/status", message: "/status is complete although a source was not read." });
    }
    return errors;
  });
}

function duplicateDomains({ domains }: KnowledgeBaseSubmission): KnowledgeBaseError[] {
  return repeated(
    domains.map((domain) => domain.id),
    "/domains",
    "id",
    "domain",
  );
}

function duplicateSources({ sources }: KnowledgeBase): KnowledgeBaseError[] {
  return repeated(
    sources.map((source) => source.id),
    "/sources",
    "id",
    "source",
  );
}

function cardsOfUnreadSources({ sources }: KnowledgeBase): KnowledgeBaseError[] {
  return sources.flatMap((source, i) =>
    source.state === "not_read" && source.cardFingerprint !== undefined
      ? [{ path: `/sources/${i}/cardFingerprint`, message: `/sources/${i}/cardFingerprint is given although ${source.id} was not read.` }]
      : [],
  );
}

function unlistedSources(knowledgeBase: KnowledgeBase, listed: ReadonlySet<string>): KnowledgeBaseError[] {
  const groups = [
    ...knowledgeBase.domains.flatMap((domain, i) => domain.references.map((r, j) => [`/domains/${i}/references/${j}`, r.source] as const)),
    ...knowledgeBase.unassigned.map((r, j) => [`/unassigned/${j}`, r.source] as const),
  ];
  return groups
    .filter(([, source]) => !listed.has(source))
    .map(([path, source]) => ({ path: `${path}/source`, message: `${path}/source names ${source}, which is not a listed source.` }));
}
