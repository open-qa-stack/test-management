import type { ReactNode } from "react";
import type { LaunchRequest, TestLaunch } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";

/** Where the relaunch of a test stands: the environments it may run against, the launch that runs it, and the request. */
export interface RelaunchState {
  /** The environments the configuration declares: a choice is offered when there are several. */
  readonly environments: readonly string[];
  /** The launch that runs the test now, with how far it went. */
  readonly launch?: TestLaunch;
  /** Whether the launch is asked of the instance. */
  readonly pending: boolean;
  /** Why the instance refused the last one. */
  readonly refusal?: string;
}

/**
 * Runs a test again as it is, with no agent: a button, the environment to run it against when the configuration declares
 * several, and what the launch that runs it says.
 */
export function TestRelaunch({
  state,
  onLaunch,
}: {
  readonly state: RelaunchState;
  readonly onLaunch: (where: Pick<LaunchRequest, "environment">) => void;
}): ReactNode {
  const { environments, launch, pending, refusal } = state;
  const running = launch !== undefined;
  const choose = environments.length > 1;
  const launchIt = (form: HTMLFormElement): void =>
    onLaunch(choose ? { environment: (form.elements.namedItem("environment") as HTMLSelectElement).value } : {});
  return (
    <form
      className="test-relaunch"
      onSubmit={(event) => {
        event.preventDefault();
        launchIt(event.currentTarget);
      }}
    >
      {choose && (
        <label className="small">
          <span className="sr-only">{t("relaunch.environment")}</span>
          <select name="environment" defaultValue={environments[0]} disabled={running || pending}>
            {environments.map((environment) => (
              <option key={environment} value={environment}>
                {environment}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" className="btn" disabled={running || pending}>
        {pending ? t("relaunch.pending") : t("relaunch.button")}
      </button>
      <span className="small" role="status">
        {running
          ? launch.progress?.finished.length === undefined || launch.progress.finished.length === 0
            ? t("relaunch.running")
            : t("relaunch.finished")
          : refusal}
      </span>
    </form>
  );
}
