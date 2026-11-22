import { useEffect, useState, type ReactNode } from "react";
import { locale } from "../i18n/i18n.ts";
import type { Route } from "../routing/route.ts";
import { applicationPath, applicationsOf, CONFIGURATION } from "./application-paths.ts";
import { ApplicationScreen } from "./application-screen.tsx";
import { NEW_ITEMS } from "./configuration-edit.ts";
import { ConfigurationScreen } from "./configuration-screen.tsx";
import { FIRST_DRAFT, FIRST_USE_STEPS, FirstUse } from "./first-use.tsx";
import { useConfigurationEditor } from "./use-configuration-editor.ts";
import { useItemPages, type ItemList } from "./use-item-pages.ts";

/** The applications of the configuration, each with a page of its own under the configuration. */
const APPLICATION_LIST: ItemList = {
  items: applicationsOf,
  without: (document, rank) => ({ ...document, applications: document.applications.filter((_, index) => index !== rank) }),
  home: CONFIGURATION,
  pathOf: applicationPath,
};

/**
 * The screens of the configuration in a browser: they keep the configuration in step with the instance, apply what
 * the person changes, have each draft checked as it changes, and save it, or take the file, when asked, then say so.
 * An application is added, changed and removed on a page of its own, each saved as a revision of its own. An instance
 * that has no configuration yet is set up step by step, from a first draft.
 *
 * @param props - The name of the project, where the console is, and what is told once a change, or the file, became the revision in force.
 * @returns The screen of the route.
 */
export function ConfigurationPage({ project, route, onSaved }: { readonly project: string; readonly route: Route; readonly onSaved?: () => void }): ReactNode {
  const editor = useConfigurationEditor();
  const { state, dispatch, sync, controls } = editor;
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
  const [, part, id] = route.path;
  const applications = part === "applications";
  const adding = applications && id === undefined;
  const drop = useItemPages(editor, APPLICATION_LIST, { id, adding });
  // The page that adds an application adds it to the draft as soon as there is one: the person fills it in at once.
  const inForce = state.view?.revision?.document.applications.length;
  const added = draft !== undefined && inForce !== undefined && draft.applications.length > inForce;
  useEffect(() => {
    if (adding && inForce !== undefined && !added) dispatch({ type: "add", pointer: "/applications", item: NEW_ITEMS.application });
  }, [dispatch, adding, inForce, added]);
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
  if (applications)
    return (
      <ApplicationScreen
        project={project}
        route={route}
        state={state}
        controls={{ edit: controls, drop: ({ currentTarget }) => drop(Number(currentTarget.dataset["rank"])) }}
      />
    );
  return <ConfigurationScreen project={project} state={state} controls={controls} />;
}
