import { useEffect, useMemo, useReducer, type ReactNode } from "react";
import { api } from "../api/instance-api.ts";
import { hrefTo, type Route } from "../routing/route.ts";
import { FILES_INPUT, KnowledgeScreen, type KnowledgeControls } from "./knowledge-screen.tsx";
import { INITIAL_KNOWLEDGE, knowledgeAfter } from "./knowledge-state.ts";
import { KnowledgeSync } from "./knowledge-sync.ts";

/**
 * The screens of the knowledge in a browser: they keep the sources and their documents in step with the instance,
 * read the document the address names, upload the files the person chose and remove the document they confirmed,
 * then empty the field of an upload taken, and close the confirmation of a removal taken.
 *
 * @param props - The name of the project, and where the console is.
 * @returns The screen of the route.
 */
export function KnowledgePage({ project, route }: { readonly project: string; readonly route: Route }): ReactNode {
  const [state, dispatch] = useReducer(knowledgeAfter, INITIAL_KNOWLEDGE);
  const sync = useMemo(() => new KnowledgeSync(api, dispatch), []);
  useEffect(() => sync.read(), [sync]);
  const [, source] = route.path;
  const { document: reading, remove: asked } = route.query;
  useEffect(() => {
    if (source !== undefined && reading !== undefined) sync.open(source, reading);
  }, [sync, source, reading]);
  const { change } = state;
  useEffect(() => {
    if (change?.state !== "done") return;
    if (change.uploaded > 0) (window.document.getElementById(FILES_INPUT) as HTMLInputElement).form!.reset();
    else if (asked !== undefined) window.location.replace(hrefTo(`/knowledge/${change.source}`));
  }, [change, asked]);
  const controls: KnowledgeControls = {
    upload: (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      // The form holds its field of files, whose list a browser always gives.
      const { files } = form.elements.namedItem("documents") as HTMLInputElement;
      sync.upload(form.dataset["source"]!, [...files!]);
    },
    remove: ({ currentTarget }) => sync.remove(currentTarget.dataset["source"]!, currentTarget.dataset["name"]!),
  };
  return <KnowledgeScreen project={project} route={route} state={state} controls={controls} />;
}
