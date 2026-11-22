import type { ReactNode } from "react";
import { attachmentsOf } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { withPanel, type Route } from "../routing/route.ts";
import { SidePanel } from "../ui/side-panel.tsx";
import { RemoveButton } from "../configuration/configuration-fields.tsx";
import { DraftForm } from "../configuration/draft-form.tsx";
import type { ConfigurationControls } from "../configuration/configuration-screen.tsx";
import { isPending, type ConfigurationState } from "../configuration/configuration-state.ts";
import { AttachmentChoices, KnowledgeCard } from "../configuration/knowledge-card.tsx";
import { SaveBar } from "../configuration/save-bar.tsx";

/** What the editor of a source is drawn from. */
export interface SourceEditorProps {
  /** The draft of the configuration, which holds the source. */
  readonly state: ConfigurationState;
  readonly controls: ConfigurationControls;
  /** The rank of the source in the draft. */
  readonly rank: number;
  /** Where the console is, which tells the panel open. */
  readonly route: Route;
  /** Whether the card offers to remove the source from the draft: a source being added, which is the last. */
  readonly removable?: boolean;
}

/** The identifier of the title of the panel, which names it. */
const PANEL_TITLE = "source-panel-title";

/** The rank of the attachment whose panel the route opens; none otherwise. */
function attachmentOf(route: Route): number | undefined {
  const [kind, rank] = (route.query["panel"] ?? "").split(":");
  return kind === "attachment" ? Number(rank) : undefined;
}

/**
 * A source of the configuration, as the person changes it: its fields, its test, its attachments, a row each, and
 * what saves it as a revision of its own, or drops the change. An attachment is added and changed in a panel, which
 * saves the source or drops the change. Nothing else of the configuration is shown, and nothing else of it changes.
 *
 * @param props - The draft, what the person does to it, the rank of the source, and the route.
 * @returns The editor, and the panel the route opens; nothing before the instance told the configuration.
 */
export function SourceEditor({ state, controls, rank, route, removable = false }: SourceEditorProps): ReactNode {
  const { draft } = state;
  const source = draft?.knowledge[rank];
  if (draft === undefined || source === undefined) return null;
  const opened = attachmentOf(route);
  const attachment = opened === undefined ? undefined : attachmentsOf(source)[opened];
  const at = `/knowledge/${rank}/attachments/${opened}`;
  return (
    <DraftForm state={state} controls={controls}>
      <KnowledgeCard
        source={source}
        rank={rank}
        applications={draft.applications}
        onCheck={controls.checkSource}
        removable={removable}
        documentsLink={false}
        named={false}
        attachmentPanel={(index) => withPanel(route, `attachment:${index}`)}
        {...(state.sourceChecks?.[rank] === undefined ? {} : { test: state.sourceChecks[rank] })}
      />
      {attachment !== undefined && (
        <SidePanel
          id={PANEL_TITLE}
          title={t("configuration.knowledge.attachment", { rank: opened! + 1 })}
          close={withPanel(route)}
          footer={<SaveBar saving={state.saving} pending={isPending(state)} saved={t("configuration.item.saved")} discard={controls.discard} />}
        >
          <AttachmentChoices at={at} attachment={attachment} applications={draft.applications} />
          <RemoveButton pointer={at} label={t("configuration.knowledge.removeAttachment")} closes />
        </SidePanel>
      )}
    </DraftForm>
  );
}
