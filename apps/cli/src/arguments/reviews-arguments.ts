import { reviewDecisionOf } from "@open-qa-stack/domain";
import type { Command } from "./command.ts";

/** What `oqas reviews` takes after it, for what it is asked. */
const USAGE =
  "oqas reviews takes nothing; show, validate or restore then the identifier of a test; or set-aside then the identifier, a reason (covered then the path of the test that covers it, out-of-scope, wrong-oracle or wrong-level) and a note.";

/**
 * What `oqas reviews` asks for, or why it is refused: the queue of the review; one test of it, by its identifier, to read,
 * to validate, to set aside with why or to put back in review; and nothing of a session.
 */
export function reviewsOf(words: readonly string[], ofASession: boolean): Command | string {
  if (ofASession) return "oqas reviews reads the tests the agents wrote: it takes no --brief, --environment nor --follow.";
  if (words.length === 0) return { name: "reviews", action: "list" };
  const [action, id, reason, ...rest] = words;
  if (words.length === 2 && (action === "show" || action === "restore")) return { name: "reviews", action, id: id! };
  if (words.length === 2 && action === "validate") return { name: "reviews", action: "decide", id: id!, decision: { status: "validated" } };
  if (action !== "set-aside" || reason === undefined) return USAGE;
  const covered = reason === "covered";
  const [coveredBy, note] = covered ? rest : [undefined, rest[0]];
  if (rest.length > (covered ? 2 : 1)) return USAGE;
  const decision = reviewDecisionOf({ status: "set_aside", reason: reason.replaceAll("-", "_"), coveredBy, note });
  return typeof decision === "string" ? decision : { name: "reviews", action: "decide", id: id!, decision };
}
