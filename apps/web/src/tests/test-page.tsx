import { useEffect, useMemo, useReducer, type ReactNode } from "react";
import { api } from "../api/instance-api.ts";
import { TestScreen } from "./test-screen.tsx";
import { INITIAL_TEST, testAfter } from "./test-state.ts";
import { TestSync } from "./test-sync.ts";

/**
 * The screen of a test in a browser: it keeps the test in steps in step with the instance, again for each path.
 *
 * @param props - The name of the project, and the path of the test.
 * @returns The screen.
 */
export function TestPage({ project, path }: { readonly project: string; readonly path: string }): ReactNode {
  const [state, dispatch] = useReducer(testAfter, INITIAL_TEST);
  const sync = useMemo(() => new TestSync(api, dispatch), []);
  useEffect(() => sync.read(path), [sync, path]);
  return <TestScreen project={project} path={path} state={state} />;
}
