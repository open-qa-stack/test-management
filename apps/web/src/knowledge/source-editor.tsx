import type { ReactNode } from "react";
import { EditContext } from "../configuration/configuration-edit.ts";
import { ErrorSummary, Notes, type ConfigurationControls } from "../configuration/configuration-screen.tsx";
import { isPending, type ConfigurationState } from "../configuration/configuration-state.ts";
import { KnowledgeCard } from "../configuration/knowledge-card.tsx";
import { t } from "../i18n/i18n.ts";

/** The form of a source, which its buttons submit. */
export const SOURCE_FORM = "source-form";

/** What the editor of a source is drawn from. */
export interface SourceEditorProps {
  /** The draft of the configuration, which holds the source. */
  readonly state: ConfigurationState;
  readonly controls: ConfigurationControls;
  /** The rank of the source in the draft. */
  readonly rank: number;
  /** Whether the card offers to remove the source from the draft: a source being added, which is the last. */
  readonly removable?: boolean;
}

/**
 * A source of the configuration, as the person changes it: its fields, its test, and what saves it as a revision of
 * its own, or drops the change. Nothing else of the configuration is shown, and nothing else of it changes.
 *
 * @param props - The draft, what the person does to it, and the rank of the source.
 * @returns The editor; nothing before the instance told the configuration.
 */
export function SourceEditor({ state, controls, rank, removable = false }: SourceEditorProps): ReactNode {
  const { draft, errors, saving } = state;
  const source = draft?.knowledge[rank];
  if (draft === undefined || source === undefined) return null;
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
      <form id={SOURCE_FORM} className="config-form" onSubmit={controls.save} noValidate>
        <Notes state={state} />
        <ErrorSummary errors={errors} />
        <KnowledgeCard
          source={source}
          rank={rank}
          applications={draft.applications}
          onCheck={controls.checkSource}
          removable={removable}
          {...(state.sourceChecks?.[rank] === undefined ? {} : { test: state.sourceChecks[rank] })}
        />
        <div className="config-head">
          <span className="small muted config-state" role="status">
            {saving ? t("configuration.screen.saving") : pending ? t("configuration.screen.unsaved") : t("knowledge.edit.saved")}
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
