import { useEffect, useMemo, useReducer, type ReactNode } from "react";
import { api } from "../api/instance-api.ts";
import { ExecutionsScreen } from "./executions-screen.tsx";
import { executionsAfter, INITIAL_EXECUTIONS } from "./executions-state.ts";
import { ExecutionsSync } from "./executions-sync.ts";

/**
 * The screen of the executions in a browser: it keeps the executions of tests in step with the instance.
 *
 * @param props - The name of the project.
 * @returns The screen.
 */
export function ExecutionsPage({ project }: { readonly project: string }): ReactNode {
  const [state, dispatch] = useReducer(executionsAfter, INITIAL_EXECUTIONS);
  const sync = useMemo(() => new ExecutionsSync(api, dispatch), []);
  useEffect(() => sync.read(), [sync]);
  return <ExecutionsScreen project={project} state={state} />;
}
