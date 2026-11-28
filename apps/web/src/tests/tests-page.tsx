import { useEffect, useMemo, useReducer, type ReactNode } from "react";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import type { Route } from "../routing/route.ts";
import { testsHref, TestsScreen, verdictOf, type TestsControls } from "./tests-screen.tsx";
import { INITIAL_TESTS, testsAfter } from "./tests-state.ts";
import { TestsSync } from "./tests-sync.ts";
import { useRelaunch } from "./use-relaunch.ts";

/**
 * The screen of the tests in a browser: it keeps the tests of the repository and what came of each last in step with
 * the instance, narrows them to the words the person searched, which it writes in the address, keeping the other
 * filters, and runs the files of the tests that failed again.
 *
 * @param props - The name of the project, and where the console is.
 * @returns The screen.
 */
export function TestsPage({ project, route }: { readonly project: string; readonly route: Route }): ReactNode {
  const [state, dispatch] = useReducer(testsAfter, INITIAL_TESTS);
  const sync = useMemo(() => new TestsSync(api, dispatch), []);
  useEffect(() => sync.read(), [sync]);
  const verdicts = usePolled(() => api.testVerdicts(), "verdicts").value ?? [];
  const failing = [...new Set((state.tests ?? []).filter((test) => verdictOf(test, verdicts) === "failed").map((test) => test.path))];
  const relaunch = useRelaunch(failing);
  const controls: TestsControls = {
    search: (event) => {
      event.preventDefault();
      const words = (event.currentTarget.elements.namedItem("q") as HTMLInputElement).value.trim();
      window.location.hash = testsHref({ level: route.query["level"], outcome: route.query["outcome"], search: words });
    },
  };
  return (
    <TestsScreen
      project={project}
      route={route}
      state={state}
      controls={controls}
      verdicts={verdicts}
      relaunch={relaunch.state}
      onRelaunch={relaunch.onLaunch}
    />
  );
}
