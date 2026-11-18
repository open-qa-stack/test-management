import type { ActionLook } from "@open-qa-stack/domain/sessions";
import { applicationOf } from "./browser-tool.ts";

/** A file an agent handed a tool: its path and its lines. */
export interface CodeLook {
  readonly kind: "code";
  /** The path of the file. */
  readonly file: string;
  /** Its lines. */
  readonly lines: readonly string[];
}

/** A page a browser tool rendered for an agent. */
export interface DocumentLook {
  readonly kind: "document";
  /** Its address. */
  readonly source: string;
  /** The application whose page it is, when the tool that rendered it names one. */
  readonly application?: string;
  /** What the page holds, a line each. */
  readonly excerpt: readonly string[];
}

/** What an agent looks at when it acts, as the side of a session draws it. */
export type Look = CodeLook | DocumentLook;

/**
 * Reads what an agent had before its eyes as the side of the session draws it.
 *
 * @param look - What the action looked at: the file the agent handed the tool, or the page the tool rendered.
 * @param tool - The tool of the action, which names the application of a page.
 * @returns The file as code, the page as a document.
 */
export function lookOf(look: ActionLook, tool: string): Look {
  if (look.kind === "file") return { kind: "code", file: look.name, lines: look.lines };
  const application = applicationOf(tool);
  return { kind: "document", source: look.name, ...(application === undefined ? {} : { application }), excerpt: look.lines };
}

/**
 * Titles a look by what it shows, as its panel heads it.
 *
 * @param look - The look.
 * @returns Its title — « Fichier de test » or « Page consultée » — and what it is: the path of the file, or the
 * application and the address of the page.
 */
export function lookTitleOf(look: Look): readonly [title: string, subtitle: string] {
  if (look.kind === "code") return ["Fichier de test", look.file];
  return ["Page consultée", look.application === undefined ? look.source : `${look.application} · ${look.source}`];
}
