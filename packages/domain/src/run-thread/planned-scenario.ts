import { isRecord } from "../json.ts";
import type { PlannedExpect, PlannedScenario, PlannedSource, PlannedStep, PlannedValue } from "../sessions/session-event.ts";

/** The fields of an object read from JSON. */
type Fields = Readonly<Record<string, unknown>>;

/** A field, when it is a text. */
function text(fields: Fields, name: string): string | undefined {
  const value = fields[name];
  return typeof value === "string" ? value : undefined;
}

/** A text field, as an entry of what is told: nothing when it is no text. */
function told(fields: Fields, name: string): Readonly<Record<string, string>> {
  const value = text(fields, name);
  return value === undefined ? {} : { [name]: value };
}

/** The objects of a field that is a list, each read by `read`, those it cannot read left out; `undefined` when the field is no list. */
function listOf<Item>(fields: Fields, name: string, read: (entry: Fields) => Item | undefined): Item[] | undefined {
  const list = fields[name];
  if (!Array.isArray(list)) return undefined;
  return list.flatMap((entry: unknown) => {
    const item = isRecord(entry) ? read(entry) : undefined;
    return item === undefined ? [] : [item];
  });
}

/** The texts of a field that is a list, what is no text left out. */
function textsOf(fields: Fields, name: string): string[] {
  const list = fields[name];
  return Array.isArray(list) ? list.filter((entry: unknown) => typeof entry === "string") : [];
}

/** A source of a scenario; `undefined` without its identifier. */
function sourceOf(entry: Fields): PlannedSource | undefined {
  const source = text(entry, "source");
  return source === undefined ? undefined : { source, ...told(entry, "item") };
}

/** A value of the data of a scenario; `undefined` without the value or what showed it. */
function valueOf(entry: Fields): PlannedValue | undefined {
  const value = text(entry, "value");
  const from = text(entry, "from");
  return value === undefined || from === undefined ? undefined : { value, from };
}

/** What a step expects; `undefined` without its result. */
function expectOf(entry: Fields): PlannedExpect | undefined {
  const result = text(entry, "result");
  return result === undefined ? undefined : { result, shows: textsOf(entry, "shows"), absent: textsOf(entry, "absent") };
}

/** A step of a scenario; `undefined` without its action. */
function stepOf(entry: Fields): PlannedStep | undefined {
  const action = text(entry, "action");
  if (action === undefined) return undefined;
  return { action, expects: listOf(entry, "expects", expectOf) ?? [], ...(entry["restores"] === true ? { restores: true } : {}) };
}

/** A list field of a scenario, as an entry of what is told: nothing when it is no list. */
function listed<Item>(fields: Fields, name: string, read: (entry: Fields) => Item | undefined): Readonly<Record<string, Item[]>> {
  const list = listOf(fields, name, read);
  return list === undefined ? {} : { [name]: list };
}

/**
 * Reads a scenario an agent proposed in a plan, as the contract of sessions tells it: all the plan says of it that
 * a person reads — what it verifies, its sources, its data, its steps and what each expects — and not the numbers
 * of the browser actions it cites, which only the harness reads.
 *
 * @param proposed - A scenario of the arguments of a call that proposes a plan.
 * @param level - The level of the pass, for a scenario that names none.
 * @returns The scenario; `undefined` when it bears no identifier, or no level of its own in a pass that names none.
 */
export function plannedScenarioOf(proposed: unknown, level: string | undefined): PlannedScenario | undefined {
  if (!isRecord(proposed)) return undefined;
  const id = text(proposed, "id");
  const own = text(proposed, "level") ?? level;
  if (id === undefined || own === undefined) return undefined;
  return {
    id,
    title: text(proposed, "title") ?? id,
    level: own,
    ...told(proposed, "application"),
    ...told(proposed, "case"),
    ...told(proposed, "intent"),
    ...told(proposed, "kind"),
    ...told(proposed, "effect"),
    ...told(proposed, "domain"),
    ...told(proposed, "feature"),
    ...listed(proposed, "sources", sourceOf),
    ...listed(proposed, "data", valueOf),
    ...listed(proposed, "steps", stepOf),
  };
}
