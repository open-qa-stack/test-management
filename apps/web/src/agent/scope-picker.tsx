import { useState, type ReactNode } from "react";
import { t } from "../i18n/i18n.ts";
import { levelName } from "../i18n/vocabulary.ts";
import { Icon } from "../ui/icon.tsx";
import type { ScopeChoices } from "./scope-choices.ts";

/** A choice of a menu of the scope: what the form sends, and what the person reads. */
interface Option {
  readonly value: string;
  readonly label: string;
  readonly hint?: string;
}

/** What a menu of the scope needs. */
interface ScopeMenuProps {
  /** The name of the field each ticked option sends. */
  readonly name: string;
  readonly title: string;
  /** What the menu says when nothing is ticked: every option is taken. */
  readonly every: string;
  /** What the menu says when it has no option. */
  readonly none: string;
  readonly options: readonly Option[];
  readonly disabled: boolean;
  /** The options chosen, every one for none. */
  readonly chosen: readonly string[];
  /** Changes the options chosen. */
  readonly onChoose: (chosen: readonly string[]) => void;
}

/** A menu of the scope: a chip that says what is taken, which opens on a list to tick, every option when none is ticked. */
function ScopeMenu({ name, title, every, none, options, disabled, chosen, onChoose: setChosen }: ScopeMenuProps): ReactNode {
  if (options.length === 0)
    return (
      <span className="chip scope-chip muted" title={none}>
        {title} <b>{none}</b>
      </span>
    );
  const labels = options.filter(({ value }) => chosen.includes(value)).map(({ label }) => label);
  const said = labels.length === 0 ? every : labels.length <= 2 ? labels.join(", ") : t("sessionScope.chosen", { count: labels.length });
  return (
    <details className="scope-menu">
      <summary className={chosen.length === 0 ? "chip scope-chip" : "chip scope-chip chosen"} aria-disabled={disabled}>
        {title} <b>{said}</b>
        <Icon name="chevron" size={12} />
      </summary>
      <div className="scope-panel" role="group" aria-label={title}>
        <button type="button" className="btn sm" onClick={() => setChosen([])} disabled={disabled || chosen.length === 0}>
          {every}
        </button>
        {options.map(({ value, label, hint }) => (
          <label key={value} className="check scope-option">
            <input
              type="checkbox"
              name={name}
              value={value}
              checked={chosen.includes(value)}
              disabled={disabled}
              onChange={(event) => setChosen(event.currentTarget.checked ? [...chosen, value] : chosen.filter((kept) => kept !== value))}
            />
            <span>
              {label}
              {hint !== undefined && <small className="muted"> — {hint}</small>}
            </span>
          </label>
        ))}
      </div>
    </details>
  );
}

/** What the person chose of the scope, by the name of its part: the applications, the domains and the levels. */
type Chosen = Readonly<Record<"application" | "domain" | "level", readonly string[]>>;

/** The scope as nothing chose any of it yet: every application, domain and level. */
const NOTHING: Chosen = { application: [], domain: [], level: [] };

/**
 * The scope in a few words, as a phone shows it folded: the whole project, or what was chosen of it, then the
 * environment.
 */
function summaryOf(choices: ScopeChoices, chosen: Chosen, environment: string | undefined): string {
  const names = (values: readonly string[], options: readonly Option[]) => options.filter(({ value }) => values.includes(value)).map(({ label }) => label);
  const parts = [
    ...names(
      chosen.application,
      choices.applications.map(({ id, name }) => ({ value: id, label: name })),
    ),
    ...names(
      chosen.domain,
      choices.domains.map(({ id, label }) => ({ value: id, label })),
    ),
    ...chosen.level.map(levelName),
  ];
  return [parts.length === 0 ? t("sessionScope.whole") : parts.join(", "), environment].filter((part) => part !== undefined).join(" · ");
}

/**
 * What of the project a session is kept to, under the request: the environment, then the applications, the domains of the
 * knowledge and the levels of the pyramid of tests, each every one until some are ticked. A phone folds them under
 * the scope in a few words, which « Modifier » unfolds.
 */
export function ScopePicker({ choices, disabled }: { readonly choices: ScopeChoices; readonly disabled: boolean }): ReactNode {
  const { environments, applications, domains, levels } = choices;
  const [chosen, setChosen] = useState<Chosen>(NOTHING);
  const [environment, setEnvironment] = useState(environments[0]);
  const [open, setOpen] = useState(false);
  const choose = (name: keyof Chosen) => (values: readonly string[]) => setChosen({ ...chosen, [name]: values });
  return (
    <div className="scope-picker" role="group" aria-label={t("sessionScope.label")}>
      <div className="scope-head">
        <span className="scope-label">{t("sessionScope.title")}</span>
        <span className="scope-summary">{summaryOf(choices, chosen, environment)}</span>
        <button type="button" className="scope-edit" aria-expanded={open} aria-controls="scope-parts" onClick={() => setOpen(!open)}>
          {t(open ? "sessionScope.close" : "sessionScope.edit")}
        </button>
      </div>
      <div id="scope-parts" className={open ? "scope-parts open" : "scope-parts"}>
        {environments.length > 1 ? (
          <label className="chip scope-chip">
            {t("sessionScope.environment")}{" "}
            <select name="environment" disabled={disabled} defaultValue={environments[0]} onChange={(event) => setEnvironment(event.currentTarget.value)}>
              {environments.map((one) => (
                <option key={one} value={one}>
                  {one}
                </option>
              ))}
            </select>
          </label>
        ) : (
          environments.map((one) => (
            <span key={one} className="chip scope-chip">
              <input type="hidden" name="environment" value={one} />
              {t("sessionScope.environment")} <b>{one}</b>
            </span>
          ))
        )}
        <ScopeMenu
          name="application"
          title={t("sessionScope.applications")}
          every={t("sessionScope.everyApplication")}
          none={t("sessionScope.noApplication")}
          options={applications.map(({ id, name }) => ({ value: id, label: name }))}
          disabled={disabled}
          chosen={chosen.application}
          onChoose={choose("application")}
        />
        <ScopeMenu
          name="domain"
          title={t("sessionScope.domains")}
          every={t("sessionScope.everyDomain")}
          none={t("sessionScope.noDomain")}
          options={domains.map(({ id, label, description }) => ({ value: id, label, hint: description }))}
          disabled={disabled}
          chosen={chosen.domain}
          onChoose={choose("domain")}
        />
        <ScopeMenu
          name="level"
          title={t("sessionScope.levels")}
          every={t("sessionScope.everyLevel")}
          none={t("sessionScope.noLevel")}
          options={levels.map((level) => ({ value: level, label: levelName(level) }))}
          disabled={disabled}
          chosen={chosen.level}
          onChoose={choose("level")}
        />
      </div>
    </div>
  );
}
