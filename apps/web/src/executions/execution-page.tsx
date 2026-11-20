import type { ReactNode } from "react";
import type { Session } from "@open-qa-stack/domain/sessions";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import { ExecutionScreen } from "./execution-screen.tsx";

/**
 * The screen of an execution in a browser: it keeps the execution in step with the instance.
 *
 * @param props - The name of the project, the identifier of the execution, and the sessions of the project.
 * @returns The screen.
 */
export function ExecutionPage({ project, id, sessions }: { readonly project: string; readonly id: string; readonly sessions: readonly Session[] }): ReactNode {
  const state = usePolled(() => api.execution(id), id);
  return <ExecutionScreen project={project} id={id} sessions={sessions} state={state} />;
}
