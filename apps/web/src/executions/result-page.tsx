import { useEffect, useRef, type ReactNode } from "react";
import { api } from "../api/instance-api.ts";
import { usePolled } from "../api/use-polled.ts";
import { hearShortcuts } from "../ui/shortcuts.ts";
import { resultHref } from "./executions-paths.ts";
import { ResultScreen, stepBeside } from "./result-screen.tsx";

/**
 * The screen of what came of a test in an execution, in a browser: it keeps the test in steps in step with the instance, and
 * goes from a step to the next with the arrows of the keyboard.
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
  const view = state.value?.view;
  const moved = useRef(false);
  useEffect(() => {
    if (view === undefined) return undefined;
    const go = (by: -1 | 1): void => {
      const next = stepBeside(view, step, by);
      if (next === undefined) return;
      moved.current = true;
      // The steps gone through leave one entry of the history: Back leaves the test.
      window.location.replace(resultHref(id, path, next));
    };
    return hearShortcuts(document, { ArrowLeft: () => go(-1), ArrowRight: () => go(1) });
  }, [view, step, id, path]);
  useEffect(() => {
    // The step an arrow went to takes the focus, so that a screen reader says it and it is in sight.
    if (moved.current) document.querySelector<HTMLElement>(".test-step.on")?.focus();
    moved.current = false;
  }, [step]);
  return <ResultScreen project={project} id={id} path={path} state={state} {...(step === undefined ? {} : { step })} />;
}
