import type { ReactNode } from "react";
import type { QaStep, QaView } from "@open-qa-stack/domain/sessions";
import { elapsedText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { statusName } from "../i18n/vocabulary.ts";
import { hrefTo } from "../routing/route.ts";
import { REPORT_PANEL, TEST_PATH } from "../tests/tests-paths.ts";
import { Icon } from "../ui/icon.tsx";
import { resultHref } from "./executions-paths.ts";

/** A step of a test the report numbers: one the test calls. */
export type NumberedStep = QaStep & { readonly number: number };

/** Where a test ran: the execution, and the path of the test. */
export interface Place {
  readonly id: string;
  readonly path: string;
}

/**
 * The numbered steps of a test: those it calls, in its order.
 *
 * @param view - The test read in steps.
 * @returns Its numbered steps.
 */
export function numbered(view: QaView): readonly NumberedStep[] {
  return view.steps.filter((step): step is NumberedStep => step.number !== undefined);
}

/**
 * Where a test failed, in a sentence: the step and how many it has; how it ended otherwise.
 *
 * @param view - The test read in steps.
 * @returns The sentence.
 */
export function outcomeText(view: QaView): string {
  const count = numbered(view).length;
  return view.failedStep !== undefined ? t("test.summary.failedAt", { step: view.failedStep, count }) : t(`test.summary.${view.status}`, { count });
}

/**
 * The link that reports a defect of a test from its card, whose last run failed.
 *
 * @param path - The path of the test.
 * @returns The fragment to put in an `href`.
 */
export function reportHref(path: string): string {
  return hrefTo(TEST_PATH, { path, panel: REPORT_PANEL });
}

/** What the failed assertion expected and received, side by side, what it received in the tone of the failure; a sentence when its message does not say both. */
export function Comparison({ view }: { readonly view: QaView }): ReactNode {
  if (view.expected === undefined || view.received === undefined) return <p className="small muted run-compare-none">{t("test.noCompare")}</p>;
  return (
    <dl className="run-compare">
      <div className="run-compare-part">
        <dt>{t("test.expected")}</dt>
        <dd className="mono">{view.expected}</dd>
      </div>
      <div className="run-compare-part ko">
        <dt>{t("test.received")}</dt>
        <dd className="mono">{view.received}</dd>
      </div>
    </dl>
  );
}

/** How a step ended, in a few words: failed or passed, how long it took, and for the one that failed what it expected and received. */
function stepFacts(step: NumberedStep, view: QaView): string {
  const failed = step.state === "failed";
  const compared = failed && view.expected !== undefined && view.received !== undefined;
  return [
    statusName(step.state),
    elapsedText(step.duration),
    ...(compared ? [t("test.compared", { expected: view.expected, received: view.received })] : []),
  ].join(" · ");
}

/**
 * The steps of a test as it ran, a row each that shows its page: its state, its title and the steps it holds, then
 * how it ended; the one that failed in the tone of the failure.
 *
 * @param props - The test read in steps, where it ran, and the step shown, if any.
 * @returns The rows.
 */
export function StepRows({ view, place, shown }: { readonly view: QaView; readonly place: Place; readonly shown?: number }): ReactNode {
  return numbered(view).map((step) => {
    const failed = step.state === "failed";
    const on = step.number === shown;
    return (
      <a
        key={step.number}
        className={["test-step", failed ? "failed" : "", on ? "on" : ""].filter((name) => name !== "").join(" ")}
        href={resultHref(place.id, place.path, step.number)}
        aria-current={on ? "step" : undefined}
      >
        <span className={failed ? "test-step-state ko" : "test-step-state ok"} role="img" aria-label={statusName(step.state)}>
          <Icon name={failed ? "close" : "check"} size={12} />
        </span>
        <span className="test-step-text">
          <b>{step.title}</b>
          {step.steps.length > 0 && (
            <ul className="small muted test-substeps">
              {step.steps.map((inner, index) => (
                <li key={index}>{inner.title}</li>
              ))}
            </ul>
          )}
          <span className={failed ? "test-step-facts ko" : "test-step-facts"}>{stepFacts(step, view)}</span>
        </span>
      </a>
    );
  });
}
