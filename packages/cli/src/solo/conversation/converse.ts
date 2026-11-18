import { basename } from "node:path";
import { render } from "ink";
import { createElement } from "react";
import { ExitCode, languageOf, type ExitCodeValue } from "@open-qa-stack/domain";
import { hasEnded, type Project } from "@open-qa-stack/domain/sessions";
import type { Sessions } from "@open-qa-stack/engine";
import type { DatabaseUrl } from "@open-qa-stack/store";
import { UI_HOST } from "../arguments.ts";
import { failureOf } from "../failure.ts";
import { databaseOf, openOperations } from "../operations.ts";
import { startConsole, type StartedConsole } from "../served-console.ts";
import { exitCodeOf } from "../session-exit.ts";
import { Conversation, type ConversationProps, type Leaving } from "./conversation.ts";
import { themeOf } from "./palette.ts";
import type { CommandIo, CommandTerminal } from "../command-io.ts";
import type { ConversationContext } from "./conversation-state.ts";
import { i18n, t } from "./i18n/i18n.ts";

/** What the conversation is opened with. */
export interface Conversed {
  /** Absolute path of the test repository. */
  readonly repository: string;
  /** The environment its sessions are opened against; the only one the configuration declares when left out. */
  readonly environment?: string;
  /** The terminal of the person. */
  readonly terminal: CommandTerminal;
  /** The environment and the outputs of the command. */
  readonly io: CommandIo;
}

/**
 * Says where a conversation takes place, for its banner.
 *
 * @param project - The project of the instance, as its database keeps it.
 * @param repository - Absolute path of the test repository.
 * @param database - The URL of the database of the instance.
 * @param environment - The environment the sessions are opened against, when the command was given one.
 * @returns The context. An instance no host started yet has no project: it is named after the folder of its
 * repository, as a host names it.
 */
export function contextOf(project: Project, repository: string, database: DatabaseUrl, environment: string | undefined): ConversationContext {
  return {
    project: project.name ?? basename(repository),
    repository,
    database: database.file === undefined ? "PostgreSQL" : "SQLite",
    ...(environment === undefined ? {} : { environment }),
  };
}

/**
 * Says why something failed, for the thread of a conversation.
 *
 * @param error - What an operation raised.
 * @returns Its message, as the other commands tell it; one nothing foresaw is told as unexpected. Never a stack trace.
 */
export function reasonOf(error: unknown): string {
  const { kind, message } = failureOf(error);
  return kind === "unexpected" ? t("notices.unexpected", { message }) : message;
}

/**
 * Draws a conversation in a terminal, until the person leaves it.
 *
 * @param terminal - The terminal of the person.
 * @param props - What the conversation is given.
 * @returns How the person left, once the screen is left and the terminal is theirs again.
 */
function conversation(terminal: CommandTerminal, props: Omit<ConversationProps, "onLeave">): Promise<Leaving> {
  return new Promise((left, failed) => {
    const app = render(
      createElement(Conversation, {
        ...props,
        onLeave: (leaving) => {
          app.unmount();
          app.waitUntilExit().then(() => left(leaving), failed);
        },
      }),
      { stdin: terminal.stdin, stdout: terminal.stdout, exitOnCtrlC: false, patchConsole: false, interactive: true },
    );
  });
}

/**
 * Gives the code the conversation exits with for a session it opened: the code `oqas --brief` exits with for
 * a session that ended, and that of a session that did not go to its end for one the person left going.
 */
async function codeOf(sessions: Sessions, id: string): Promise<ExitCodeValue> {
  const session = await sessions.session(id);
  if (!hasEnded(session.state)) return ExitCode.interrupted;
  const started = (await sessions.thread(id)).findLast((event) => event.type === "phase_started");
  return exitCodeOf(session, started?.phase);
}

/**
 * `oqas`, without a command, in a terminal: opens the conversation and stays in it until the person leaves.
 *
 * @remarks
 * The conversation is another presentation of the operations on sessions, on the database the other commands
 * reach: the sessions opened in it run in this process, as those of `oqas --brief` do, and those another
 * process runs are followed, spoken to and stopped through the database, as `oqas attach`, `say` and `stop` do.
 *
 * While the screen is drawn nothing else may write to the terminal: what the operations report around the
 * sessions is kept, and goes to the error output once the screen is left.
 *
 * The conversation speaks the language the configuration in force names, English when it names none: the
 * configuration is brought in step with its file first, as a host does when it starts.
 *
 * Leaving stops what this process hosts — the session it runs is asked to stop and awaited for a time, or not
 * awaited when the person left at once — and the web console when `/ui` started it.
 *
 * @param conversed - The test repository, the environment, the terminal and what the command runs with.
 * @returns The exit code: that of the last session the conversation opened, as `oqas --brief` gives it, `5`
 * when that session had not ended, and `0` when the conversation opened none.
 * @throws What opening the operations raises: the database cannot be told, opened, or has migrations pending.
 */
export async function converse({ repository, environment, terminal, io }: Conversed): Promise<ExitCodeValue> {
  const reported: string[] = [];
  const quiet: CommandIo = { ...io, stderr: { write: (text) => reported.push(text) } };
  try {
    const { sessions, configuration, close } = await openOperations(quiet, repository, true);
    let serving: Promise<StartedConsole> | undefined;
    let withinMs: number | undefined;
    try {
      // The conversation speaks the language of the configuration in force, brought in step with its file as a host does when it starts.
      await configuration.inStep();
      await i18n.changeLanguage(languageOf(await configuration.view()));
      const [project, latest] = await Promise.all([sessions.project(), sessions.sessions()]);
      const { atOnce, hosted } = await conversation(terminal, {
        sessions,
        latest,
        context: contextOf(project, repository, databaseOf(io, repository), environment),
        theme: themeOf(io.env),
        now: () => (io.now?.() ?? new Date()).getTime(),
        serve: async (port) => {
          const starting = (serving ??= startConsole({ host: UI_HOST, port }, repository, quiet));
          try {
            return (await starting).url;
          } catch (error) {
            // A console that did not start is forgotten, so that it may be asked again, on another port.
            serving = undefined;
            throw error;
          }
        },
        reasonOf,
      });
      if (atOnce) withinMs = 0;
      const last = hosted.at(-1);
      return last === undefined ? ExitCode.passed : await codeOf(sessions, last);
    } finally {
      try {
        await (await serving)?.close();
      } finally {
        await close(withinMs);
      }
    }
  } finally {
    for (const text of reported) io.stderr.write(text);
  }
}
