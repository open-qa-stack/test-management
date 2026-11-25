import type { ReactNode } from "react";
import type { Session } from "@open-qa-stack/domain/sessions";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import type { ExecutionView } from "./execution-view.ts";
import { useRelaunch } from "../tests/use-relaunch.ts";
import { executionHref } from "./executions-paths.ts";
import { ExecutionScreen, failedPaths } from "./execution-screen.tsx";

/**
 * The screen of an execution in a browser: it keeps the execution in step with the instance, and runs its failures again on demand.
 *
 * @param props - The name of the project, the identifier of the execution, the sessions of the project, and the view and the words the address asks for.
 * @returns The screen.
 */
export function ExecutionPage({
  project,
  id,
  sessions,
  view,
  search,
}: {
  readonly project: string;
  readonly id: string;
  readonly sessions: readonly Session[];
  readonly view?: ExecutionView;
  readonly search?: string;
}): ReactNode {
  const state = usePolled(() => api.execution(id), id);
  const tests = usePolled(() => api.tests(), "tests");
  const campaigns = usePolled(() => api.campaigns(), "campaigns");
  const relaunch = useRelaunch(failedPaths(state.value));
  return (
    <ExecutionScreen
      project={project}
      id={id}
      sessions={sessions}
      state={state}
      relaunch={relaunch.state}
      onRelaunch={relaunch.onLaunch}
      tests={tests.value ?? []}
      campaigns={campaigns.value?.items ?? []}
      onSearch={(event) => {
        event.preventDefault();
        const words = (event.currentTarget.elements.namedItem("q") as HTMLInputElement).value.trim();
        window.location.hash = executionHref(id, view, words);
      }}
      {...(view === undefined ? {} : { view })}
      {...(search === undefined ? {} : { search })}
    />
  );
}
