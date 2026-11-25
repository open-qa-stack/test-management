import { useEffect, useRef, type ReactNode } from "react";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import { executionHref } from "./executions-paths.ts";
import { LaunchScreen } from "./launch-screen.tsx";

/** How often the launch that runs is read again, in milliseconds. */
const LAUNCH_PAUSE_MS = 1500;

/**
 * The screen of the execution that runs, in a browser: it follows the launch, then opens, in its place, the execution it kept.
 *
 * @param props - The name of the project.
 * @returns The screen.
 */
export function LaunchPage({ project }: { readonly project: string }): ReactNode {
  const state = usePolled(() => api.launches(), "launches", LAUNCH_PAUSE_MS);
  const campaigns = usePolled(() => api.campaigns(), "campaigns");
  const followed = useRef<string>(undefined);
  const { running, last } = state.value ?? {};
  useEffect(() => {
    if (running !== undefined) followed.current = running.startedAt;
    else if (last?.execution !== undefined && last.startedAt === followed.current) window.location.replace(executionHref(last.execution));
  }, [running, last]);
  return <LaunchScreen project={project} state={state} campaigns={campaigns.value?.items ?? []} />;
}
