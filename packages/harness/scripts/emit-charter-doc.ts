import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CharterControl } from "../src/charter/charter-control.ts";
import { CHARTER_CONTROLS } from "../src/charter/charter-controls.ts";
import type { CharterRule } from "../src/charter/charter-rule.ts";
import { DEFAULT_CHARTER } from "../src/charter/default-charter.ts";

export const CHARTER_DOC_FILE = fileURLToPath(new URL("../docs/test-charter.md", import.meta.url));

/** A part of the page generated from the charter, between `<!-- name:start -->` and `<!-- name:end -->`. */
export type GeneratedSection = "rules" | "controls";

/**
 * @param charter - The rules to describe.
 * @returns The Markdown of the rules, as the documentation lists them.
 */
export function renderRules(charter: readonly CharterRule[] = DEFAULT_CHARTER): string {
  return charter
    .map((rule) => [`### ${rule.id}`, rule.statement, `Why: ${rule.rationale} See the [Playwright documentation](${rule.source}).`, "```ts\n" + rule.example + "\n```"].join("\n\n"))
    .join("\n\n");
}

/**
 * @param controls - How each rule is checked.
 * @returns The Markdown table of the controls, one row per rule of the charter.
 */
export function renderControls(controls: readonly CharterControl[] = CHARTER_CONTROLS): string {
  const rows = controls.map((control) => `| ${control.rule} | ${control.lint.map((lint) => `\`${lint.name}\``).join(", ") || "none"} | ${control.note} |`);
  return ["| Rule | Lint rules | What is checked |", "|---|---|---|", ...rows].join("\n");
}

/**
 * @param doc - The content of the documentation page.
 * @param section - The generated part to read.
 * @returns The part of the page between the markers of the section.
 */
export function documentedSection(doc: string, section: GeneratedSection): string {
  const start = `<!-- ${section}:start -->`;
  return doc.slice(doc.indexOf(start) + start.length, doc.indexOf(`<!-- ${section}:end -->`)).trim();
}

function withSection(doc: string, section: GeneratedSection, content: string): string {
  const start = `<!-- ${section}:start -->`;
  return `${doc.slice(0, doc.indexOf(start) + start.length)}\n\n${content}\n\n${doc.slice(doc.indexOf(`<!-- ${section}:end -->`))}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const doc = readFileSync(CHARTER_DOC_FILE, "utf8");
  writeFileSync(CHARTER_DOC_FILE, withSection(withSection(doc, "rules", renderRules()), "controls", renderControls()));
}
