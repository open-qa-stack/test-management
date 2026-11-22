import { render } from "ink";
import { createElement } from "react";
import { RepositorySetup } from "@open-qa-stack/engine";
import { LANGUAGES, type Language } from "@open-qa-stack/domain";
import { modelConnectionOf, openOperations } from "../../operations.ts";
import type { CommandIo, CommandTerminal } from "../../command-io.ts";
import { reasonOf } from "../converse.ts";
import { i18n, t } from "../i18n/i18n.ts";
import { themeOf } from "../palette.ts";
import { configOf, valuesOf } from "./project-draft.ts";
import { ProjectSetup, type ProjectSetupEnd } from "./project-setup.ts";

/**
 * @param env - The environment of the command.
 * @returns The language of the terminal, as its locale names it, when the configuration speaks it; English otherwise.
 */
export function terminalLanguage(env: Readonly<Record<string, string | undefined>>): Language {
  const locale = (env["LC_ALL"] || env["LC_MESSAGES"] || env["LANG"] || "").slice(0, 2);
  return LANGUAGES.find((language) => language === locale) ?? "en";
}

/**
 * `oqas` in a terminal, on a folder never configured: sets the project up step by step, in the language of the terminal,
 * which the configuration then speaks; then writes it as the console does — the configuration, the values typed, the
 * Playwright project and, in a folder that is no git repository, its first commit.
 *
 * @param repository - Absolute path of the test repository.
 * @param terminal - Where the setting up is drawn and heard.
 * @param io - The environment, and where the end is told.
 * @returns Whether the project was created: the conversation opens then; `false` when the person left, or it failed, which is told.
 */
export async function setupProject(repository: string, terminal: CommandTerminal, io: CommandIo): Promise<boolean> {
  const language = terminalLanguage(io.env);
  await i18n.changeLanguage(language);
  const { configuration, secrets, sources, close } = await openOperations(io, repository, false, false, "started");
  try {
    const connection = modelConnectionOf(io, secrets);
    const end = await new Promise<ProjectSetupEnd>((ended, failed) => {
      const app = render(
        createElement(ProjectSetup, {
          folder: repository,
          check: (source, value) => sources.check(source, value),
          checkModel: (model, key) => connection.check(model, key),
          create: async (draft) => {
            await configuration.save(configOf(draft, language), 0, "command");
            for (const [name, value] of Object.entries(valuesOf(draft))) await secrets.save(name, value);
            return new RepositorySetup(repository, configuration).prepare();
          },
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
    if (end.created === undefined) {
      io.stderr.write(`${end.error ?? t("setup.left")}\n`);
      return false;
    }
    io.stdout.write(`${t("setup.created", { folder: repository, committed: t(end.created.committed ? "setup.committed" : "setup.toCommit") })}\n`);
    return true;
  } finally {
    await close();
  }
}
