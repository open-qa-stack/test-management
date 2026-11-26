import { hrefTo, type Route } from "../routing/route.ts";

/** The path of the screen of the review. */
export const REVIEW_PATH = "/review";

/** The views of the review: the new tests to review, the updates of tests proposed, and the tests set aside. */
export const REVIEW_VIEWS = ["new", "updates", "set_aside"] as const;

/** One of the views of the review. */
export type ReviewView = (typeof REVIEW_VIEWS)[number];

/** Where the review stands, as its address keeps it: the view, the domain it is narrowed to, and the test shown. */
export interface ReviewPlace {
  readonly view: ReviewView;
  readonly domain?: string;
  readonly id?: string;
}

/**
 * Reads where the review stands from the address: the view of the new tests by default, every domain, and the first
 * test of the list.
 *
 * @param route - Where the console is.
 * @returns The view, the domain and the test the address names.
 */
export function reviewPlaceOf(route: Route): ReviewPlace {
  const { view, domain, id } = route.query;
  return {
    view: REVIEW_VIEWS.find((known) => known === view) ?? "new",
    ...(domain === undefined || domain === "" ? {} : { domain }),
    ...(id === undefined || id === "" ? {} : { id }),
  };
}

/**
 * The link to a place of the review.
 *
 * @param place - The view, the domain and the test; the view of the new tests, every domain and the first test when left out.
 * @returns The fragment to put in an `href`.
 */
export function reviewHref({ view, domain, id }: ReviewPlace): string {
  return hrefTo(REVIEW_PATH, { ...(view === "new" ? {} : { view }), ...(domain === undefined ? {} : { domain }), ...(id === undefined ? {} : { id }) });
}
