import { hrefTo, type Route } from "../routing/route.ts";

/** The path of the screen of the defects. */
export const DEFECTS_PATH = "/defects";

/** The views of the defects: those to deal with, those fixed whose test is to run again, and those closed. */
export const DEFECT_VIEWS = ["open", "to_replay", "closed"] as const;

/** One of the views of the defects. */
export type DefectView = (typeof DEFECT_VIEWS)[number];

/**
 * Reads the view of the defects from the address: those to deal with by default.
 *
 * @param route - Where the console is.
 * @returns The view the address names.
 */
export function defectViewOf(route: Route): DefectView {
  return DEFECT_VIEWS.find((view) => view === route.query["view"]) ?? "open";
}

/**
 * The link to a view of the defects.
 *
 * @param view - The view; those to deal with when left out.
 * @returns The fragment to put in an `href`.
 */
export function defectsHref(view: DefectView = "open"): string {
  return hrefTo(DEFECTS_PATH, view === "open" ? {} : { view });
}
