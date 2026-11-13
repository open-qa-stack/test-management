import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { pointer } from "../config/errors.ts";
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
 * Validates a domain index: the schema, unique domain and source identifiers, references to listed sources only, and
 * a status that is `complete` only when every source was read.
 *
 * @param value - The index.
 * @returns The index, or every error found, each with its location.
 */
export function validateDomainIndex(value: unknown): IndexValidation<DomainIndex> {
  return validate(checkIndex, value, (index) => {
    const listed = new Set(index.sources.map((source) => source.id));
    const errors = [...duplicateDomains(index), ...duplicateSources(index), ...unlistedSources(index, listed)];
    if (index.status === "complete" && index.sources.some((source) => source.state === "not_read")) {
      errors.push({ path: "/status", message: "/status is complete although a source was not read." });
    }
    return errors;
  });
}

function validate<T>(check: ValidateFunction<T>, value: unknown, rules: (valid: T) => IndexError[]): IndexValidation<T> {
  if (!check(value)) return { ok: false, errors: check.errors!.map(schemaError) };
  const errors = rules(value);
  return errors.length === 0 ? { ok: true, value } : { ok: false, errors };
}

function schemaError(error: ErrorObject): IndexError {
  const named = error.keyword === "required" || error.keyword === "additionalProperties" ? pointer(error.instancePath, String(Object.values(error.params)[0])) : error.instancePath;
  const message = error.keyword === "additionalProperties" ? `${named} is not allowed.` : `${error.instancePath === "" ? "The document" : error.instancePath} ${String(error.message)}.`;
  return { path: named, message };
}

function duplicateDomains({ domains }: DomainIndexSubmission): IndexError[] {
  const seen = new Set<string>();
  return domains.flatMap((domain, i) => {
    const repeated = seen.has(domain.id);
    seen.add(domain.id);
    return repeated ? [{ path: `/domains/${i}/id`, message: `/domains/${i}/id repeats the domain ${domain.id}.` }] : [];
  });
}

function duplicateSources({ sources }: DomainIndex): IndexError[] {
  const seen = new Set<string>();
  return sources.flatMap((source, i) => {
    const repeated = seen.has(source.id);
    seen.add(source.id);
    return repeated ? [{ path: `/sources/${i}/id`, message: `/sources/${i}/id repeats the source ${source.id}.` }] : [];
  });
}

function unlistedSources(index: DomainIndex, listed: ReadonlySet<string>): IndexError[] {
  const groups = [...index.domains.flatMap((domain, i) => domain.references.map((r, j) => [`/domains/${i}/references/${j}`, r.source] as const)), ...index.unassigned.map((r, j) => [`/unassigned/${j}`, r.source] as const)];
  return groups.filter(([, source]) => !listed.has(source)).map(([path, source]) => ({ path: `${path}/source`, message: `${path}/source names ${source}, which is not a listed source.` }));
}
