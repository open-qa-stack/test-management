import type { Command } from "./command.ts";

/** What `oqas reviews` asks for, or why it is refused: the queue of the review, or one test of it by its identifier, and nothing of a session. */
export function reviewsOf(words: readonly string[], ofASession: boolean): Command | string {
  if (ofASession) return "oqas reviews reads the tests the agents wrote: it takes no --brief, --environment nor --follow.";
  if (words.length === 0) return { name: "reviews", action: "list" };
  const [action, id] = words;
  if (action !== "show" || words.length !== 2) return "oqas reviews takes nothing, or show then the identifier of a test.";
  return { name: "reviews", action: "show", id: id! };
}
