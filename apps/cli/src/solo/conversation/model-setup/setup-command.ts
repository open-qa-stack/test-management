import { render } from "ink";
import { createElement } from "react";
import { ExitCode, languageOf, type ExitCodeValue } from "@open-qa-stack/domain";
import { modelConnectionOf, savedModel, type Operations } from "../../operations.ts";
import type { CommandIo, CommandTerminal } from "../../command-io.ts";
import { reasonOf } from "../converse.ts";
import { i18n, t } from "../i18n/i18n.ts";
import { themeOf } from "../palette.ts";
import { ModelSetup, reachText, type SetupEnd } from "./model-setup.ts";

/**
 * `oqas model` in a terminal: sets the connection to the model step by step, in the language of the configuration in
 * force, and records it as a revision of origin `command`.
 *
 * @param operations - The operations on the configuration of the test repository, and on the values of its variables.
 * @param terminal - Where the setting is drawn and heard.
 * @param io - The environment, and where the end is told.
 * @returns `0` once a connection is recorded; `5` when the person left, and nothing changed, or when it could not go on.
 */
export async function setupModel(operations: Pick<Operations, "configuration" | "secrets">, terminal: CommandTerminal, io: CommandIo): Promise<ExitCodeValue> {
  const { configuration, secrets } = operations;
  const inForce = await configuration.current();
  await i18n.changeLanguage(languageOf(await configuration.view()));
  const connection = modelConnectionOf(io, secrets);
  const end = await new Promise<SetupEnd>((ended, failed) => {
    const app = render(
      createElement(ModelSetup, {
        inForce: inForce.document.model,
        check: (model, key) => connection.check(model, key),
        save: (model, key) => savedModel(operations, model, key),
        reasonOf,
        theme: themeOf(io.env),
        onEnd: (told) => {
          app.unmount();
          app.waitUntilExit().then(() => ended(told), failed);
        },
      }),
      { stdin: terminal.stdin, stdout: terminal.stdout, exitOnCtrlC: true, patchConsole: false, interactive: true },
    );
  });
  if (end.saved !== undefined) {
    io.stdout.write(`${t("model.set", { model: end.saved.model, reach: reachText(end.saved) })}\n`);
    return ExitCode.passed;
  }
  io.stderr.write(`${end.error ?? t("model.left")}\n`);
  return ExitCode.interrupted;
}
