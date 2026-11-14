import type { IndexSourceType } from "@open-qa-stack/shared";

/** How the instructions of the workflow of a source speak of its elements, by what the source is. */
export interface SourceWords {
  /** What its elements are: `the tables, views and routines of a database`. */
  readonly elements: string;
  /** Elements that serve no functional area, as examples of what is set aside. */
  readonly aside: string;
  /** The name of an element as a file cites it, between backticks. */
  readonly cited: string;
  /** How an element is written in code. */
  readonly inCode: string;
  /** What a useful file of a domain holds. */
  readonly useful: string;
}

const DATABASE: SourceWords = {
  elements: "the tables, views and routines of a database",
  aside: "a migration log, a technical table",
  cited: "`public.orders`",
  inCode: "In code, write a table or a view with its schema, as the request does. A routine may be named without its arguments.",
  useful:
    "a table of the elements with their role, the columns worth searching or filtering on, how the elements link to each other and to the other domains, and a few hints on how to use them",
};

const CONTRACT: SourceWords = {
  elements: "the operations and schemas of an API contract",
  aside: "a health check, a technical schema",
  cited: "`GET /orders/{orderId}`",
  inCode: "In code, write an operation with its method and its path, and a schema under its name, as the request does.",
  useful:
    "a table of the operations with their role, the parameters worth filtering on, what each sends and returns with the properties a test reads, the statuses it answers with, how the operations and schemas link to each other and to the other domains, and a few hints on how to call them",
};

/**
 * The words of the instructions for a source.
 *
 * @param type - What the source is.
 * @returns Those of an API contract for one, those of a database otherwise.
 */
export function sourceWords(type: IndexSourceType): SourceWords {
  return type === "openapi" ? CONTRACT : DATABASE;
}
