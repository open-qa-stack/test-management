import { useEffect, useMemo, useReducer, type ReactNode } from "react";
import { api } from "../api/instance-api.ts";
import type { Route } from "../routing/route.ts";
import { levelHref, TestsScreen, type TestsControls } from "./tests-screen.tsx";
import { INITIAL_TESTS, testsAfter } from "./tests-state.ts";
import { TestsSync } from "./tests-sync.ts";

/**
 * The screen of the tests in a browser: it keeps the tests of the repository in step with the instance, and narrows
 * them to the words the person searched, which it writes in the address, keeping the level.
 *
 * @param props - The name of the project, and where the console is.
 * @returns The screen.
 */
export function TestsPage({ project, route }: { readonly project: string; readonly route: Route }): ReactNode {
  const [state, dispatch] = useReducer(testsAfter, INITIAL_TESTS);
  const sync = useMemo(() => new TestsSync(api, dispatch), []);
  useEffect(() => sync.read(), [sync]);
  const controls: TestsControls = {
    search: (event) => {
      event.preventDefault();
      const words = (event.currentTarget.elements.namedItem("q") as HTMLInputElement).value.trim();
      window.location.hash = levelHref(route.query["level"], words);
    },
  };
  return <TestsScreen project={project} route={route} state={state} controls={controls} />;
}
