/** Where the console is: the segments of its path and the parameters of its query. */
export interface Route {
  /** The segments of the path, without empty ones: `["agent", "sessions", "oqas-2026-11-15T14-44-06-348Z"]`. */
  readonly path: readonly string[];
  /** The parameters of the query, such as what the thread of a session keeps. */
  readonly query: Readonly<Record<string, string>>;
}

/**
 * Reads the route the fragment of an address gives.
 *
 * @param hash - The fragment, with or without its `#`, such as `#/agent/sessions/oqas-2026-11-15T14-44-06-348Z?show=talk`.
 * @returns The route; the home, with no segment, for an empty fragment.
 */
export function parseRoute(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?");
  return {
    path: path.split("/").filter((segment) => segment !== ""),
    query: Object.fromEntries(new URLSearchParams(query)),
  };
}

/**
 * Writes the link to a screen.
 *
 * @param path - The path of the screen, such as `/agent`.
 * @param query - The parameters to add, such as `{ show: "talk" }`.
 * @returns The fragment to put in an `href`.
 */
export function hrefTo(path: string, query: Readonly<Record<string, string>> = {}): string {
  const parameters = new URLSearchParams(query).toString();
  return `#${path}${parameters === "" ? "" : `?${parameters}`}`;
}

/**
 * Writes the link to the screen of a route with a panel open on it, or with none.
 *
 * @param route - The route, whose other parameters are kept.
 * @param panel - The panel to open, such as `account:0`; none to close the one open.
 * @returns The fragment to put in an `href`.
 */
export function withPanel(route: Route, panel?: string): string {
  const { panel: _open, ...query } = route.query;
  return hrefTo(`/${route.path.join("/")}`, panel === undefined ? query : { ...query, panel });
}

/**
 * Tells whether a route is at a path or under it.
 *
 * @param route - The route.
 * @param path - A path, such as `/agent`.
 * @returns Whether the first segments of the route are those of the path; the home matches only itself.
 */
export function isUnder(route: Route, path: string): boolean {
  const segments = path.split("/").filter((segment) => segment !== "");
  if (segments.length === 0) return route.path.length === 0;
  return segments.every((segment, index) => route.path[index] === segment);
}
