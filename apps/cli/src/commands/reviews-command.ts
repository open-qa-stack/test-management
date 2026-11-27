import { ExitCode, type ExitCodeValue } from "@open-qa-stack/domain";
import type { Command } from "../arguments/command.ts";
import { proposalLines, reviewLine } from "../output/review-lines.ts";
import type { Asked } from "./asked.ts";
import type { Operations } from "./operations.ts";
import { linesOr, print } from "./print.ts";

/**
 * `oqas reviews`: lists the tests the agents wrote for a person to review and those set aside; with show, tells what a
 * person reads to decide of one; with validate, has it enter the working branch; with set-aside, leaves it out with why;
 * with restore, puts one set aside back in review.
 */
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
  if (command.action === "decide") {
    const decided = await reviews.decide(command.id, command.decision);
    const said =
      decided.entered === undefined
        ? `The test ${command.id} is set aside.`
        : decided.entered.committed
          ? `The test ${command.id} is validated: it entered ${decided.entered.branch}, committed there; nothing was pushed.`
          : `The test ${command.id} is validated: ${decided.entered.branch} had it already as its design wrote it.`;
    print(printing, said, decided);
    return ExitCode.passed;
  }
  if (command.action === "restore") {
    await reviews.restore(command.id);
    print(printing, `The test ${command.id} is back in review.`, { id: command.id, status: "in_review" });
    return ExitCode.passed;
  }
  const proposal = await reviews.proposal(command.id);
  print(printing, proposalLines(proposal).join("\n"), proposal);
  return ExitCode.passed;
}
