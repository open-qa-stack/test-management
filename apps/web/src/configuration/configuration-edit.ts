import { createContext, type ChangeEventHandler, type MouseEventHandler } from "react";
import type { ConfigError, OqasConfig, SecretState } from "@open-qa-stack/domain/sessions";
import type { AddressTest, ConfigurationAction } from "./configuration-state.ts";

/** What the fields of the configuration share: what reads what the person did, and the errors the instance found. */
export interface ConfigurationEdit {
  /** Reads a change of a field, named by its pointer, and applies it. */
  readonly change: ChangeEventHandler<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;
  /** Reads a press of a button that adds or removes an item, and applies it. */
  readonly click: MouseEventHandler<HTMLButtonElement>;
  /** The errors of the draft, each where it is. */
  readonly errors: readonly ConfigError[];
  /** The variables the configuration in force names, and where the value of each comes from; none before the instance told them. */
  readonly secrets?: readonly SecretState[];
  /** The values the person typed, by the name of their variable, which are saved with the configuration. */
  readonly values: Readonly<Record<string, string>>;
  /** The configuration as the person is changing it, which words the errors of the fields left empty. */
  readonly draft?: OqasConfig;
  /** Tests the address of the field the button names by its pointer; none where addresses are not tested. */
  readonly checkAddress?: MouseEventHandler<HTMLButtonElement>;
  /** The latest test of each address, by the pointer of its field. */
  readonly addressChecks?: Readonly<Record<string, AddressTest>>;
}

/** What a field outside an edit does with what the person does to it: nothing. */
export function ignore(): void {}

/** The edit of the fields outside a screen that holds a draft: nothing is applied, and no error is found. */
export const NO_EDIT: ConfigurationEdit = { change: ignore, click: ignore, errors: [], values: {} };

/** The edit the fields of the screen of the configuration are in. */
export const EditContext = createContext<ConfigurationEdit>(NO_EDIT);

/**
 * How a field reads what the person typed: a text, a number, a choice, a member of a set, a level of autonomy, the
 * value of a variable, or the reach of a knowledge source.
 */
export type FieldKind = "text" | "number" | "choice" | "member" | "flag" | "level" | "connection" | "secret" | "reach" | "role";

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
  /** For the value of a variable, the name of the variable. */
  readonly variable?: string;
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
    case "flag":
      // A flag is true when left out: only false is written.
      return { type: "edit", pointer, value: checked ? undefined : false };
    case "level":
      return { type: "level", level: value === "bounded" ? "bounded" : "autonomous" };
    case "connection":
      return { type: "connection", choice: value };
    case "secret":
      return { type: "value", name: field.variable!, value };
    case "reach":
      // A source of the whole project has no attachment; one of applications starts with an application to choose.
      return { type: "edit", pointer, value: value === "project" ? undefined : [{ application: "" }] };
    case "role":
      // A role without a model of its own uses that of every one; another model takes over nothing tuned on the former.
      return { type: "edit", pointer, value: value === "" ? undefined : { model: value } };
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
  openapi: { id: "", type: "openapi", url: "" },
  postgresql: { id: "", type: "postgresql", connectionStringEnv: "" },
  document: { id: "", type: "document", path: "" },
  stored: { id: "", type: "document", stored: true },
  "source-code": { id: "", type: "source-code", path: "" },
  logs: { id: "", type: "logs", path: "" },
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
  /** For a button that sets a value, where it goes. */
  readonly set?: string;
  /** For a button that sets a value, the value, as JSON. */
  readonly value?: string;
}

/**
 * Reads the press of a button as a change of the draft: an item added or removed, or a value set.
 *
 * @param button - What the button says.
 * @returns The change; `undefined` for a button that says none.
 */
export function pressOf({ add, item, remove, set, value }: PressedButton): ConfigurationAction | undefined {
  if (remove !== undefined) return { type: "remove", pointer: remove };
  if (set !== undefined && value !== undefined) return { type: "edit", pointer: set, value: JSON.parse(value) as unknown };
  if (add === undefined || item === undefined || !Object.hasOwn(NEW_ITEMS, item)) return undefined;
  return { type: "add", pointer: add, item: NEW_ITEMS[item as NewItem] };
}
