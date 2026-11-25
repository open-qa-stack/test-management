import type { ChangeEvent, ReactNode } from "react";
import type { Session } from "@open-qa-stack/domain/sessions";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import { periodStart } from "./execution-period.ts";
import { executionsHref, type ChangedFilter, type ExecutionsFilter } from "./executions-paths.ts";
import { ExecutionsScreen, type ExecutionsControls } from "./executions-screen.tsx";

/** What a list of the filter chose, as the filter of the address; nothing for its first choice, which keeps every one. */
function chosen(event: ChangeEvent<HTMLSelectElement>): string | undefined {
  return event.currentTarget.value === "" ? undefined : event.currentTarget.value;
}

/**
 * The screen of the executions in a browser: it keeps the page the address asks for, and the launch that runs, in step with the instance, the
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
  const { outcome, origin, campaign, period, size } = filter;
  const state = usePolled(
    () =>
      api.executionPage({
        ...(outcome === undefined ? {} : { outcome }),
        ...(origin === undefined ? {} : { origin }),
        ...(campaign === undefined ? {} : { campaign }),
        ...(period === undefined ? {} : { since: periodStart(period, new Date()) }),
        ...(size === undefined ? {} : { limit: Number(size) }),
        ...(before === undefined ? {} : { before }),
      }),
    executionsHref(filter, before),
  );
  // The campaigns name the one an execution was launched for.
  const campaigns = usePolled(() => api.campaigns(), "campaigns");
  const launches = usePolled(() => api.launches(), "launches");
  // A filter chosen opens its first page, and keeps the others.
  const open = (changed: ChangedFilter) => {
    window.location.hash = executionsHref({ ...filter, ...changed });
  };
  // Each list offers the values its filter takes, and none.
  const controls: ExecutionsControls = {
    outcome: (event) => open({ outcome: chosen(event) as ExecutionsFilter["outcome"] }),
    origin: (event) => open({ origin: chosen(event) as ExecutionsFilter["origin"] }),
    campaign: (event) => open({ campaign: chosen(event) }),
    period: (event) => open({ period: chosen(event) as ExecutionsFilter["period"] }),
    size: (event) => open({ size: chosen(event) as ExecutionsFilter["size"] }),
  };
  const running = launches.value?.running;
  return (
    <ExecutionsScreen
      project={project}
      filter={filter}
      sessions={sessions}
      campaigns={campaigns.value?.items ?? []}
      state={state}
      controls={controls}
      {...(running === undefined ? {} : { running })}
      {...(before === undefined ? {} : { before })}
    />
  );
}
