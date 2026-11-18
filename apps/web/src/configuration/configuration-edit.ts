import { createContext, type ChangeEventHandler, type MouseEventHandler } from "react";
import type { ConfigError } from "@open-qa-stack/domain/sessions";
import type { ConfigurationAction } from "./configuration-state.ts";

/** What the fields of the configuration share: what reads what the person did, and the errors the instance found. */
export interface ConfigurationEdit {
  /** Reads a change of a field, named by its pointer, and applies it. */
  readonly change: ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;
  /** Reads a press of a button that adds or removes an item, and applies it. */
  readonly click: MouseEventHandler<HTMLButtonElement>;
  /** The errors of the draft, each where it is. */
  readonly errors: readonly ConfigError[];
}

/** What a field outside an edit does with what the person does to it: nothing. */
export function ignore(): void {}

/** The edit of the fields outside a screen that holds a draft: nothing is applied, and no error is found. */
export const NO_EDIT: ConfigurationEdit = { change: ignore, click: ignore, errors: [] };

/** The edit the fields of the screen of the configuration are in. */
export const EditContext = createContext<ConfigurationEdit>(NO_EDIT);

/** How a field reads what the person typed: a text, a number, a choice, a member of a set, or a level of autonomy. */
export type FieldKind = "text" | "number" | "choice" | "member" | "level";

/** What a field holds when the person changed it. */
export interface ChangedField {
  /** The JSON Pointer of the field, its name. */
  readonly name: string;
  readonly value: string;
  readonly checked: boolean;
  /** How the field reads its value. */
  readonly kind: FieldKind;
  /** For a member of a set, the member the box stands for. */
  readonly member?: string;
  /** For a member of a set, the members the set holds when the draft leaves it out, separated by commas. */
  readonly defaults?: string;
}

/**
 * Reads what the person did to a field as a change of the draft.
 *
 * @param field - The field, as it is now.
 * @returns The change: an empty text, number or choice leaves the key out.
 */
export function actionOf(field: ChangedField): ConfigurationAction {
  const { name: pointer, value, checked, kind } = field;
  switch (kind) {
    case "member":
      return {
        type: "toggle",
        pointer,
        member: field.member!,
        on: checked,
        defaults: field.defaults === undefined || field.defaults === "" ? [] : field.defaults.split(","),
      };
    case "level":
      return { type: "level", level: value === "bounded" ? "bounded" : "autonomous" };
    case "number":
      return { type: "edit", pointer, value: value === "" ? undefined : Number(value) };
    default:
      return { type: "edit", pointer, value: value === "" ? undefined : value };
  }
}

/**
 * Names the element of a field after where it is in the document.
 *
 * @param pointer - The JSON Pointer of the field.
 * @returns An identifier of the page.
 */
export function idOf(pointer: string): string {
  return `config${pointer.replace(/[^A-Za-z0-9]+/g, "-")}`;
}

/**
 * What a button adds to a list: the fields each kind of item needs, empty, which the checks of the instance then
 * ask for.
 */
export const NEW_ITEMS = {
  application: { id: "", name: "", type: "web", authentication: { method: "none" }, environments: [{ name: "", uiUrl: "" }] },
  environment: { name: "" },
  api: { name: "", baseUrl: "" },
  account: { name: "", usernameEnv: "", passwordEnv: "" },
  attachment: { application: "" },
  openapi: { id: "", type: "openapi", url: "", attachments: [{ application: "" }] },
  postgresql: { id: "", type: "postgresql", connectionStringEnv: "", attachments: [{ application: "" }] },
  document: { id: "", type: "document", path: "", attachments: [{ application: "" }] },
  stored: { id: "", type: "document", stored: true, attachments: [{ application: "" }] },
  "source-code": { id: "", type: "source-code", path: "", attachments: [{ application: "" }] },
  logs: { id: "", type: "logs", path: "", attachments: [{ application: "" }] },
} as const;

/** A kind of item a button adds. */
export type NewItem = keyof typeof NEW_ITEMS;

/** What a button that adds or removes an item says, in its attributes. */
export interface PressedButton {
  /** For a button that adds an item, the list it adds to. */
  readonly add?: string;
  /** For a button that adds an item, its kind. */
  readonly item?: string;
  /** For a button that removes an item, the item. */
  readonly remove?: string;
}

/**
 * Reads the press of a button as a change of the draft.
 *
 * @param button - What the button says.
 * @returns The change; `undefined` for a button that says none.
 */
export function pressOf({ add, item, remove }: PressedButton): ConfigurationAction | undefined {
  if (remove !== undefined) return { type: "remove", pointer: remove };
  if (add === undefined || item === undefined || !Object.hasOwn(NEW_ITEMS, item)) return undefined;
  return { type: "add", pointer: add, item: NEW_ITEMS[item as NewItem] };
}
