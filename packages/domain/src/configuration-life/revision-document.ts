import { validateConfig, type EnvironmentVariables } from "../config/validate.ts";
import type { ConfigError, OqasConfig } from "../config/types.ts";

/** An environment in which every variable is set: a revision names the variables of its runs, which set them. */
const EVERY_VARIABLE_SET: EnvironmentVariables = new Proxy({}, { get: () => "set" });

/** What a text gives as the document of a revision: the document, or every error found. */
export type RevisionDocument = { readonly ok: true; readonly document: OqasConfig } | { readonly ok: false; readonly errors: ConfigError[] };

/**
 * Reads a configuration that would become a revision, and validates it by the schema of the configuration file and the
 * rules that span the document.
 *
 * @remarks
 * The environment is left out: a revision names the variables its runs read, and whether one is set is told
 * by the run, on the machine that runs it.
 *
 * @param content - The configuration, as the configuration file holds it.
 * @returns The document as it was written, or every error found, each where it is.
 */
export function revisionDocument(content: string): RevisionDocument {
  const result = validateConfig(content, EVERY_VARIABLE_SET);
  if (!result.ok) return { ok: false, errors: result.errors };
  return { ok: true, document: JSON.parse(content.replace(/^﻿/, "")) as OqasConfig };
}
