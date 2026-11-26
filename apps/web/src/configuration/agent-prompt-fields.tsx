import { useContext, type ReactNode } from "react";
import { MAX_REPLACED_PROMPT, missingVariables, type AgentKey, type AgentPrompt, type OqasConfig } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { EditContext } from "./configuration-edit.ts";
import { TextField } from "./configuration-fields.tsx";

/** The prompts of the agents as the instance gave them: none while they are read, `failed` when they could not be. */
export type ReadPrompts = readonly AgentPrompt[] | "failed" | undefined;

/** What the fields of the prompt of an agent are drawn from. */
export interface AgentPromptFieldsProps {
  readonly agent: AgentKey;
  /** Its prompt as the code writes it, as the instance gave it. */
  readonly prompt: AgentPrompt | "failed" | undefined;
  /** What the draft says of the agents. */
  readonly agents: OqasConfig["agents"];
}

/** The variables of a prompt, each between braces, separated by commas. */
const braced = (names: readonly string[]): string => names.map((name) => `{{${name}}}`).join(", ");

/**
 * The prompt of an agent in its panel: a button that puts a prompt of the team in place of its own, which starts as a
 * copy of its own; once it is replaced, the prompt of the team, with what it may break, the variables it leaves out, and
 * whether the prompt of the agent changed since, its own prompt shown beside it, and a button that gives it back.
 *
 * @param props - The agent, its prompt and what the draft says of the agents.
 * @returns The fields.
 */
export function AgentPromptFields({ agent, prompt, agents }: AgentPromptFieldsProps): ReactNode {
  const { click } = useContext(EditContext);
  const replaced = agents?.[agent]?.prompt;
  const pointer = `/agents/${agent}/prompt`;
  if (prompt === undefined) return <p className="field-hint">{t("configuration.agents.prompt.reading")}</p>;
  if (prompt === "failed") return <p className="config-note ko">{t("configuration.agents.prompt.unread")}</p>;
  if (replaced === undefined)
    return (
      <div className="agent-prompt">
        <p className="field-hint">{t("configuration.agents.prompt.own")}</p>
        <button
          type="button"
          className="btn ghost"
          data-set={pointer}
          data-value={JSON.stringify({ text: prompt.template, basedOn: prompt.digest })}
          onClick={click}
        >
          {t("configuration.agents.prompt.replace")}
        </button>
      </div>
    );
  const missing = missingVariables(replaced.text, prompt.variables);
  const former = replaced.basedOn !== prompt.digest;
  return (
    <div className="agent-prompt">
      <p className="config-note warn" role="note">
        {t("configuration.agents.prompt.warning")}
      </p>
      {former && (
        <div className="config-note warn" role="status">
          <p>{t("configuration.agents.prompt.former")}</p>
          <button type="button" className="btn sm ghost" data-set={`${pointer}/basedOn`} data-value={JSON.stringify(prompt.digest)} onClick={click}>
            {t("configuration.agents.prompt.caughtUp")}
          </button>
        </div>
      )}
      <TextField
        pointer={`${pointer}/text`}
        label={t("configuration.agents.prompt.label")}
        hint={t("configuration.agents.prompt.variables", { variables: braced(prompt.variables) })}
        value={replaced.text}
        max={MAX_REPLACED_PROMPT}
      />
      {missing.length > 0 && (
        <p className="config-note warn" role="status">
          {t("configuration.agents.prompt.missing", { variables: braced(missing) })}
        </p>
      )}
      <details className="config-json" open={former}>
        <summary>{t(former ? "configuration.agents.prompt.changed" : "configuration.agents.prompt.default")}</summary>
        <pre className="mono">{prompt.template}</pre>
      </details>
      <button type="button" className="btn ghost" data-remove={pointer} onClick={click}>
        {t("configuration.agents.prompt.reset")}
      </button>
    </div>
  );
}
