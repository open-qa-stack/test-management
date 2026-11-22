import { useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { api } from "../api/instance-api.ts";
import { useConfigurationEditor } from "../configuration/use-configuration-editor.ts";
import { hrefTo, type Route } from "../routing/route.ts";
import { FILES_INPUT, KnowledgeScreen, rankOf, sourcePath, type KnowledgeControls } from "./knowledge-screen.tsx";
import { INITIAL_KNOWLEDGE, knowledgeAfter } from "./knowledge-state.ts";
import { KnowledgeSync } from "./knowledge-sync.ts";

/** The address of the knowledge. */
const KNOWLEDGE = "/knowledge";

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
  const { dispatch: edit, state: editing } = editor;
  // A change of a source not saved is dropped once the person goes to another screen of the knowledge.
  useEffect(() => edit({ type: "discard" }), [edit, source, adding]);
  // The rank of the source the screen shows, kept to follow it once it is saved under another identifier, and whether the person removed it.
  const shown = useRef<number | undefined>(undefined);
  const dropped = useRef(false);
  if (source !== undefined && rankOf(editing, source) !== undefined) shown.current = rankOf(editing, source);
  const { saved, view } = editing;
  useEffect(() => {
    const revision = view?.revision;
    if (saved === undefined || revision === undefined) return;
    // The list of the sources shows the revision saved at once, without waiting for the next reading.
    dispatch({ type: "read", view: view! });
    const sources = revision.document.knowledge;
    if (adding !== undefined) window.location.replace(hrefTo(sourcePath(sources.at(-1)!.id)));
    else if (source !== undefined && !sources.some(({ id }) => id === source)) {
      const kept = dropped.current ? undefined : sources[shown.current!];
      window.location.replace(hrefTo(kept === undefined ? KNOWLEDGE : sourcePath(kept.id)));
    }
  }, [saved, view, adding, source]);
  const controls: KnowledgeControls = {
    upload: (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      // The form holds its field of files, whose list a browser always gives.
      const { files } = form.elements.namedItem("documents") as HTMLInputElement;
      sync.upload(form.dataset["source"]!, [...files!]);
    },
    remove: ({ currentTarget }) => sync.remove(currentTarget.dataset["source"]!, currentTarget.dataset["name"]!),
    edit: editor.controls,
    drop: ({ currentTarget }) => {
      const rank = Number(currentTarget.dataset["rank"]);
      // The button is drawn for a source of the configuration in force, which is what loses it.
      const revision = editing.view!.revision!;
      dropped.current = true;
      editor.sync.save({ ...revision.document, knowledge: revision.document.knowledge.filter((_, index) => index !== rank) }, revision.number, {});
    },
  };
  return <KnowledgeScreen project={project} route={route} state={state} editing={editing} controls={controls} />;
}
