import { ExitCode, type ExitCodeValue } from "@open-qa-stack/domain";
import type { Command } from "../arguments/command.ts";
import { memoryLine } from "../output/memory-lines.ts";
import type { Asked } from "./asked.ts";
import type { Operations } from "./operations.ts";
import { linesOr, print } from "./print.ts";

/**
 * `oqas memory`: lists the lessons the people of the project gave the agents and what the agents noted; with add, keeps
 * an instruction; with on, off or reword, changes a line.
 */
export async function remembered(
  { memory }: Pick<Operations, "memory">,
  command: Extract<Command, { name: "memory" }>,
  printing: Pick<Asked<"memory">, "options" | "io">,
): Promise<ExitCodeValue> {
  if (command.action === "list") {
    const list = await memory.list();
    print(printing, linesOr(list.items.map(memoryLine), "The agents keep nothing in mind yet."), list);
    return ExitCode.passed;
  }
  const item = command.action === "add" ? await memory.add(command.draft) : await memory.change(command.id, command.change);
  print(printing, memoryLine(item), item);
  return ExitCode.passed;
}
