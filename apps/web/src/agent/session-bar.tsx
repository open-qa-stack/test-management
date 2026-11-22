import type { ReactNode } from "react";
import type { Session, TestVerdict } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";

/** The verdicts of the tests of a session, in the order its bar shows them: what passed first, what was not run last, left empty. */
const PARTS: readonly TestVerdict[] = ["passed", "skipped", "blocked", "indeterminate", "failed", "not_run"];

/** The verdicts that call for a look, in the order they are told in words. */
const TROUBLES = ["failed", "blocked", "indeterminate"] as const;

/**
 * What came of the tests of a session, at a glance, as the executions show theirs: a bar of their verdicts, then in words
 * the failures, the tests blocked and those without a verdict, or, when there are none, how many passed out of how many.
 *
 * @returns Nothing for a session without a test yet.
 */
export function SessionBar({ session }: { readonly session: Session }): ReactNode {
  const tests = session.result?.tests ?? [];
  if (tests.length === 0) return undefined;
  const count = (verdict: TestVerdict): number => tests.filter((test) => test.verdict === verdict).length;
  const troubles = TROUBLES.filter((verdict) => count(verdict) > 0);
  return (
    <span className="session-result small">
      <span className="verdict-bar" aria-hidden="true">
        {PARTS.map((verdict) => (
          <span key={verdict} className={`verdict-part ${verdict}`} style={{ flexGrow: count(verdict) }} />
        ))}
      </span>
      {troubles.map((verdict) => (
        <span key={verdict} className={`verdict-words ${verdict}`}>
          {t(`sessionBar.${verdict}`, { count: count(verdict) })}
        </span>
      ))}
      {troubles.length === 0 && <span className="verdict-words passed">{t("facts.testsPassed", { passed: count("passed"), count: tests.length })}</span>}
    </span>
  );
}
