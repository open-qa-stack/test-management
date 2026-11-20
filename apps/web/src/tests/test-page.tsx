import type { ReactNode } from "react";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import { TestScreen } from "./test-screen.tsx";

/**
 * The card of a test in a browser: it keeps the test, its executions and its versions in step with the instance.
 *
 * @param props - The name of the project, and the path of the test.
 * @returns The screen.
 */
export function TestPage({ project, path }: { readonly project: string; readonly path: string }): ReactNode {
  const tests = usePolled(() => api.tests(), "tests");
  const executions = usePolled(() => api.testExecutions(path), path);
  const versions = usePolled(() => api.testVersions(path), `${path} versions`);
  return <TestScreen project={project} path={path} tests={tests} executions={executions} versions={versions} />;
}
