import { defectsOf } from "./defects-arguments.ts";
import { reviewsOf } from "./reviews-arguments.ts";
import { agentsOf } from "./agents-arguments.ts";
import { applicationsOf } from "./applications-arguments.ts";
import { campaignsOf } from "./campaigns-arguments.ts";
import type { Command } from "./command.ts";
import { configured } from "./config-arguments.ts";
import { executionsOf } from "./executions-arguments.ts";
import { knowledgeOf } from "./knowledge-arguments.ts";
import { modelOf, type ConnectionOptions } from "./model-arguments.ts";
import { secretsOf } from "./secrets-arguments.ts";
import { testsOf } from "./tests-arguments.ts";

/** The commands on a session that exists, with the words each takes after its name. */
const ON_SESSIONS = { sessions: [], show: ["<session>"], attach: ["<session>"], say: ["<session>", "<text>"], stop: ["<session>"] } as const;

/** What the words and the options of a session ask for, or why they ask for nothing the command does. */
export function commandOf(
  words: readonly string[],
  options: {
    readonly environment: string | undefined;
    readonly brief: string | undefined;
    readonly follow: boolean;
    readonly help: boolean;
    readonly init: boolean;
    /** Whether the command may open the conversation, when it is given nothing else to do. */
    readonly asks: boolean;
    /** What `oqas model set` is told the connection with. */
    readonly connection: ConnectionOptions;
  },
): Command | string {
  const { environment, brief, follow, help, init, asks, connection } = options;
  if (help) return { name: "help" };
  const opens = environment !== undefined || brief !== undefined;
  const [name, ...rest] = words;
  if (init)
    return opens || name !== undefined ? "--init writes the files of the test repository and runs nothing: it takes --repository alone." : { name: "init" };
  if (name === undefined) {
    if (brief === undefined && asks) return { name: "converse", ...(environment === undefined ? {} : { environment }) };
    if (brief === undefined) return "Say what to test with --brief, or name a command; see oqas --help.";
    return { name: "run", brief, ...(environment === undefined ? {} : { environment }) };
  }
  if (name === "config") return configured(rest, opens || follow);
  if (name === "knowledge") return knowledgeOf(rest, opens || follow);
  if (name === "applications") return applicationsOf(rest, opens || follow);
  if (name === "agents") return agentsOf(rest, opens || follow);
  if (name === "model") return modelOf(rest, opens || follow, connection, asks);
  if (name === "secrets") return secretsOf(rest, opens || follow);
  if (name === "tests") return testsOf(rest, opens || follow);
  if (name === "reviews") return reviewsOf(rest, opens || follow);
  if (name === "defects") return defectsOf(rest, opens || follow);
  if (name === "executions") return executionsOf(rest, opens || follow);
  if (name === "campaigns") return campaignsOf(rest, { environment, brief, follow });
  if (name === "repository" || name === "project")
    return opens || follow || rest.length > 0 ? `oqas ${name} takes nothing after it, and no --brief, --environment nor --follow.` : { name };
  if (name === "launch") {
    if (brief !== undefined || follow) return "oqas launch runs tests as they are: it takes --environment, and no --brief nor --follow.";
    return { name: "launch", paths: rest, ...(environment === undefined ? {} : { environment }) };
  }
  if (!Object.hasOwn(ON_SESSIONS, name)) return `Unknown command ${name}; see oqas --help.`;
  const known = name as keyof typeof ON_SESSIONS;
  const taken: readonly string[] = ON_SESSIONS[known];
  if (opens) return `oqas ${known} acts on a session that exists: it takes no --brief nor --environment.`;
  if (rest.length !== taken.length) return `oqas ${known} takes ${taken.length === 0 ? "no word after it" : taken.join(" then ")}.`;
  if (follow && known !== "show" && known !== "attach") return `oqas ${known} prints no thread: it takes no --follow.`;
  const [session = "", text = ""] = rest;
  if (known === "sessions") return { name: known };
  return known === "say" ? { name: known, session, text } : { name: known, session };
}
