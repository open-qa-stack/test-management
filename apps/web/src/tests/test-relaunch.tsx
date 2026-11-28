import type { ReactNode } from "react";
import type { EndedLaunch, LaunchRequest, TestLaunch } from "@open-qa-stack/domain/sessions";
import { executionHref } from "../executions/executions-paths.ts";
import { t } from "../i18n/i18n.ts";

/** Where the relaunch of a test stands: the environments it may run against, the launch that runs it, and the request. */
export interface RelaunchState {
  /** The environments the configuration declares: a choice is offered when there are several. */
  readonly environments: readonly string[];
  /** The launch that runs the test now, with how far it went. */
  readonly launch?: TestLaunch;
  /** The launch asked here, once it ended: the execution it kept, or why it kept none. */
  readonly ended?: Pick<EndedLaunch, "execution" | "failure">;
  /** Whether the launch is asked of the instance. */
  readonly pending: boolean;
  /** Why the instance refused the last one. */
  readonly refusal?: string;
}

/** What the last relaunch came to: the way to its execution, or why it kept none. */
function Ended({ ended }: { readonly ended: NonNullable<RelaunchState["ended"]> }): ReactNode {
  return ended.execution === undefined ? (ended.failure ?? null) : <a href={executionHref(ended.execution)}>{t("relaunch.see")} →</a>;
}

/**
 * Runs a test again as it is, or several, with no agent: a button, the environment to run it against when the configuration declares
 * several, and what the launch that runs it says.
 */
export function TestRelaunch({
  state,
  onLaunch,
  several,
}: {
  readonly state: RelaunchState;
  readonly onLaunch: (where: Pick<LaunchRequest, "environment">) => void;
  /** What the button says when it runs several tests again, and what that takes; that of one test, which the key R presses, by default. */
  readonly several?: { readonly label: string; readonly note: string };
}): ReactNode {
  const { environments, launch, ended, pending, refusal } = state;
  const button = several === undefined ? { "aria-keyshortcuts": "R", title: t("relaunch.key") } : { title: several.note };
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
      <button type="submit" className={several === undefined ? "btn" : "btn primary"} {...button} disabled={running || pending}>
        {pending ? t("relaunch.pending") : (several?.label ?? t("relaunch.button"))}
      </button>
      <span className="small" role="status">
        {running
          ? launch.progress?.finished.length === undefined || launch.progress.finished.length === 0
            ? t("relaunch.running")
            : t(several === undefined ? "relaunch.finished" : "relaunch.finishedSome", { count: launch.progress.finished.length })
          : (refusal ?? (ended !== undefined && <Ended ended={ended} />))}
      </span>
    </form>
  );
}
