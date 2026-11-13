import type { TestFinding } from "@open-qa-stack/domain";

/** What the linter wrote, in its JSON format. */
export interface LinterOutput {
  readonly stdout: string;
  readonly stderr: string;
}

interface Diagnostic {
  readonly message: string;
  /** Such as `playwright(no-wait-for-timeout)` or `typescript(TS2322)`; absent for a syntax error. */
  readonly code?: string;
  readonly labels?: readonly { readonly span: { readonly line: number; readonly column: number } }[];
}

interface Report {
  readonly diagnostics: readonly Diagnostic[];
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isReport(value: unknown): value is Report {
  return typeof value === "object" && value !== null && Array.isArray((value as { diagnostics?: unknown }).diagnostics);
}

/**
 * Turns the report of the linter into findings.
 *
 * @param output - What the linter wrote.
 * @param charterRuleOf - Identifier of the rule of the charter for each lint rule, by its name without plugin.
 * @returns A charter finding for each diagnostic of a lint rule of the map, a compiler finding for any other,
 * by line and column.
 * @throws Error when the output holds no report, such as when the linter could not start.
 */
export function readLintReport(output: LinterOutput, charterRuleOf: ReadonlyMap<string, string>): TestFinding[] {
  const report = parsed(output.stdout);
  if (!isReport(report)) throw new Error(`The linter gave no report: ${output.stderr}${output.stdout}`.trim());
  return report.diagnostics
    .map((diagnostic): TestFinding => {
      const span = diagnostic.labels?.[0]?.span ?? { line: 1, column: 1 };
      const position = { line: span.line, column: span.column };
      const code = diagnostic.code === undefined ? "syntax" : diagnostic.code.slice(diagnostic.code.indexOf("(") + 1, -1);
      const rule = charterRuleOf.get(code);
      return rule === undefined
        ? { kind: "compiler", code, ...position, message: diagnostic.message }
        : { kind: "charter", rule, ...position, message: diagnostic.message };
    })
    .sort((a, b) => a.line - b.line || a.column - b.column);
}
