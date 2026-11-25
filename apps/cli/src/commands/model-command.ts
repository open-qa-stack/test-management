import type { ExitCodeValue } from "@open-qa-stack/domain";
import type { Configuration, Secrets } from "@open-qa-stack/engine";
import type { Command } from "../arguments/command.ts";
import { keptTuning, modelOfArguments, modelReport } from "../output/model-lines.ts";
import type { Asked } from "./asked.ts";
import { modelConnectionOf } from "./operations.ts";
import { print } from "./print.ts";

/**
 * `oqas model`: tests the connection to the model in force, and lists the models it offers; with `set`, records the
 * connection it is given as a revision of origin `command` first, keeping the tuning of
 * the connection in force when it names the same model the same way. Exits with `0` when the
 * model answers and is among those offered, with `4` otherwise.
 */
export async function modelled({
  configuration,
  secrets,
  command,
  options,
  io,
}: Omit<Asked<"model">, "sessions" | "command"> & {
  configuration: Configuration;
  secrets: Secrets;
  command: Exclude<Extract<Command, { name: "model" }>, { action: "setup" }>;
}): Promise<ExitCodeValue> {
  if (command.action === "set") {
    const inForce = await configuration.current();
    const model = keptTuning(modelOfArguments(command.connection), inForce.document.model);
    await configuration.save({ ...inForce.document, model }, inForce.number, "command");
  }
  const revision = (await configuration.current()).document;
  const report = modelReport(revision.model, await modelConnectionOf(io, secrets).check(revision.model));
  print({ options, io }, report.text, report.value);
  return report.code;
}
