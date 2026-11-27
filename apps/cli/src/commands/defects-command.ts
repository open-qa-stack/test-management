import { ExitCode, type ExitCodeValue } from "@open-qa-stack/domain";
import type { Command } from "../arguments/command.ts";
import { defectLine } from "../output/defect-lines.ts";
import type { Asked } from "./asked.ts";
import type { Operations } from "./operations.ts";
import { linesOr, print } from "./print.ts";

/** `oqas defects`: lists the defects reported from tests that failed; with report, keeps one; with fix, close or open, moves one. */
export async function defected(
  { defects }: Pick<Operations, "defects">,
  command: Extract<Command, { name: "defects" }>,
  printing: Pick<Asked<"defects">, "options" | "io">,
): Promise<ExitCodeValue> {
  if (command.action === "list") {
    const list = await defects.list();
    print(printing, linesOr(list.items.map(defectLine), "No defect was reported yet."), list);
    return ExitCode.passed;
  }
  const defect = command.action === "report" ? await defects.report(command.report) : await defects.change(command.id, command.status);
  print(printing, defectLine(defect), defect);
  return ExitCode.passed;
}
