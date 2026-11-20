import { useState, type ReactNode } from "react";
import { t } from "../i18n/i18n.ts";
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
}

/** A menu of the scope: a chip that says what is taken, which opens on a list to tick, every option when none is ticked. */
function ScopeMenu({ name, title, every, none, options, disabled }: ScopeMenuProps): ReactNode {
  const [chosen, setChosen] = useState<readonly string[]>([]);
  if (options.length === 0)
    return (
      <span className="chip scope-chip muted" title={none}>
        {title} : {none}
      </span>
    );
  const labels = options.filter(({ value }) => chosen.includes(value)).map(({ label }) => label);
  const said = labels.length === 0 ? every : labels.length <= 2 ? labels.join(", ") : t("sessionScope.chosen", { count: labels.length });
  return (
    <details className="scope-menu">
      <summary className={chosen.length === 0 ? "chip scope-chip" : "chip scope-chip chosen"} aria-disabled={disabled}>
        {title} : <b>{said}</b>
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

/**
 * What of the project a session is kept to, under the request: the environment, then the applications, the domains of the
 * knowledge and the levels of the pyramid of tests, each every one until some are ticked.
 */
export function ScopePicker({ choices, disabled }: { readonly choices: ScopeChoices; readonly disabled: boolean }): ReactNode {
  const { environments, applications, domains, levels } = choices;
  return (
    <div className="scope-picker" role="group" aria-label={t("sessionScope.label")}>
      {environments.length > 1 ? (
        <label className="chip scope-chip">
          {t("sessionScope.environment")} :{" "}
          <select name="environment" disabled={disabled} defaultValue={environments[0]}>
            {environments.map((environment) => (
              <option key={environment} value={environment}>
                {environment}
              </option>
            ))}
          </select>
        </label>
      ) : (
        environments.map((environment) => (
          <span key={environment} className="chip scope-chip">
            <input type="hidden" name="environment" value={environment} />
            {t("sessionScope.environment")} : <b>{environment}</b>
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
      />
      <ScopeMenu
        name="domain"
        title={t("sessionScope.domains")}
        every={t("sessionScope.everyDomain")}
        none={t("sessionScope.noDomain")}
        options={domains.map(({ id, label, description }) => ({ value: id, label, hint: description }))}
        disabled={disabled}
      />
      <ScopeMenu
        name="level"
        title={t("sessionScope.levels")}
        every={t("sessionScope.everyLevel")}
        none={t("sessionScope.noLevel")}
        options={levels.map((level) => ({ value: level, label: t(`sessionScope.levelNames.${level}`) }))}
        disabled={disabled}
      />
    </div>
  );
}
