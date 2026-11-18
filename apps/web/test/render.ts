import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseRoute, type Route } from "../src/routing/route.ts";

/**
 * Renders a component as the browser would first show it.
 *
 * @param node - What to render.
 * @returns Its HTML.
 */
export function render(node: ReactNode): string {
  return renderToStaticMarkup(node);
}

/**
 * Reads what a person reads of a piece of HTML.
 *
 * @param html - The HTML.
 * @returns Its text, tags left out, entities decoded, and spaces folded.
 */
export function textOf(html: string): string {
  return html
    .replace(/<[^<>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Lists where the links of a piece of HTML lead.
 *
 * @param html - The HTML.
 * @returns The `href` of each link, in order.
 */
export function linksOf(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((match) => match[1]!.replace(/&amp;/g, "&"));
}

/**
 * The route of an address of the console.
 *
 * @param hash - The fragment of the address, such as `#/tests`.
 * @returns The route.
 */
export function at(hash: string): Route {
  return parseRoute(hash);
}

/** The props of an element, as a test reads them. */
export type Props = Readonly<Record<string, unknown>>;

/**
 * Lists the elements of a kind that components without state render.
 *
 * @param node - What the components render.
 * @param type - The kind of element, such as `form`.
 * @returns The props of each, in order.
 */
export function elementsOf(node: ReactNode, type: string): Props[] {
  if (Array.isArray(node)) return node.flatMap((child: ReactNode) => elementsOf(child, type));
  if (!isValidElement<Props>(node)) return [];
  const inner = typeof node.type === "function" ? (node.type as (props: Props) => ReactNode)(node.props) : (node.props["children"] as ReactNode);
  return [...(node.type === type ? [node.props] : []), ...elementsOf(inner, type)];
}
