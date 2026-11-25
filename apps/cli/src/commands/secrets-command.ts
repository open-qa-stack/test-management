import { ExitCode, type ExitCodeValue } from "@open-qa-stack/domain";
import type { Secrets } from "@open-qa-stack/engine";
import { MISSING_ADVICE, secretLine } from "../output/secret-lines.ts";
import type { Asked } from "./asked.ts";
import { print } from "./print.ts";
import { typedValue } from "./typed-value.ts";

/**
 * `oqas secrets`: lists the variables the configuration in force names, and where the value of each comes from; with
 * `set`, saves the value of one first, typed in the terminal or read from the input.
 */
export async function valued({ secrets, command, options, io }: Omit<Asked<"secrets">, "sessions"> & { secrets: Secrets }): Promise<ExitCodeValue> {
  if (command.action === "set") {
    await secrets.save(command.variable, await typedValue(io, `Value of ${command.variable} (not shown): `));
    io.stderr.write(`${command.variable} is saved on this machine, out of the test repository.\n`);
  }
  const listed = await secrets.list();
  const lines = listed.length === 0 ? ["The configuration in force names no variable."] : listed.map(secretLine);
  if (listed.some(({ source }) => source === "missing")) lines.push(MISSING_ADVICE);
  print({ options, io }, lines.join("\n"), { secrets: listed });
  return ExitCode.passed;
}
