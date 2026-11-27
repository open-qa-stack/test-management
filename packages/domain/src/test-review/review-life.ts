import type { ReviewStatus } from "./test-review.ts";

/** What a person does of a test the agents wrote. */
export type ReviewEvent = "validate" | "set_aside" | "restore" | "correct";

/** What the life of a test to review says of one event: the states it is for, and the state it leaves the test in. */
interface ReviewRule {
  readonly from: readonly ReviewStatus[];
  readonly to: ReviewStatus;
}

/**
 * The life of a test the agents wrote, in the review of a person: for each event, the states it is for, and the state it
 * leaves the test in.
 *
 * @remarks
 * A test is `in_review` once a design kept it. A person validates it, and it enters the working branch for good, or sets
 * it aside, and it can be put back in review as it was; or asks for its correction, and it is `in_correction` while the
 * session that wrote it corrects it, then `in_review` again on its own once that session ended. Whoever keeps the
 * decisions enforces this table.
 */
export const REVIEW_LIFE = {
  /** The test enters the working branch of the test repository. */
  validate: { from: ["in_review"], to: "validated" },
  /** The test is left out, with why. */
  set_aside: { from: ["in_review"], to: "set_aside" },
  /** A test set aside goes back in review, as it was. */
  restore: { from: ["set_aside"], to: "in_review" },
  /** The session that wrote the test corrects it as the person asks. */
  correct: { from: ["in_review"], to: "in_correction" },
} as const satisfies Readonly<Record<ReviewEvent, ReviewRule>>;

/**
 * Gives the state an event leaves a test to review in.
 *
 * @param event - What the person does.
 * @param status - Where the test stands before.
 * @returns Where it stands after; `undefined` when the event is not for a test that stands there.
 */
export function reviewStatusAfter(event: ReviewEvent, status: ReviewStatus): ReviewStatus | undefined {
  const rule: ReviewRule = REVIEW_LIFE[event];
  return rule.from.includes(status) ? rule.to : undefined;
}

/**
 * Tells why a test is refused an event, from where it stands: an event is only refused to a test decided of already,
 * to one being corrected, or to one in review that is put back in review.
 *
 * @param path - The path of the test, which names it.
 * @param status - Where it stands.
 * @returns Why, in a sentence.
 */
export function reviewRefusalOf(path: string, status: ReviewStatus): string {
  if (status === "validated") return `The test ${path} is validated already: it is in the working branch.`;
  if (status === "in_correction") return `The test ${path} is being corrected: decide of it once the session that corrects it ended.`;
  return `The test ${path} is ${status === "set_aside" ? "set aside" : "in review"} already.`;
}
