import { useEffect, useState, type ReactNode } from "react";
import type { LaunchRequest, RepositoryTest, TestEdit } from "@open-qa-stack/domain/sessions";
import type { ApiError } from "../api/api-error.ts";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import { scopeChoicesOf } from "../agent/scope-choices.ts";
import { withPanel, type Route } from "../routing/route.ts";
import { TestScreen } from "./test-screen.tsx";

/** How often the launch that runs is read again, in milliseconds. */
const LAUNCH_PAUSE_MS = 1500;

/**
 * The card of a test of the repository, read again at the pace of the console, which runs it again on demand, and
 * changes its title or a step: once saved, the panel closes and the test and its file are read again at once.
 */
export function TestPage({ project, path, route }: { readonly project: string; readonly path: string; readonly route: Route }): ReactNode {
  const launches = usePolled(() => api.launches(), "launches", LAUNCH_PAUSE_MS);
  const ended = launches.value?.last?.endedAt;
  const [changes, setChanges] = useState(0);
  const [saving, setSaving] = useState<{ readonly pending: boolean; readonly refusal?: string }>({ pending: false });
  const tests = usePolled(() => api.tests(), `tests:${changes}`);
  const source = usePolled(() => api.testSource(path), `${path} source:${changes}`);
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
  const onChange = (test: RepositoryTest, change: TestEdit): void => {
    setSaving({ pending: true });
    api.changeTest({ path, title: test.title, change }).then(
      () => {
        setSaving({ pending: false });
        setChanges((count) => count + 1);
        window.location.hash = withPanel(route);
      },
      (error: ApiError) => setSaving({ pending: false, refusal: error.message }),
    );
  };
  return (
    <TestScreen
      project={project}
      path={path}
      route={route}
      tests={tests}
      executions={executions}
      versions={versions}
      source={source}
      saving={saving}
      onChange={onChange}
      relaunch={{ environments, ...asked, ...(launch === undefined ? {} : { launch }) }}
      onRelaunch={onRelaunch}
    />
  );
}
