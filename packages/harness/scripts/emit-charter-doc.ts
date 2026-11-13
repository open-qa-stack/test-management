import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CharterRule } from "../src/charter/charter-rule.ts";
import { DEFAULT_CHARTER } from "../src/charter/default-charter.ts";

export const CHARTER_DOC_FILE = fileURLToPath(new URL("../docs/test-charter.md", import.meta.url));

const START = "<!-- rules:start -->";
const END = "<!-- rules:end -->";

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
 * @param doc - The content of the documentation page.
 * @returns The part of the page between the rule markers.
 */
export function documentedRules(doc: string): string {
  return doc.slice(doc.indexOf(START) + START.length, doc.indexOf(END)).trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const doc = readFileSync(CHARTER_DOC_FILE, "utf8");
  writeFileSync(CHARTER_DOC_FILE, `${doc.slice(0, doc.indexOf(START) + START.length)}\n\n${renderRules()}\n\n${doc.slice(doc.indexOf(END))}`);
}
