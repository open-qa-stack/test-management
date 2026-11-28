import type { MemoryItemType } from "@open-qa-stack/domain/sessions";
import { hrefTo, type Route } from "../routing/route.ts";

/** The path of the screen of the memory of the agents. */
export const MEMORY_PATH = "/memory";

/** The views of the memory: the lines the agents keep in mind, and those set aside. */
export const MEMORY_VIEWS = ["active", "inactive"] as const;

/** One of the views of the memory. */
export type MemoryView = (typeof MEMORY_VIEWS)[number];

/** The types of line a view is narrowed to. */
export const MEMORY_TYPES: readonly MemoryItemType[] = ["instruction", "correction", "inferred"];

/** Where the memory stands: its view, the type it is narrowed to, and the panel open over it. */
export interface MemoryPlace {
  readonly view: MemoryView;
  readonly type?: MemoryItemType;
  /** `add` for the panel that adds an instruction; the identifier of a line for the one that adjusts it. */
  readonly panel?: string;
  /** Whether every line of the view shows, beyond the first ones. */
  readonly all?: boolean;
}

/** How many lines a view shows before it is asked for the others. */
export const FIRST_LINES = 10;

/**
 * Reads where the memory stands from the address: the first lines active, of every type, without a panel, by default.
 *
 * @param route - Where the console is.
 * @returns The place the address names.
 */
export function memoryPlaceOf(route: Route): MemoryPlace {
  const type = MEMORY_TYPES.find((known) => known === route.query["type"]);
  const panel = route.query["panel"];
  return {
    view: MEMORY_VIEWS.find((view) => view === route.query["view"]) ?? "active",
    ...(type === undefined ? {} : { type }),
    ...(panel === undefined || panel === "" ? {} : { panel }),
    ...(route.query["shown"] === "all" ? { all: true } : {}),
  };
}

/**
 * The link to a place of the memory.
 *
 * @param place - The place.
 * @returns The fragment to put in an `href`.
 */
export function memoryHref({ view, type, panel, all }: MemoryPlace): string {
  return hrefTo(MEMORY_PATH, {
    ...(view === "active" ? {} : { view }),
    ...(type === undefined ? {} : { type }),
    ...(all === true ? { shown: "all" } : {}),
    ...(panel === undefined ? {} : { panel }),
  });
}

/**
 * The place a panel closes on: the same view, type and lines, without the panel.
 *
 * @param place - Where the memory stands.
 * @returns The place without its panel.
 */
export function closedOf({ panel: _panel, ...place }: MemoryPlace): MemoryPlace {
  return place;
}
