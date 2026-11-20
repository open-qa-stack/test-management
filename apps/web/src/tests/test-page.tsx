import { useEffect, useState, type ReactNode } from "react";
import type { LaunchRequest } from "@open-qa-stack/domain/sessions";
import type { ApiError } from "../api/api-error.ts";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import { scopeChoicesOf } from "../agent/scope-choices.ts";
import { TestScreen } from "./test-screen.tsx";

/** How often the launch that runs is read again, in milliseconds. */
const LAUNCH_PAUSE_MS = 1500;

/** The card of a test of the repository, read again at the pace of the console, which runs it again on demand. */
export function TestPage({ project, path }: { readonly project: string; readonly path: string }): ReactNode {
  const launches = usePolled(() => api.launches(), "launches", LAUNCH_PAUSE_MS);
  const ended = launches.value?.last?.endedAt;
  const tests = usePolled(() => api.tests(), "tests");
  // The executions are read again as each launch ends, which brings the one of a relaunch.
  const executions = usePolled(() => api.testExecutions(path), `${path}:${ended}`);
  const versions = usePolled(() => api.testVersions(path), `${path} versions:${ended}`);
  const [environments, setEnvironments] = useState<readonly string[]>([]);
  const [asked, setAsked] = useState<{ readonly pending: boolean; readonly refusal?: string }>({ pending: false });
  useEffect(() => {
    void api.configuration().then(
      (view) => setEnvironments(scopeChoicesOf(view, []).environments),
      () => setEnvironments([]),
    );
  }, []);
  const running = launches.value?.running;
  const launch = running?.paths.includes(path) === true ? running : undefined;
  const onRelaunch = (where: Pick<LaunchRequest, "environment">): void => {
    setAsked({ pending: true });
    api.launch({ paths: [path], ...where }).then(
      () => setAsked({ pending: false }),
      (error: ApiError) => setAsked({ pending: false, refusal: error.message }),
    );
  };
  return (
    <TestScreen
      project={project}
      path={path}
      tests={tests}
      executions={executions}
      versions={versions}
      relaunch={{ environments, ...asked, ...(launch === undefined ? {} : { launch }) }}
      onRelaunch={onRelaunch}
    />
  );
}
