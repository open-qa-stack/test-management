import { scopedToolName } from "@open-qa-stack/tools";
import { PROPOSE_TOOL } from "./test-proposals.ts";

/** What a failed run stopped on, read from the error of the runner. */
export type ErrorClass = "strict" | "locator" | "assertion" | "navigation" | "other";

/** Longest part of what the application showed that a hint repeats. */
const MAX_RECEIVED = 200;

/**
 * What a failed run stopped on: a locator that matches several elements, an element not on the screen, an
 * assertion of the application, a page that did not load, or anything else.
 *
 * @param error - The error the runner gave for the test.
 * @returns Its class.
 */
export function errorClass(error: string): ErrorClass {
  if (error.includes("strict mode violation")) return "strict";
  if (/net::ERR_|page\.goto:|[Nn]avigation timeout/.test(error)) return "navigation";
  if (/^(?:Error: )?expect\(/m.test(error) && ((error.includes("Expected") && error.includes("Received")) || /toBe(?:Visible|Hidden)\(/.test(error))) return "assertion";
  if (/Timeout \d+ms exceeded/.test(error) && error.includes("waiting for")) return "locator";
  return "other";
}

/**
 * The one thing to look at after a failed run, picked by what it stopped on.
 *
 * @param error - The error the runner gave for the test.
 * @param application - Identifier of the application the test is about.
 * @returns The hint, in one or two sentences.
 */
export function failureHint(error: string, application: string): string {
  const snapshot = scopedToolName(application, "snapshot");
  switch (errorClass(error)) {
    case "strict":
      return `The locator matches several elements. Start from the parent the snapshot shows (the table, the form, the dialog), or use the full name. Take ${snapshot} at that step to choose.`;
    case "locator":
      return "The element is not on the screen at that step. Redo the steps before it with the browser tools and copy the code the tool returns.";
    case "assertion": {
      const received = /^Received[^:\n]*: (.*)$/m.exec(error)?.[1] ?? (error.includes("element(s) not found") ? "no such element" : "something else");
      const expected = /^Expected[^:\n]*: (.*)$/m.exec(error)?.[1] ?? "something else";
      const cut = received.length > MAX_RECEIVED ? `${received.slice(0, MAX_RECEIVED)}…` : received;
      return `The application shows ${cut} where the plan expects ${expected}. The expected text stays. Check that the locator points at the right element and that the result had time to appear; if it did, call ${PROPOSE_TOOL} with diagnosis.`;
    }
    case "navigation":
      return `The page did not load. Check the path with ${scopedToolName(application, "goto")}; a test uses a path relative to the base URL.`;
    case "other":
      return "The run stopped on an error that is not an assertion; read it, and look at the page at that step before you change the test.";
  }
}
