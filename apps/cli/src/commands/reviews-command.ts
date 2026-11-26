import { ExitCode, type ExitCodeValue } from "@open-qa-stack/domain";
import type { Command } from "../arguments/command.ts";
import { proposalLines, reviewLine } from "../output/review-lines.ts";
import type { Asked } from "./asked.ts";
import type { Operations } from "./operations.ts";
import { linesOr, print } from "./print.ts";

/** `oqas reviews`: lists the tests the agents wrote for a person to review and those set aside; with show, tells what a person reads to decide of one. */
export async function reviewed(
  { reviews }: Pick<Operations, "reviews">,
  command: Extract<Command, { name: "reviews" }>,
  printing: Pick<Asked<"reviews">, "options" | "io">,
): Promise<ExitCodeValue> {
  if (command.action === "list") {
    const queue = await reviews.queue();
    print(printing, linesOr(queue.tests.map(reviewLine), "No test the agents wrote waits for a review."), queue);
    return ExitCode.passed;
  }
  const proposal = await reviews.proposal(command.id);
  print(printing, proposalLines(proposal).join("\n"), proposal);
  return ExitCode.passed;
}
