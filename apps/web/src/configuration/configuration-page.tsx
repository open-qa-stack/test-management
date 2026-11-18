import { useEffect, useMemo, useReducer, type ReactNode } from "react";
import { api } from "../api/instance-api.ts";
import { actionOf, pressOf, type FieldKind } from "./configuration-edit.ts";
import { ConfigurationScreen, type ConfigurationControls } from "./configuration-screen.tsx";
import { configurationAfter, INITIAL_CONFIGURATION, isChanged } from "./configuration-state.ts";
import { ConfigurationSync } from "./configuration-sync.ts";

/**
 * The screen of the configuration in a browser: it keeps the configuration in step with the instance, applies
 * what the person changes, has each draft checked as it changes, and saves it, or takes the file, when asked, then
 * says so.
 *
 * @param props - The name of the project, and what is told once a change, or the file, became the revision in force.
 * @returns The screen.
 */
export function ConfigurationPage({ project, onSaved }: { readonly project: string; readonly onSaved?: () => void }): ReactNode {
  const [state, dispatch] = useReducer(configurationAfter, INITIAL_CONFIGURATION);
  const sync = useMemo(() => new ConfigurationSync(api, dispatch), []);
  useEffect(() => sync.read(), [sync]);
  const { draft, basedOn, saved } = state;
  useEffect(() => {
    if (saved !== undefined) onSaved?.();
  }, [saved, onSaved]);
  const changed = isChanged(state);
  useEffect(() => {
    if (changed && draft !== undefined) sync.check(draft);
  }, [sync, draft, changed]);
  const controls: ConfigurationControls = {
    change: ({ currentTarget }) => {
      const { name, value, dataset } = currentTarget;
      const checked = currentTarget instanceof HTMLInputElement && currentTarget.checked;
      const { member, defaults } = dataset;
      dispatch(
        actionOf({
          name,
          value,
          checked,
          kind: dataset["kind"] as FieldKind,
          ...(member === undefined ? {} : { member }),
          ...(defaults === undefined ? {} : { defaults }),
        }),
      );
    },
    click: ({ currentTarget }) => {
      const action = pressOf(currentTarget.dataset);
      if (action !== undefined) dispatch(action);
    },
    save: (event) => {
      event.preventDefault();
      // The form is drawn once there is a draft.
      sync.save(draft!, basedOn, false);
    },
    discard: () => dispatch({ type: "discard" }),
    keepFile: () => sync.keepFile(),
    keepChange: () => sync.save(draft!, basedOn, true),
  };
  return <ConfigurationScreen project={project} state={state} controls={controls} />;
}
