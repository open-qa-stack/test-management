import { useContext, type ReactNode } from "react";
import type { SecretKind } from "@open-qa-stack/domain/sessions";
import { EditContext, idOf, type NewItem } from "./configuration-edit.ts";
import { t } from "../i18n/i18n.ts";
import { errorText } from "./configuration-words.ts";

/** What every field shows: where it is, its label, and what helps fill it. */
interface FieldBase {
  /** The JSON Pointer of what the field holds. */
  readonly pointer: string;
  readonly label: string;
  /** What helps fill it, under the field: the label and the field stand on the same lines across a row of fields. */
  readonly hint?: string;
}

/** The errors the instance found at a field, and the elements under the field that describe it: its hint, its errors. */
function useDescription(pointer: string, hint: string | undefined): { readonly texts: readonly string[]; readonly described?: string } {
  const { errors, draft } = useContext(EditContext);
  const texts = errors.filter(({ path }) => path === pointer).map((error) => errorText(error, draft));
  const ids = [...(hint === undefined ? [] : [`${idOf(pointer)}-hint`]), ...(texts.length === 0 ? [] : [`${idOf(pointer)}-errors`])];
  return ids.length === 0 ? { texts } : { texts, described: ids.join(" ") };
}

/** What stands under a field: its hint, then the errors the instance found there. */
function FieldNotes({ pointer, hint, texts }: { readonly pointer: string; readonly hint: string | undefined; readonly texts: readonly string[] }): ReactNode {
  return (
    <>
      {hint !== undefined && (
        <span id={`${idOf(pointer)}-hint`} className="field-hint">
          {hint}
        </span>
      )}
      {texts.length > 0 && (
        <span id={`${idOf(pointer)}-errors`} className="field-error">
          {texts.join(" ")}
        </span>
      )}
    </>
  );
}

/** What a field that takes a text or a number shows. */
export interface InputFieldProps extends FieldBase {
  /** What the draft holds there; nothing when it leaves the key out. */
  readonly value: string | number | undefined;
  /** A number, or a text by default. */
  readonly numeric?: boolean;
  /** What stands in the field while it is empty: the default, when the configuration has one. */
  readonly placeholder?: string;
  /** Whether what the field holds is a name or an address, set in the type of code. */
  readonly code?: boolean;
}

/**
 * A field that takes a text or a number, with the errors the instance found there.
 *
 * @param props - Where it is, its label and what it holds.
 * @returns The field.
 */
export function InputField({ pointer, label, hint, value, numeric = false, placeholder, code = false }: InputFieldProps): ReactNode {
  const { change } = useContext(EditContext);
  const { texts, described } = useDescription(pointer, hint);
  const id = idOf(pointer);
  return (
    <div className="config-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={pointer}
        type={numeric ? "number" : "text"}
        data-kind={numeric ? "number" : "text"}
        className={code ? "mono" : undefined}
        value={value === undefined ? "" : String(value)}
        onChange={change}
        aria-invalid={texts.length > 0}
        spellCheck={false}
        autoComplete="off"
        {...(numeric ? { min: 1, step: 1, inputMode: "numeric" as const } : {})}
        {...(placeholder === undefined ? {} : { placeholder })}
        {...(described === undefined ? {} : { "aria-describedby": described })}
      />
      <FieldNotes pointer={pointer} hint={hint} texts={texts} />
    </div>
  );
}

/** What a list of choices shows. */
export interface ChoiceFieldProps extends FieldBase {
  readonly value: string | undefined;
  /** The choices, each its value and its label. */
  readonly options: readonly { readonly value: string; readonly label: string }[];
  /** The label of the choice that leaves the key out, for a key that has a default; none for a key the configuration requires. */
  readonly none?: string;
  /** How the choice is read: a level of autonomy, or a value by default. */
  readonly kind?: "choice" | "level" | "connection" | "reach";
}

/**
 * A list of choices, with the errors the instance found there.
 *
 * @param props - Where it is, its label, its choices and the one made.
 * @returns The field.
 */
