import { useCallback, useEffect, useMemo, useReducer, type ReactNode } from "react";
import type { ConfigurationView } from "@open-qa-stack/domain/sessions";
import { api } from "../api/instance-api.ts";
import { useConfigurationEditor } from "../configuration/use-configuration-editor.ts";
import { useItemPages, type ItemList } from "../configuration/use-item-pages.ts";
import { usePanelControls } from "../configuration/use-panel-controls.ts";
import { hrefTo, type Route } from "../routing/route.ts";
import { FILES_INPUT, KnowledgeScreen, sourcePath, type KnowledgeControls } from "./knowledge-screen.tsx";
import { INITIAL_KNOWLEDGE, knowledgeAfter } from "./knowledge-state.ts";
import { KnowledgeSync } from "./knowledge-sync.ts";

/** The sources of the configuration, each with a page of its own under the knowledge. */
const SOURCES: ItemList = {
  items: (document) => document.knowledge,
  without: (document, rank) => ({ ...document, knowledge: document.knowledge.filter((_, index) => index !== rank) }),
  home: "/knowledge",
  pathOf: sourcePath,
};

/**
 * The screens of the knowledge in a browser: they keep the sources and their documents in step with the instance,
 * read the document the address names, upload the files the person chose and remove the document they confirmed,
 * then empty the field of an upload taken, and close the confirmation of a removal taken. A source is added, changed
 * and removed here, each saved as a revision of its own; a change not saved is dropped once the person goes elsewhere.
 *
 * @param props - The name of the project, and where the console is.
 * @returns The screen of the route.
 */
export function KnowledgePage({ project, route }: { readonly project: string; readonly route: Route }): ReactNode {
  const [state, dispatch] = useReducer(knowledgeAfter, INITIAL_KNOWLEDGE);
  const sync = useMemo(() => new KnowledgeSync(api, dispatch), []);
  const editor = useConfigurationEditor();
  useEffect(() => sync.read(), [sync]);
  const [, source] = route.path;
  const { document: reading, remove: asked, add: adding } = route.query;
  useEffect(() => {
    if (source !== undefined && reading !== undefined) sync.open(source, reading);
  }, [sync, source, reading]);
  const { change } = state;
  useEffect(() => {
    if (change?.state !== "done") return;
    if (change.uploaded > 0) (window.document.getElementById(FILES_INPUT) as HTMLInputElement).form!.reset();
    else if (asked !== undefined) window.location.replace(hrefTo(`/knowledge/${change.source}`));
  }, [change, asked]);
  const told = useCallback((view: ConfigurationView) => dispatch({ type: "read", view }), []);
  // The list of the sources shows the revision saved at once, without waiting for the next reading.
  const drop = useItemPages(editor, SOURCES, { id: source, adding: adding !== undefined }, told);
  // The page of a source added moves to the source saved: no panel to close there.
  const edit = usePanelControls(editor.controls, route, editor.state.saved, source !== undefined);
  const controls: KnowledgeControls = {
    upload: (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      // The form holds its field of files, whose list a browser always gives.
      const { files } = form.elements.namedItem("documents") as HTMLInputElement;
      sync.upload(form.dataset["source"]!, [...files!]);
    },
    remove: ({ currentTarget }) => sync.remove(currentTarget.dataset["source"]!, currentTarget.dataset["name"]!),
    remap: ({ currentTarget }) => sync.remap(currentTarget.dataset["source"]),
    edit,
    drop: ({ currentTarget }) => drop(Number(currentTarget.dataset["rank"])),
  };
  return <KnowledgeScreen project={project} route={route} state={state} editing={editor.state} controls={controls} />;
}
