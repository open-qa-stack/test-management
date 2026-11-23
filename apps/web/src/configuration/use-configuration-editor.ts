import { useEffect, useMemo, useReducer, type Dispatch } from "react";
import { api } from "../api/instance-api.ts";
import { actionOf, pressOf, type FieldKind } from "./configuration-edit.ts";
import type { ConfigurationControls } from "./configuration-screen.tsx";
import {
  configurationAfter,
  INITIAL_CONFIGURATION,
  isChanged,
  typedConnection,
  typedKey,
  type ConfigurationAction,
  type ConfigurationState,
} from "./configuration-state.ts";
import { ConfigurationSync } from "./configuration-sync.ts";
import { valueAt } from "./json-pointer.ts";

/** A draft of the configuration in a browser, kept in step with the instance, and what the person does to it. */
export interface ConfigurationEditor {
  readonly state: ConfigurationState;
  readonly dispatch: Dispatch<ConfigurationAction>;
  readonly sync: ConfigurationSync;
  readonly controls: ConfigurationControls;
}

/**
 * Keeps a draft of the configuration in step with the instance, has it checked as it changes, and gives what the
 * person does to it: change a field, add or remove an item, test the model or a source, save, drop the change, take
 * or write the file.
 *
 * @returns The draft, what changes it, and what the person does to it.
 */
export function useConfigurationEditor(): ConfigurationEditor {
  const [state, dispatch] = useReducer(configurationAfter, INITIAL_CONFIGURATION);
  const sync = useMemo(() => new ConfigurationSync(api, dispatch), []);
  useEffect(() => sync.read(), [sync]);
  const { draft, basedOn, values } = state;
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
      sync.save(changed ? draft : undefined, basedOn, values);
    },
    discard: () => dispatch({ type: "discard" }),
    takeFile: () => sync.takeFile(),
    writeFile: () => sync.writeFile(),
    testModel: () => sync.testModel(draft!.model, typedKey(draft!.model, values)),
    checkSource: ({ currentTarget }) => {
      const rank = Number(currentTarget.dataset["rank"]);
      const source = draft!.knowledge[rank]!;
      sync.checkSource(rank, source, typedConnection(source, values));
    },
    checkAddress: ({ currentTarget }) => {
      const pointer = currentTarget.dataset["pointer"]!;
      // The button is offered for a field that holds an address.
      sync.checkAddress(pointer, valueAt(draft!, pointer) as string);
    },
    setUp: () => sync.setUp(draft!, values),
  };
  return { state, dispatch, sync, controls };
}
