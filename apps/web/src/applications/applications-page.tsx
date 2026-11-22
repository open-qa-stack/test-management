import { useEffect, type ReactNode } from "react";
import { NEW_ITEMS } from "../configuration/configuration-edit.ts";
import { useConfigurationEditor } from "../configuration/use-configuration-editor.ts";
import { useItemPages, type ItemList } from "../configuration/use-item-pages.ts";
import { usePanelControls } from "../configuration/use-panel-controls.ts";
import type { Route } from "../routing/route.ts";
import { APPLICATIONS, applicationPath, applicationsOf } from "./application-paths.ts";
import { ApplicationsScreen } from "./applications-screen.tsx";

/** The applications of the configuration, each with a page of its own. */
const APPLICATION_LIST: ItemList = {
  items: applicationsOf,
  without: (document, rank) => ({ ...document, applications: document.applications.filter((_, index) => index !== rank) }),
  home: APPLICATIONS,
  pathOf: applicationPath,
};

/**
 * The screens of the applications in a browser: they keep the configuration in step with the instance; an
 * application is added, changed and removed on a page of its own, each saved as a revision of its own.
 *
 * @param props - The name of the project, where the console is, and what is told once a change became the revision in force.
 * @returns The screen of the route.
 */
export function ApplicationsPage({ project, route, onSaved }: { readonly project: string; readonly route: Route; readonly onSaved?: () => void }): ReactNode {
  const editor = useConfigurationEditor();
  const { state, dispatch, controls } = editor;
  const { draft, saved } = state;
  useEffect(() => {
    if (saved !== undefined) onSaved?.();
  }, [saved, onSaved]);
  const [, id] = route.path;
  const adding = id === undefined && route.query["add"] !== undefined;
  const drop = useItemPages(editor, APPLICATION_LIST, { id, adding });
  // The page that adds an application adds it to the draft as soon as there is one: the person fills it in at once.
  const inForce = state.view?.revision?.document.applications.length;
  const added = draft !== undefined && inForce !== undefined && draft.applications.length > inForce;
  useEffect(() => {
    if (adding && inForce !== undefined && !added) dispatch({ type: "add", pointer: "/applications", item: NEW_ITEMS.application });
  }, [dispatch, adding, inForce, added]);
  // The page of an application added moves to the application saved: no panel to close there.
  const edit = usePanelControls(controls, route, saved, id !== undefined);
  return (
    <ApplicationsScreen
      project={project}
      route={route}
      state={state}
      controls={{ edit, drop: ({ currentTarget }) => drop(Number(currentTarget.dataset["rank"])) }}
    />
  );
}
