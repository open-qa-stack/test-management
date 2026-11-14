import type { ManifestDomain } from "@open-qa-stack/shared";

/** An element of a domain, as its file must name it. */
export interface DomainMember {
  /** Name of the element. */
  readonly name: string;
  /** What it is: `table`, `view`, `routine`. */
  readonly kind: string;
  /** What it holds or does, in one line. */
  readonly role: string;
}

/**
 * Takes away the code fence a model puts around a whole answer.
 *
 * @param text - What the model answered.
 * @returns The text without the fence that opens and closes it, trimmed; the text trimmed when it has none.
 */
export function unfenced(text: string): string {
  const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(text.trim());
  return (fenced === null ? text : fenced[1]!).trim();
}

/**
 * Writes the file of a domain of one source: the header the harness writes, then the body.
 *
 * @param domain - The domain.
 * @param body - The markdown body, as the model or the harness wrote it.
 * @returns The text of the file: the label and the identifier as its title, the description, then the body.
 */
export function renderDomainFile(domain: ManifestDomain, body: string): string {
  return `# ${domain.label} (\`${domain.id}\`)\n\n${domain.description}\n\n${body}`;
}

/**
 * The body the harness writes itself when the model gave none it could keep.
 *
 * @param members - The elements of the domain.
 * @returns A table of the elements: name, kind and role.
 */
export function minimalBody(members: readonly DomainMember[]): string {
  const rows = members.map((member) => `| \`${member.name}\` | ${member.kind} | ${member.role.replaceAll("|", "\\|")} |`);
  return ["| Element | Kind | Role |", "|---|---|---|", ...rows].join("\n");
}
