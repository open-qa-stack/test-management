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
}

/**
 * Reads where the memory stands from the address: the lines active, of every type, without a panel, by default.
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
  };
}

/**
 * The link to a place of the memory.
 *
 * @param place - The place.
 * @returns The fragment to put in an `href`.
 */
export function memoryHref({ view, type, panel }: MemoryPlace): string {
  return hrefTo(MEMORY_PATH, { ...(view === "active" ? {} : { view }), ...(type === undefined ? {} : { type }), ...(panel === undefined ? {} : { panel }) });
}
