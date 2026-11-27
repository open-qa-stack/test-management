import type { FormEventHandler, ReactNode } from "react";
import { LESSON_TARGETS, MAX_LESSON, type MemoryItem } from "@open-qa-stack/domain/sessions";
import { applicationIds, applicationName } from "../applications/application-names.ts";
import { t } from "../i18n/i18n.ts";
import { SidePanel } from "../ui/side-panel.tsx";

/** The identifier of the form of the panel, which its foot submits. */
const FORM = "memory-panel";

/** What the panel of a line of the memory is drawn from. */
export interface MemoryPanelProps {
  /** The line to adjust; none for an instruction to add. */
  readonly item?: MemoryItem;
  /** The link that closes the panel. */
  readonly close: string;
  /** What submits the form; none for a static rendering. */
  readonly onSubmit?: FormEventHandler<HTMLFormElement>;
  /** Whether a change is under way. */
  readonly pending: boolean;
  /** Why the instance refused the last change, when it did. */
  readonly refusal?: string;
}

/**
 * The panel that adds an instruction for the agents, or adjusts a line of their memory: what they must keep in mind,
 * the application it is kept to or the whole project, the work it is for, and whether it applies. What an agent noted
 * is for every work and every application: only what it says and whether it applies are changed.
 *
 * @param props - The line, the link that closes the panel, what submits the form, and where the change stands.
 * @returns The panel.
 */
export function MemoryPanel({ item, close, onSubmit, pending, refusal }: MemoryPanelProps): ReactNode {
  const noted = item?.type === "inferred";
  const footer = (
    <>
      <a className="btn ghost" href={close}>
        {t("memory.panel.cancel")}
      </a>
      <button type="submit" form={FORM} className="btn primary" disabled={pending || onSubmit === undefined}>
        {t(pending ? "memory.panel.saving" : "memory.panel.save")}
      </button>
    </>
  );
  return (
    <SidePanel id="memory-panel-title" title={t(item === undefined ? "memory.panel.add" : "memory.panel.adjust")} close={close} footer={footer}>
      <form id={FORM} className="memory-form" onSubmit={onSubmit}>
        {item !== undefined && <p className="small muted">{t(`memory.types.${item.type}`)}</p>}
        <div className="config-field">
          <label htmlFor="memory-text">{t("memory.panel.text")}</label>
          <textarea id="memory-text" name="text" rows={4} maxLength={MAX_LESSON} required defaultValue={item?.text} aria-describedby="memory-text-hint" />
          <span id="memory-text-hint" className="field-hint">
            {t("memory.panel.textHint")}
          </span>
        </div>
        {!noted && (
          <>
            <div className="config-field">
              <label htmlFor="memory-application">{t("memory.panel.scope")}</label>
              <select id="memory-application" name="application" defaultValue={item?.application ?? ""}>
                <option value="">{t("memory.panel.project")}</option>
                {applicationIds().map((id) => (
                  <option key={id} value={id}>
                    {t("memory.panel.application", { name: applicationName(id) })}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="config-group">
              <legend>{t("memory.panel.target")}</legend>
              {LESSON_TARGETS.map((target) => (
                <label key={target} className="check">
                  <input type="radio" name="target" value={target} defaultChecked={(item?.target ?? "design") === target} />
                  <span>{t(`memory.targets.${target}`)}</span>
                </label>
              ))}
            </fieldset>
          </>
        )}
        <label className="check">
          <input type="checkbox" name="active" defaultChecked={item?.active ?? true} aria-describedby="memory-active-hint" />
          <span>{t("memory.panel.active")}</span>
        </label>
        <span id="memory-active-hint" className="field-hint">
          {t("memory.panel.activeHint")}
        </span>
        {refusal !== undefined && (
          <p className="memory-refusal small" role="alert">
            {refusal}
          </p>
        )}
      </form>
    </SidePanel>
  );
}
