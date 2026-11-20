import type { ReactNode } from "react";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import { ResultScreen } from "./result-screen.tsx";

/**
 * The screen of what came of a test in an execution, in a browser: it keeps the test in steps in step with the instance.
 *
 * @param props - The name of the project, the execution and the path of the test, and the step whose page the address asks to show.
 * @returns The screen.
 */
export function ResultPage({
  project,
  id,
  path,
  step,
}: {
  readonly project: string;
  readonly id: string;
  readonly path: string;
  readonly step?: number;
}): ReactNode {
  const state = usePolled(() => api.testReading(path, id), `${id}:${path}`);
  return <ResultScreen project={project} id={id} path={path} state={state} {...(step === undefined ? {} : { step })} />;
}
