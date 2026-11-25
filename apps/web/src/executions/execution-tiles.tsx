import type { ReactNode } from "react";
import { resultChange, type Execution, type ExecutionResult } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { statusCount } from "../i18n/vocabulary.ts";
import { executionDuration } from "./execution-text.ts";

/** A figure of an execution: what it counts, how much, and what to know of it. */
function Tile({ label, value, note }: { readonly label: string; readonly value: ReactNode; readonly note?: string | undefined }): ReactNode {
  return (
    <div className="exec-tile">
      <dt className="small muted">{label}</dt>
      <dd>
        <b className="exec-figure">{value}</b>
        {note !== undefined && <span className="small muted">{note}</span>}
      </dd>
    </div>
  );
}

/**
 * The figures of an execution: how many tests passed, at once or on a retry, and what part of them, how many failed, were
 * skipped, or were fixed, each with what to know of it, and how long they took together.
 */
export function ExecutionTiles({ execution }: { readonly execution: Execution }): ReactNode {
  const { results } = execution;
  const count = (kept: (result: ExecutionResult) => boolean): number => results.filter(kept).length;
  const flaky = count(({ verdict }) => verdict === "flaky");
  const passed = count(({ verdict }) => verdict === "passed") + flaky;
  const news = count((result) => resultChange(result) === "new_failure");
  const percent = results.length === 0 ? undefined : t("execution.tiles.percent", { percent: Math.round((passed / results.length) * 100) });
  const notes = [percent, flaky === 0 ? undefined : statusCount("flaky", flaky)].filter((part) => part !== undefined);
  return (
    <dl className="exec-tiles">
      <Tile label={t("execution.tiles.passed")} value={passed} note={notes.length === 0 ? undefined : notes.join(" · ")} />
      <Tile
        label={t("execution.tiles.failed")}
        value={count(({ verdict }) => verdict === "failed")}
        note={news === 0 ? undefined : t("execution.tiles.new", { count: news })}
      />
      <Tile label={t("execution.tiles.skipped")} value={count(({ verdict }) => verdict === "skipped")} />
      <Tile label={t("execution.tiles.fixed")} value={count((result) => resultChange(result) === "fixed")} note={t("execution.tiles.fixedNote")} />
      <Tile label={t("execution.tiles.duration")} value={executionDuration(execution)} />
    </dl>
  );
}
