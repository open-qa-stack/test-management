import { useEffect, useState, type ReactNode } from "react";
import { locale } from "../i18n/i18n.ts";
import { ConfigurationScreen } from "./configuration-screen.tsx";
import { FIRST_DRAFT, FIRST_USE_STEPS, FirstUse } from "./first-use.tsx";
import { useConfigurationEditor } from "./use-configuration-editor.ts";

/**
 * The screen of the configuration in a browser: it keeps the configuration in step with the instance, applies
 * what the person changes, has each draft checked as it changes, and saves it, or takes the file, when asked, then
 * says so. An instance that has no configuration yet is set up step by step, from a first draft.
 *
 * @param props - The name of the project, and what is told once a change, or the file, became the revision in force.
 * @returns The screen.
 */
export function ConfigurationPage({ project, onSaved }: { readonly project: string; readonly onSaved?: () => void }): ReactNode {
  const { state, dispatch, sync, controls } = useConfigurationEditor();
  const [step, setStep] = useState(0);
  const { draft, saved } = state;
  useEffect(() => {
    if (saved !== undefined) onSaved?.();
  }, [saved, onSaved]);
  // An instance with neither a revision nor a file starts from a first draft, which the setting up shows.
  const unset = state.view !== undefined && state.view.revision === undefined && state.view.file === "missing";
  useEffect(() => {
    // The configuration speaks the language the person sets it up in, which the console keeps speaking afterwards.
    if (unset) dispatch({ type: "begin", document: { ...FIRST_DRAFT, language: locale() } });
  }, [dispatch, unset]);
  useEffect(() => {
    if (unset) sync.readRepository();
  }, [sync, unset]);
  if (state.view?.revision === undefined && draft !== undefined)
    return (
      <FirstUse
        project={project}
        state={state}
        controls={controls}
        step={FIRST_USE_STEPS[step]!}
        onBack={() => setStep(step - 1)}
        onNext={() => setStep(step + 1)}
      />
    );
  return <ConfigurationScreen project={project} state={state} controls={controls} />;
}
