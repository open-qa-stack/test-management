import type { ReactNode } from "react";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import { TraceScreen } from "./trace-screen.tsx";

/**
 * The screen of the trace of a test in an execution, in a browser: it reads once whether the run of the test kept a
 * trace, and keeps it in step with the instance.
 *
 * @param props - The name of the project, the execution and the path of the test.
 * @returns The screen.
 */
export function TracePage({ project, id, path }: { readonly project: string; readonly id: string; readonly path: string }): ReactNode {
  const state = usePolled(() => api.testReading(path, id), `${id}:${path}`);
  return <TraceScreen project={project} id={id} path={path} state={state} />;
}
