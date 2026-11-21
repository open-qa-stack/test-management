import { useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import { api } from "../api/instance-api.ts";
import { actionOf, pressOf, type FieldKind } from "./configuration-edit.ts";
import { ConfigurationScreen, type ConfigurationControls } from "./configuration-screen.tsx";
import { configurationAfter, INITIAL_CONFIGURATION, isChanged, typedKey } from "./configuration-state.ts";
import { ConfigurationSync } from "./configuration-sync.ts";
import { FIRST_DRAFT, FIRST_USE_STEPS, FirstUse } from "./first-use.tsx";
import { locale } from "../i18n/i18n.ts";

/**
 * The screen of the configuration in a browser: it keeps the configuration in step with the instance, applies
 * what the person changes, has each draft checked as it changes, and saves it, or takes the file, when asked, then
 * says so. An instance that has no configuration yet is set up step by step, from a first draft.
 *
 * @param props - The name of the project, and what is told once a change, or the file, became the revision in force.
 * @returns The screen.
 */
export function ConfigurationPage({ project, onSaved }: { readonly project: string; readonly onSaved?: () => void }): ReactNode {
  const [state, dispatch] = useReducer(configurationAfter, INITIAL_CONFIGURATION);
  const [step, setStep] = useState(0);
  const sync = useMemo(() => new ConfigurationSync(api, dispatch), []);
  useEffect(() => sync.read(), [sync]);
  const { draft, basedOn, saved, values } = state;
  useEffect(() => {
    if (saved !== undefined) onSaved?.();
  }, [saved, onSaved]);
  // An instance with neither a revision nor a file starts from a first draft, which the setting up shows.
  const unset = state.view !== undefined && state.view.revision === undefined && state.view.file === "missing";
  useEffect(() => {
    // The configuration speaks the language the person sets it up in, which the console keeps speaking afterwards.
    if (unset) dispatch({ type: "begin", document: { ...FIRST_DRAFT, language: locale() } });
  }, [unset]);
  useEffect(() => {
    if (unset) sync.readRepository();
  }, [sync, unset]);
  const changed = isChanged(state);
  useEffect(() => {
    if (changed && draft !== undefined) sync.check(draft);
  }, [sync, draft, changed]);
  const controls: ConfigurationControls = {
    change: ({ currentTarget }) => {
      const { name, value, dataset } = currentTarget;
      const checked = currentTarget instanceof HTMLInputElement && currentTarget.checked;
      const { member, defaults, variable } = dataset;
      dispatch(
        actionOf({
          name,
          value,
          checked,
          kind: dataset["kind"] as FieldKind,
          ...(member === undefined ? {} : { member }),
          ...(defaults === undefined ? {} : { defaults }),
          ...(variable === undefined ? {} : { variable }),
        }),
      );
    },
    click: ({ currentTarget }) => {
      const action = pressOf(currentTarget.dataset);
      if (action !== undefined) dispatch(action);
    },
    save: (event) => {
      event.preventDefault();
      // The form is drawn once there is a draft; a draft that did not change leaves the values typed alone to save.
      sync.save(changed ? draft : undefined, basedOn, false, values);
    },
    discard: () => dispatch({ type: "discard" }),
    keepFile: () => sync.keepFile(),
    keepChange: () => sync.save(draft!, basedOn, true, values),
    testModel: () => sync.testModel(draft!.model, typedKey(draft!.model, values)),
    setUp: () => sync.setUp(draft!, values),
  };
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
