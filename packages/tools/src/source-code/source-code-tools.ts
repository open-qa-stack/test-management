import type { ToolDefinition } from "@open-qa-stack/domain";
import type { SourceCodeCommands } from "@open-qa-stack/shared";
import { scopedToolName } from "../common/tool-name.ts";
import type { CodeFolder } from "./code-folder.ts";
import { searchCode } from "./code-search.ts";
import { fileOutline } from "./file-outline.ts";
import { parsedExtensions } from "./syntax-parser.ts";
import { GitHistory, MAX_BLAME_LINES, MAX_LOG_COMMITS } from "./git-history.ts";
import { runProcess } from "./process-run.ts";
import { fileLines, numberedLines } from "./text-search.ts";

/** Most files a listing returns. */
export const MAX_LISTED_FILES = 500;
/** Most matches a search returns. */
export const MAX_SEARCH_MATCHES = 100;
/** Most lines around a match. */
export const MAX_CONTEXT_LINES = 5;
/** Most lines one read returns. */
export const MAX_READ_LINES = 400;
/** Longest line a read returns as it is; minified code aside, no line of source is longer. */
export const MAX_READ_LINE_LENGTH = 2000;
/** Longest a shell command may run, in milliseconds. */
export const SHELL_TIMEOUT_MS = 30_000;

const integer = (minimum: number, maximum: number, description: string) => ({ type: "integer", minimum, maximum, description }) as const;
const path = { type: "string", minLength: 1, description: "Path relative to the folder." } as const;
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

/**
 * The tools of a source code knowledge source: list, search and read its files, outline one, and,
 * depending on `commands`, read its git history or run commands in it.
 *
 * @remarks
 * The reading and git tools neither write nor leave the folder. `commands` adds the tools of the risk the
 * configuration accepts: none, the git history (`git log`, `git blame`, `git show`), or any shell command.
 * A shell command runs with the rights of the user: it can write, and read outside the folder.
 *
 * @param knowledgeId - Identifier of the knowledge source.
 * @param folder - The folder of the code.
 * @param commands - Commands the agents may run in it.
 * @returns The tools.
 */
export function sourceCodeTools(knowledgeId: string, folder: CodeFolder, commands: SourceCodeCommands): ToolDefinition[] {
  const name = (action: string) => scopedToolName(knowledgeId, action);
  const of = `of the source code ${knowledgeId}`;
  const reading: ToolDefinition[] = [
    {
      name: name("list_files"),
      description: `Lists the files ${of}, dependencies and builds left out. A glob without "/" matches file names ("*.java"); with "/", paths ("src/**/*.ts").`,
      parameters: object({ glob: { type: "string", minLength: 1 }, limit: integer(1, MAX_LISTED_FILES, "Defaults to 200.") }),
      execute: async (args) => {
        const { glob, limit = 200 } = args as { glob?: string; limit?: number };
        const { files, truncated } = await folder.list(glob);
        return { files: files.slice(0, limit), truncated: truncated || files.length > limit };
      },
    },
    {
      name: name("search"),
      description: `Finds the lines ${of} that contain a text, or match a JavaScript regular expression, with the lines around each. Files larger than a megabyte, and binary files, are not searched: the answer lists them as skipped.`,
      parameters: object(
        {
          pattern: { type: "string", minLength: 1 },
          regex: { type: "boolean", description: "Whether the pattern is a JavaScript regular expression; a plain text by default." },
          caseSensitive: { type: "boolean", description: "False by default." },
          glob: { type: "string", minLength: 1, description: "Searches only the files that match it." },
          context: integer(0, MAX_CONTEXT_LINES, "Lines before and after each match; 2 by default."),
          limit: integer(1, MAX_SEARCH_MATCHES, "Defaults to 30."),
        },
        ["pattern"],
      ),
      execute: (args) => {
        const { pattern, regex = false, caseSensitive = false, glob, context = 2, limit = 30 } = args as { pattern: string; regex?: boolean; caseSensitive?: boolean; glob?: string; context?: number; limit?: number };
        return searchCode(folder, { pattern, regex, caseSensitive, ...(glob === undefined ? {} : { glob }), context, limit });
      },
    },
    {
      name: name("read_file"),
      description: `Returns numbered lines of a file ${of}, ${MAX_READ_LINES} at most per call; read the next ones from the last line given.`,
      parameters: object({ path, startLine: integer(1, Number.MAX_SAFE_INTEGER, "Defaults to 1."), endLine: integer(1, Number.MAX_SAFE_INTEGER, "Defaults to the end, within the bound.") }, ["path"]),
      execute: async (args) => {
        const { path: file, startLine = 1, endLine } = args as { path: string; startLine?: number; endLine?: number };
        const lines = fileLines(await folder.read(file));
        const last = Math.min(endLine ?? lines.length, lines.length, startLine + MAX_READ_LINES - 1);
        return { path: file, totalLines: lines.length, lines: numberedLines(lines.slice(startLine - 1, last), startLine, MAX_READ_LINE_LENGTH) };
      },
    },
    {
      name: name("outline"),
      description: `Lists the declarations of a source file ${of} with their lines: classes, interfaces, enums, functions, methods, and the annotations that map web routes. Reads ${parsedExtensions().map((e) => `.${e}`).join(" ")} files.`,
      parameters: object({ path }, ["path"]),
      execute: async (args) => {
        const { path: file } = args as { path: string };
        return (await fileOutline(file, await folder.read(file))) ?? { error: `No outline for ${file}: no grammar reads its language. Read the file instead.` };
      },
    },
  ];
  if (commands === "none") return reading;
  const history = new GitHistory(folder);
  const git: ToolDefinition[] = [
    {
      name: name("git_log"),
      description: `Lists the latest commits that changed the source code ${knowledgeId}, or one of its files.`,
      parameters: object({ path, limit: integer(1, MAX_LOG_COMMITS, "Defaults to 20.") }),
      execute: (args) => {
        const { path: file, limit = 20 } = args as { path?: string; limit?: number };
        return history.log(file, limit);
      },
    },
    {
      name: name("git_blame"),
      description: `Tells which commit last changed each line of a range of a file ${of}, ${MAX_BLAME_LINES} lines at most.`,
      parameters: object({ path, startLine: integer(1, Number.MAX_SAFE_INTEGER, "First line."), endLine: integer(1, Number.MAX_SAFE_INTEGER, "Last line.") }, ["path", "startLine", "endLine"]),
      execute: (args) => {
        const { path: file, startLine, endLine } = args as { path: string; startLine: number; endLine: number };
        return history.blame(file, startLine, endLine);
      },
    },
    {
      name: name("git_show"),
      description: `Shows a commit ${of}: its message, and the changes it made to the folder or to one file.`,
      parameters: object({ commit: { type: "string", description: "A hash, HEAD or HEAD~n." }, path }, ["commit"]),
      execute: (args) => {
        const { commit, path: file } = args as { commit: string; path?: string };
        return history.show(commit, file);
      },
    },
  ];
  if (commands === "git") return [...reading, ...git];
  return [
    ...reading,
    ...git,
    {
      name: name("run_command"),
      description: `Runs a shell command in the folder ${of} and returns its output. It runs with the rights of the user, for ${SHELL_TIMEOUT_MS / 1000} s at most. Prefer the other tools to read the code; never change files.`,
      parameters: object({ command: { type: "string", minLength: 1 } }, ["command"]),
      execute: async (args) => {
        const { command } = args as { command: string };
        return runProcess("/bin/sh", ["-c", command], await folder.rootPath(), SHELL_TIMEOUT_MS);
      },
    },
  ];
}