export function ChoiceField({ pointer, label, hint, value, options, none, kind = "choice" }: ChoiceFieldProps): ReactNode {
  const { change } = useContext(EditContext);
  const { texts, described } = useDescription(pointer, hint);
  const id = idOf(pointer);
  return (
    <div className="config-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        name={pointer}
        data-kind={kind}
        value={value ?? ""}
        onChange={change}
        aria-invalid={texts.length > 0}
        {...(described === undefined ? {} : { "aria-describedby": described })}
      >
        {none !== undefined && <option value="">{none}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldNotes pointer={pointer} hint={hint} texts={texts} />
    </div>
  );
}

/** What a box to check shows. */
export interface CheckFieldProps extends FieldBase {
  readonly checked: boolean;
  /** The member of the set the box stands for. */
  readonly member: string;
  /** The members the set holds when the draft leaves it out. */
  readonly defaults?: readonly string[];
}

/**
 * A box to check, which stands for a member of a set, such as a level of the pyramid of tests.
 *
 * @param props - Where the set is, the member, its label and whether it is checked.
 * @returns The field.
 */
export function CheckField({ pointer, label, hint, checked, member, defaults = [] }: CheckFieldProps): ReactNode {
  const { change } = useContext(EditContext);
  const id = `${idOf(pointer)}-${member}`;
  return (
    <label className="check" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        name={pointer}
        data-kind="member"
        data-member={member}
        data-defaults={defaults.join(",")}
        checked={checked}
        onChange={change}
      />
      <span>
        {label}
        {hint !== undefined && <span className="field-hint"> — {hint}</span>}
      </span>
    </label>
  );
}

/**
 * The errors the instance found at a pointer that has no field of its own, such as a list that needs an item.
 *
 * @param props - The pointer.
 * @returns Them, or nothing when there is none.
 */
export function PlaceErrors({ pointer }: { readonly pointer: string }): ReactNode {
  const { texts } = useDescription(pointer, undefined);
  return texts.length === 0 ? null : (
    <p className="field-error" role="note">
      {texts.join(" ")}
    </p>
  );
}

/**
 * A button that adds an item to a list of the draft.
 *
 * @param props - Where the list is, the kind of item, and what the button says.
 * @returns The button.
 */
export function AddButton({ pointer, item, children }: { readonly pointer: string; readonly item: NewItem; readonly children: ReactNode }): ReactNode {
  const { click } = useContext(EditContext);
  return (
    <button type="button" className="btn sm" data-add={pointer} data-item={item} onClick={click}>
      {children}
    </button>
  );
}

/**
 * A button that removes an item of a list of the draft.
 *
 * @param props - The item, and what the button names.
 * @returns The button.
 */
export function RemoveButton({ pointer, label }: { readonly pointer: string; readonly label: string }): ReactNode {
  const { click } = useContext(EditContext);
  return (
    <button type="button" className="btn sm ghost" aria-label={label} data-remove={pointer} onClick={click}>
      {t("configuration.remove")}
    </button>
  );
}

/**
 * The choices of a list, each its value and its label.
 *
 * @param values - The values.
 * @param label - What names a value.
 * @returns The choices, in the order of the values.
 */
export function choices<const V extends string>(values: readonly V[], label: (value: V) => string): { readonly value: V; readonly label: string }[] {
  return values.map((value) => ({ value, label: label(value) }));
}

/**
 * The name of an item of a list, or its rank when it has none yet.
 *
 * @param name - The name of the item.
 * @param rank - Its rank in the list.
 * @returns The name, or the rank from one.
 */
export const nameOf = (name: string, rank: number): string => (name === "" ? String(rank + 1) : name);

/**
 * The head of an item of a list: what it is, and the button that removes it, which names it.
 *
 * @param props - What the item is called, and where it is.
 * @returns The head.
 */
export function ItemHead({ title, pointer, removal }: { readonly title: string; readonly pointer: string; readonly removal: string }): ReactNode {
  return (
    <div className="config-item-head">
      <span>{title}</span>
      <RemoveButton pointer={pointer} label={removal} />
    </div>
  );
}

/** What the field of the value of a variable is given. */
export interface SecretFieldProps {
  /** The name of the variable, as the draft names it; nothing while it names none. */
  readonly variable: string | undefined;
  /** What the variable holds. */
  readonly kind: SecretKind;
}

/**
 * The value of a variable the draft names — the key of the model, a connection string, an account of the tests —
 * which the person types beside it rather than in the environment: it is saved with the configuration, on the
 * machine of the instance and out of the test repository, and never shown again. A variable the environment of the
 * instance sets is not asked for: the environment wins, as in a CI.
 *
 * @param props - The variable, and what it holds.
 * @returns The field; nothing while the draft names no variable.
 */
export function SecretField({ variable, kind }: SecretFieldProps): ReactNode {
  const { change, secrets, values } = useContext(EditContext);
  if (variable === undefined || variable === "") return null;
  const source = secrets?.find(({ name }) => name === variable)?.source ?? "missing";
  const id = `secret-${variable}`;
  const label = t(`configuration.secret.${kind}`);
  if (source === "environment")
    return (
      <p className="config-field small muted" id={id}>
        <b>{label}</b> {t("configuration.secret.environment", { variable })}
      </p>
    );
  return (
    <div className="config-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        type={kind === "account_username" ? "text" : "password"}
        data-kind="secret"
        data-variable={variable}
        value={values[variable] ?? ""}
        onChange={change}
        spellCheck={false}
        autoComplete={kind === "account_username" ? "off" : "new-password"}
        aria-describedby={`${id}-hint`}
        {...(source === "saved" ? { placeholder: t("configuration.secret.replace") } : {})}
      />
      <span id={`${id}-hint`} className="field-hint">
        {t(source === "saved" ? "configuration.secret.saved" : "configuration.secret.kept", { variable })}
      </span>
    </div>
  );
}

/**
 * What an expert sets, folded under « Advanced »: it opens by itself when one of its fields holds an error shown, so
 * that no error stays hidden.
 *
 * @param props - The pointers of its fields, and the fields.
 * @returns The fold.
 */
export function AdvancedFields({ pointers, children }: { readonly pointers: readonly string[]; readonly children: ReactNode }): ReactNode {
  const { errors } = useContext(EditContext);
  const wrong = errors.some(({ path }) => pointers.some((pointer) => path === pointer || path.startsWith(`${pointer}/`)));
  return (
    <details className="config-advanced" {...(wrong ? { open: true } : {})}>
      <summary>{t("configuration.model.advanced")}</summary>
      <div className="config-fields">{children}</div>
    </details>
  );
}
