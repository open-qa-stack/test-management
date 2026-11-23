import type { ReactNode } from "react";
import { t } from "../i18n/i18n.ts";
import { EditContext } from "./configuration-edit.ts";
import { ErrorSummary, Notes, type ConfigurationControls } from "./configuration-screen.tsx";
import { isPending, shownErrors, type ConfigurationState } from "./configuration-state.ts";
import { SaveBar } from "./save-bar.tsx";

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
  const { saving } = state;
  const errors = shownErrors(state);
  const pending = isPending(state);
  return (
    <EditContext.Provider
      value={{
        change: controls.change,
        click: controls.click,
        errors,
        // The form of an item is drawn once there is a draft, which holds the item.
        draft: state.draft!,
        values: state.values,
        ...(state.secrets === undefined ? {} : { secrets: state.secrets }),
        checkAddress: controls.checkAddress,
        ...(state.addressChecks === undefined ? {} : { addressChecks: state.addressChecks }),
      }}
    >
      <form id={ITEM_FORM} className="config-form" onSubmit={controls.save} noValidate>
        <Notes state={state} />
        <ErrorSummary errors={errors} draft={state.draft} />
        {children}
        <SaveBar saving={saving} pending={pending} saved={t("configuration.item.saved")} discard={controls.discard} />
      </form>
    </EditContext.Provider>
  );
}
