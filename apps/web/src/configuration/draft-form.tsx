import type { ReactNode } from "react";
import { t } from "../i18n/i18n.ts";
import { EditContext } from "./configuration-edit.ts";
import { ErrorSummary, Notes, type ConfigurationControls } from "./configuration-screen.tsx";
import { isPending, type ConfigurationState } from "./configuration-state.ts";

/** The form of one item of the configuration — a source, an application —, which its buttons submit. */
export const ITEM_FORM = "item-form";

/**
 * The form of one item of the draft of the configuration: what the instance answered, the errors of the draft, the
 * fields of the item, and what saves it as a revision of its own, or drops the change.
 *
 * @param props - The draft, what the person does to it, and the fields of the item.
 * @returns The form.
 */
export function DraftForm({
  state,
  controls,
  children,
}: {
  readonly state: ConfigurationState;
  readonly controls: ConfigurationControls;
  readonly children: ReactNode;
}): ReactNode {
  const { errors, saving } = state;
  const pending = isPending(state);
  return (
    <EditContext.Provider
      value={{
        change: controls.change,
        click: controls.click,
        errors,
        values: state.values,
        ...(state.secrets === undefined ? {} : { secrets: state.secrets }),
      }}
    >
      <form id={ITEM_FORM} className="config-form" onSubmit={controls.save} noValidate>
        <Notes state={state} />
        <ErrorSummary errors={errors} />
        {children}
        <div className="config-head">
          <span className="small muted config-state" role="status">
            {saving ? t("configuration.screen.saving") : pending ? t("configuration.screen.unsaved") : t("configuration.item.saved")}
          </span>
          <button type="button" className="btn" onClick={controls.discard} disabled={!pending || saving}>
            {t("configuration.screen.discard")}
          </button>
          <button type="submit" className="btn primary" disabled={!pending || saving}>
            {t("configuration.screen.save")}
          </button>
        </div>
      </form>
    </EditContext.Provider>
  );
}
