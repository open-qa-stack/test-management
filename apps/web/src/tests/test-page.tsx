import { useEffect, useState, type FormEventHandler, type ReactNode } from "react";
import { defectReportOf, type RepositoryTest, type TestEdit } from "@open-qa-stack/domain/sessions";
import { defectsHref } from "../defects/defects-paths.ts";
import { t } from "../i18n/i18n.ts";
import type { ApiError } from "../api/api-error.ts";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import { withPanel, type Route } from "../routing/route.ts";
import { hearShortcuts } from "../ui/shortcuts.ts";
import { useRelaunch } from "./use-relaunch.ts";
import { TestScreen } from "./test-screen.tsx";

/**
 * The card of a test of the repository, read again at the pace of the console, which runs it again on demand — its
 * button, or the key R —, and changes its title or a step: once saved, the panel closes and the test and its file are read again at once.
 */
export function TestPage({ project, path, route }: { readonly project: string; readonly path: string; readonly route: Route }): ReactNode {
  const relaunch = useRelaunch([path]);
  const ended = relaunch.endedAt;
  const [changes, setChanges] = useState(0);
  const [saving, setSaving] = useState<{ readonly pending: boolean; readonly refusal?: string }>({ pending: false });
  const [reporting, setReporting] = useState<{ readonly pending: boolean; readonly refusal?: string }>({ pending: false });
  const tests = usePolled(() => api.tests(), `tests:${changes}`);
  const source = usePolled(() => api.testSource(path), `${path} source:${changes}`);
  // The executions are read again as each launch ends, which brings the one of a relaunch.
  const executions = usePolled(() => api.testExecutions(path), `${path}:${ended}`);
  const verdicts = usePolled(() => api.testVerdicts(), `verdicts:${ended}`);
  const versions = usePolled(() => api.testVersions(path), `${path} versions:${ended}`);
  // The key presses the button, against the environment chosen: a button that waits takes neither.
  useEffect(() => hearShortcuts(document, { r: () => document.querySelector<HTMLElement>(".test-relaunch button")?.click() }), []);
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
  // A defect reported is kept by the instance, which lists it with the others.
  const onReport: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const test = tests.value?.find((candidate) => candidate.path === path);
    const report = defectReportOf({
      title: form.get("title"),
      severity: form.get("severity"),
      description: form.get("description"),
      execution: form.get("execution"),
      test: { path, title: test?.title },
    });
    if (typeof report === "string") return setReporting({ pending: false, refusal: t("defects.report.incomplete") });
    setReporting({ pending: true });
    api.reportDefect(report).then(
      () => {
        setReporting({ pending: false });
        window.location.hash = defectsHref();
      },
      (error: ApiError) => setReporting({ pending: false, refusal: error.message }),
    );
  };
  return (
    <TestScreen
      project={project}
      path={path}
      route={route}
      tests={tests}
      executions={executions}
      verdicts={verdicts.value ?? []}
      versions={versions}
      source={source}
      saving={saving}
      onChange={onChange}
      relaunch={relaunch.state}
      onRelaunch={relaunch.onLaunch}
      reporting={reporting}
      onReport={onReport}
    />
  );
}
