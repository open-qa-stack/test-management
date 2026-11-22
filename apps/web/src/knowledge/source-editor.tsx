import type { ReactNode } from "react";
import { DraftForm } from "../configuration/draft-form.tsx";
import type { ConfigurationControls } from "../configuration/configuration-screen.tsx";
import type { ConfigurationState } from "../configuration/configuration-state.ts";
import { KnowledgeCard } from "../configuration/knowledge-card.tsx";

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
  const { draft } = state;
  const source = draft?.knowledge[rank];
  if (draft === undefined || source === undefined) return null;
  return (
    <DraftForm state={state} controls={controls}>
      <KnowledgeCard
        source={source}
        rank={rank}
        applications={draft.applications}
        onCheck={controls.checkSource}
        removable={removable}
        documentsLink={false}
        {...(state.sourceChecks?.[rank] === undefined ? {} : { test: state.sourceChecks[rank] })}
      />
    </DraftForm>
  );
}
