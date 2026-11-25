import { ExitCode, type ExitCodeValue } from "@open-qa-stack/domain";
import type { Command } from "../arguments/command.ts";
import { executionLines, executionPageLines } from "../output/test-lines.ts";
import type { Asked } from "./asked.ts";
import type { Operations } from "./operations.ts";
import { print } from "./print.ts";

/** How many executions `oqas executions` lists at a time. */
const EXECUTIONS_PAGE = 20;

/** `oqas executions`: lists the executions of tests, the latest first, a page at a time; with `show`, prints one. */
export async function executed(
  { executions }: Pick<Operations, "executions">,
  command: Extract<Command, { name: "executions" }>,
  printing: Pick<Asked<"executions">, "options" | "io">,
): Promise<ExitCodeValue> {
  if (command.action === "show") {
    const execution = await executions.get(command.execution);
    print(printing, executionLines(execution).join("\n"), execution);
    return ExitCode.passed;
  }
  const { outcome, before } = command;
  const page = await executions.page({ limit: EXECUTIONS_PAGE, ...(outcome === undefined ? {} : { outcome }), ...(before === undefined ? {} : { before }) });
  print(printing, executionPageLines(page).join("\n"), page);
  return ExitCode.passed;
}
