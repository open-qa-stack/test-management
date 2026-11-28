import { useState, type ReactNode } from "react";
import type { DefectStatus } from "@open-qa-stack/domain/sessions";
import type { ApiError } from "../api/api-error.ts";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import type { Route } from "../routing/route.ts";
import { defectViewOf } from "./defects-paths.ts";
import { failingTests } from "../tests/failing-tests.ts";
import { DefectsScreen, type FailingTests } from "./defects-screen.tsx";

/**
 * The screen of the defects in a browser: it keeps them in step with the instance, and moves one as the person asks,
 * reading them again once it is moved.
 *
 * @param props - The name of the project, and where the console is.
 * @returns The screen.
 */
export function DefectsPage({ project, route }: { readonly project: string; readonly route: Route }): ReactNode {
  const [changed, setChanged] = useState(0);
  const [moving, setMoving] = useState<{ readonly pending?: string; readonly refusal?: string }>({});
  const defects = usePolled(() => api.defects(), `defects:${changed}`);
  // The tests a defect is reported from: those that failed the last time they ran, as of the latest execution.
  const failing = usePolled(async (): Promise<FailingTests | undefined> => {
    const [verdicts, page] = await Promise.all([api.testVerdicts(), api.executionPage({ limit: 1 })]);
    const count = failingTests(verdicts);
    const latest = page.items[0];
    return count === 0 || latest === undefined ? undefined : { count, ranAt: latest.ranAt };
  }, "defects-failing");
  const change = (id: string, status: DefectStatus): void => {
    setMoving({ pending: id });
    api.changeDefect(id, status).then(
      () => {
        setMoving({});
        setChanged((count) => count + 1);
      },
      (error: ApiError) => setMoving({ refusal: error.message }),
    );
  };
  return (
    <DefectsScreen
      project={project}
      view={defectViewOf(route)}
      defects={defects}
      controls={{ change, ...moving }}
      {...(failing.value === undefined ? {} : { failing: failing.value })}
    />
  );
}
