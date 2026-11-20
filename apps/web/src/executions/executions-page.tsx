import type { ReactNode } from "react";
import type { ExecutionOutcome, Session } from "@open-qa-stack/domain/sessions";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import { ExecutionsScreen } from "./executions-screen.tsx";

/**
 * The screen of the executions in a browser: it keeps the page the address asks for in step with the instance.
 *
 * @param props - The name of the project, the outcome and the page the address asks for, and the sessions of the project.
 * @returns The screen.
 */
export function ExecutionsPage({
  project,
  outcome,
  before,
  sessions,
}: {
  readonly project: string;
  readonly outcome?: ExecutionOutcome;
  readonly before?: string;
  readonly sessions: readonly Session[];
}): ReactNode {
  const state = usePolled(() => api.executionPage(outcome, before), `${outcome}:${before}`);
  return (
    <ExecutionsScreen
      project={project}
      sessions={sessions}
      state={state}
      {...(outcome === undefined ? {} : { outcome })}
      {...(before === undefined ? {} : { before })}
    />
  );
}
