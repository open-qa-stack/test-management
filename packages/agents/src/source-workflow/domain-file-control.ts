import type { SourceManifest } from "@open-qa-stack/domain";
import { redactText, secretForms } from "@open-qa-stack/tools";
import { cites } from "./cited-names.ts";
import type { DomainMember } from "./domain-file.ts";

/** Longest body of a domain file, in characters. */
export const MAX_DOMAIN_FILE_LENGTH = 12_000;

/**
 * Checks the body of a domain file by program.
 *
 * @remarks
 * The harness refuses an empty body, one longer than `MAX_DOMAIN_FILE_LENGTH`, one that holds a secret of
 * the configuration — which it never repeats — and one that leaves an element of the domain unnamed. An
 * element with arguments, such as a routine, may be named without them. It proposes the backticks around an
 * element the body names without them.
 *
 * @param body - The body, as the model wrote it.
 * @param members - The elements of the domain.
 * @param secrets - The secrets of the configuration.
 * @returns What is wrong, each with what to do; nothing when the body can be kept.
 */
export function domainFileErrors(body: string, members: readonly DomainMember[], secrets: readonly string[]): string[] {
  if (body === "") return ["The answer is empty. Write the markdown body of the file."];
  const errors: string[] = [];
  if (body.length > MAX_DOMAIN_FILE_LENGTH)
    errors.push(`The body has ${body.length} characters. Keep it under ${MAX_DOMAIN_FILE_LENGTH}: one line per element, and shorter hints.`);
  if (redactText(body, secrets.flatMap(secretForms)) !== body) errors.push("The body holds a secret of the configuration. Write it without the secret.");
  const unquoted = members.filter((member) => !cites(body, member.name));
  const bare = unquoted.filter((member) => body.includes(member.name));
  const missing = unquoted.filter((member) => !bare.includes(member));
  for (const member of bare) errors.push(`${member.name} is named, but not between backticks. Proposed: \`${member.name}\`, where you name it.`);
  if (missing.length > 0)
    errors.push(
      `These elements of the domain are not named: ${missing.map((member) => member.name).join(", ")}. Name each exactly as written, between backticks, such as \`${missing[0]!.name}\`.`,
    );
  return errors;
}

/**
 * Checks, for the whole source, that no exported element is lost: each is named in the file of its domain,
 * or set aside with its reason.
 *
 * @param manifest - The manifest of the source.
 * @param files - The text of the file of each domain that has one, by identifier of the domain.
 * @returns An error for each element that is neither; nothing when the source is covered.
 */
export function coverageErrors(manifest: SourceManifest, files: ReadonlyMap<string, string>): string[] {
  return manifest.elements.flatMap((element) => {
    if (element.dismissed !== undefined) return [];
    if (element.domain === undefined) return [`${element.name} is in no domain and was not set aside.`];
    return cites(files.get(element.domain) ?? "", element.name) ? [] : [`${element.name} is not named in the file of its domain ${element.domain}.`];
  });
}
