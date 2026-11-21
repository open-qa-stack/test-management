import type { ChangeEvent, ReactNode } from "react";
import type { Session } from "@open-qa-stack/domain/sessions";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import { isExecutionPeriod, periodStart } from "./execution-period.ts";
import { executionsHref, type ExecutionsFilter } from "./executions-paths.ts";
import { ExecutionsScreen, type ExecutionsControls } from "./executions-screen.tsx";

/** What a list of the filter chose, as the filter of the address; nothing for its first choice, which keeps every one. */
function chosen(event: ChangeEvent<HTMLSelectElement>): string | undefined {
  return event.currentTarget.value === "" ? undefined : event.currentTarget.value;
}

/**
 * The screen of the executions in a browser: it keeps the page the address asks for in step with the instance, the
 * period counted back from each reading, and opens the first page of a filter the person chooses.
 *
 * @param props - The name of the project, the filter and the page the address asks for, and the sessions of the project.
 * @returns The screen.
 */
export function ExecutionsPage({
  project,
  filter,
  before,
  sessions,
}: {
  readonly project: string;
  readonly filter: ExecutionsFilter;
  readonly before?: string;
  readonly sessions: readonly Session[];
}): ReactNode {
  const { outcome, period } = filter;
  const state = usePolled(
    () =>
      api.executionPage({
        ...(outcome === undefined ? {} : { outcome }),
        ...(period === undefined ? {} : { since: periodStart(period, new Date()) }),
        ...(before === undefined ? {} : { before }),
      }),
    `${outcome}:${period}:${before}`,
  );
  // The campaigns name the one an execution was launched for.
  const campaigns = usePolled(() => api.campaigns(), "campaigns");
  const open = (next: ExecutionsFilter) => (window.location.hash = executionsHref(next));
  const controls: ExecutionsControls = {
    outcome: (event) => {
      const value = chosen(event);
      open({ ...(value === "failing" || value === "passing" ? { outcome: value } : {}), ...(period === undefined ? {} : { period }) });
    },
    period: (event) => {
      const value = chosen(event);
      open({ ...(outcome === undefined ? {} : { outcome }), ...(isExecutionPeriod(value) ? { period: value } : {}) });
    },
  };
  return (
    <ExecutionsScreen
      project={project}
      filter={filter}
      sessions={sessions}
      campaigns={campaigns.value?.items ?? []}
      state={state}
      controls={controls}
      {...(before === undefined ? {} : { before })}
    />
  );
}
