import { useEffect, useRef } from "react";
import type { ConfigurationView, OqasConfig } from "@open-qa-stack/domain/sessions";
import { hrefTo } from "../routing/route.ts";
import type { ConfigurationEditor } from "./use-configuration-editor.ts";

/** A list of the configuration whose items each have a page of their own, saved alone: the sources, the applications. */
export interface ItemList {
  /** The items of the list in a configuration. */
  readonly items: (document: OqasConfig) => readonly { readonly id: string }[];
  /** The configuration without the item of a rank. */
  readonly without: (document: OqasConfig, rank: number) => OqasConfig;
  /** The address of the list. */
  readonly home: string;
  /** The address of the page of an item. */
  readonly pathOf: (id: string) => string;
}

/** Where the person is among the pages of a list. */
export interface ItemPlace {
  /** The identifier of the item whose page is shown; none on the list. */
  readonly id: string | undefined;
  /** Whether the person adds an item. */
  readonly adding: boolean;
}

/**
 * Tells the rank of an item in the configuration in force, which is its rank in the draft: an item is added after the
 * others, and changed or removed alone.
 *
 * @param view - The configuration as the instance told it.
 * @param items - The items of the list in a configuration.
 * @param id - The identifier of the item.
 * @returns Its rank; `undefined` while the instance did not tell the configuration, and for an item it does not declare.
 */
export function rankIn(view: ConfigurationView | undefined, items: ItemList["items"], id: string): number | undefined {
  const revision = view?.revision;
  const rank = revision === undefined ? -1 : items(revision.document).findIndex((item) => item.id === id);
  return rank < 0 ? undefined : rank;
}

/**
 * Keeps the pages of the items of a list in step with what is saved: a change not saved is dropped once the person
 * goes to another page; an item added leads to its page once saved, an item saved under another identifier is
 * followed there, and an item removed leads back to the list.
 *
 * @param editor - The draft of the configuration.
 * @param list - The list.
 * @param place - Where the person is.
 * @param onSaved - What is told the configuration once a change was saved.
 * @returns What removes the item of a rank from the configuration in force, as a revision of its own.
 */
export function useItemPages(
  editor: ConfigurationEditor,
  list: ItemList,
  { id, adding }: ItemPlace,
  onSaved?: (view: ConfigurationView) => void,
): (rank: number) => void {
  const { dispatch, state, sync } = editor;
  useEffect(() => dispatch({ type: "discard" }), [dispatch, id, adding]);
  // The rank of the item the page shows, kept to follow it once it is saved under another identifier, and whether the person removed it.
  const shown = useRef<number | undefined>(undefined);
  const dropped = useRef(false);
  const rank = id === undefined ? undefined : rankIn(state.view, list.items, id);
  if (rank !== undefined) shown.current = rank;
  const { saved, view } = state;
  // The revision saved last when the person came to the page: only a revision they save here moves them.
  const baseline = useRef<{ readonly place: string; readonly saved: number | undefined } | undefined>(undefined);
  useEffect(() => {
    const place = `${id}:${adding}`;
    if (baseline.current?.place !== place) {
      baseline.current = { place, saved };
      return;
    }
    const revision = view?.revision;
    if (saved === undefined || saved === baseline.current.saved || revision === undefined) return;
    onSaved?.(view!);
    const items = list.items(revision.document);
    if (adding) window.location.replace(hrefTo(list.pathOf(items.at(-1)!.id)));
    else if (id !== undefined && !items.some((item) => item.id === id)) {
      const kept = dropped.current ? undefined : items[shown.current!];
      window.location.replace(hrefTo(kept === undefined ? list.home : list.pathOf(kept.id)));
    }
  }, [saved, view, adding, id, list, onSaved]);
  return (dropping) => {
    // The button is drawn for an item of the configuration in force, which is what loses it.
    const revision = state.view!.revision!;
    dropped.current = true;
    sync.save(list.without(revision.document, dropping), revision.number, {});
  };
}
