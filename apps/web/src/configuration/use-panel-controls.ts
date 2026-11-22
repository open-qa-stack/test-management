import { useEffect, useRef } from "react";
import { withPanel, type Route } from "../routing/route.ts";
import type { ConfigurationControls } from "./configuration-screen.tsx";

/**
 * What the person does to the draft on a page that changes the parts of an item in panels: a button that adds or
 * removes a part opens or closes its panel, and the panel closes once the change is saved, or dropped.
 *
 * @param controls - What the person does to the draft.
 * @param route - Where the console is, which tells the panel open.
 * @param saved - The revision the person saved last.
 * @param closesOnSave - Whether a save closes the panel: not on the page of an item added, which moves to the item saved.
 * @returns The controls, which also open and close the panels.
 */
export function usePanelControls(controls: ConfigurationControls, route: Route, saved: number | undefined, closesOnSave: boolean): ConfigurationControls {
  const panel = route.query["panel"];
  const lastSaved = useRef(saved);
  useEffect(() => {
    if (saved === lastSaved.current) return;
    lastSaved.current = saved;
    if (panel !== undefined && closesOnSave) window.location.hash = withPanel(route);
  }, [saved, panel, closesOnSave, route]);
  return {
    ...controls,
    click: (event) => {
      controls.click(event);
      const opened = event.currentTarget.dataset["panel"];
      if (opened !== undefined) window.location.hash = withPanel(route, opened === "" ? undefined : opened);
    },
    discard: (event) => {
      controls.discard(event);
      if (panel !== undefined) window.location.hash = withPanel(route);
    },
  };
}
