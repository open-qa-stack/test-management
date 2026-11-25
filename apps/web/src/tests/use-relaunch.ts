import { useEffect, useState } from "react";
import type { LaunchRequest } from "@open-qa-stack/domain/sessions";
import type { ApiError } from "../api/api-error.ts";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import { scopeChoicesOf } from "../agent/scope-choices.ts";
import type { RelaunchState } from "./test-relaunch.tsx";

/** How often the launch that runs is read again, in milliseconds. */
const LAUNCH_PAUSE_MS = 1500;

/** The relaunch of files of tests, as a page offers it. */
export interface Relaunch {
  readonly state: RelaunchState;
  /** When the last launch of the instance ended, whatever it ran: what it brought is read again then. */
  readonly endedAt: string | undefined;
  /** Runs the files again. */
  readonly onLaunch: (where: Pick<LaunchRequest, "environment">) => void;
}

/**
 * Runs files of tests again as they are, and follows the launch that runs them to what it kept.
 *
 * @param paths - The files, relative to the root of the test repository.
 * @returns Where the relaunch stands, and what asks for it.
 */
export function useRelaunch(paths: readonly string[]): Relaunch {
  const launches = usePolled(() => api.launches(), "launches", LAUNCH_PAUSE_MS);
  const [environments, setEnvironments] = useState<readonly string[]>([]);
  const [asked, setAsked] = useState<{ readonly pending: boolean; readonly refusal?: string; readonly startedAt?: string }>({ pending: false });
  useEffect(() => {
    void api.configuration().then(
      (view) => setEnvironments(scopeChoicesOf(view, []).environments),
      () => setEnvironments([]),
    );
  }, []);
  const { startedAt, ...request } = asked;
  const { running, last } = launches.value ?? {};
  const launch = running !== undefined && paths.length > 0 && paths.every((path) => running.paths.includes(path)) ? running : undefined;
  const ended = last !== undefined && last.startedAt === startedAt ? last : undefined;
  const onLaunch = (where: Pick<LaunchRequest, "environment">): void => {
    setAsked({ pending: true });
    api.launch({ paths, ...where }).then(
      (started) => setAsked({ pending: false, startedAt: started.startedAt }),
      (error: ApiError) => setAsked({ pending: false, refusal: error.message }),
    );
  };
  return {
    state: { environments, ...request, ...(launch === undefined ? {} : { launch }), ...(ended === undefined ? {} : { ended }) },
    endedAt: last?.endedAt,
    onLaunch,
  };
}
