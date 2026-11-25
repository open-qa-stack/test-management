import type { FormEventHandler, ReactNode } from "react";
import type { KnowledgeDomain } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { SidePanel } from "../ui/side-panel.tsx";
import type { DomainChanging } from "./discovery-screen.tsx";

/** The identifier of the form of the panel. */
const FORM = "domain-rename";

/** The name of a domain, changed in a side panel; the name the cartography gave is told, when it has another. */
export function RenamePanel({
  domain,
  close,
  changing,
  onRename,
}: {
  readonly domain: KnowledgeDomain;
  /** The link that closes the panel. */
  readonly close: string;
  readonly changing: DomainChanging;
  readonly onRename: FormEventHandler<HTMLFormElement>;
}): ReactNode {
  const footer = (
    <div className="save-bar action-bar">
      <a className="btn ghost" href={close}>
        {t("test.cancel")}
      </a>
      <button type="submit" form={FORM} className="btn primary" disabled={changing.pending}>
        {t("test.save")}
      </button>
    </div>
  );
  return (
    <SidePanel id={`${FORM}-title`} title={t("discovery.renameTitle")} close={close} footer={footer}>
      <form id={FORM} className="config-field" onSubmit={onRename}>
        <label htmlFor={`${FORM}-label`}>{t("discovery.renameLabel")}</label>
        <input id={`${FORM}-label`} name="label" required maxLength={100} defaultValue={domain.label} />
        {domain.foundLabel !== undefined && <span className="field-hint">{t("discovery.foundLabel", { label: domain.foundLabel })}</span>}
        {changing.refusal !== undefined && (
          <p className="field-error" role="alert">
            {changing.refusal}
          </p>
        )}
      </form>
    </SidePanel>
  );
}
