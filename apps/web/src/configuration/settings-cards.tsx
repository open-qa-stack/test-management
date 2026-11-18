import type { ReactNode } from "react";
import type { OqasConfig, TestLevel } from "@open-qa-stack/domain/sessions";
import { Card } from "../ui/card.tsx";
import { CheckField, ChoiceField, InputField, PlaceErrors } from "./configuration-fields.tsx";
import { LEVELS } from "./configuration-words.ts";

/** The levels a plan is asked for when the configuration names none. */
const DEFAULT_LEVELS: readonly TestLevel[] = ["smoke", "functional", "business"];

const PROVIDERS = [{ value: "openai", label: "Serveur compatible OpenAI" }];

const AUTONOMIES = [
  { value: "autonomous", label: "Autonome : aucune limite par tâche" },
  { value: "bounded", label: "Bornée : des limites pour chaque tâche" },
];

/**
 * The model the agents call: its server, its name, the variable that holds its key, what it can do and how much
 * it reasons.
 *
 * @param props - The model of the draft.
 * @returns Its card.
 */
export function ModelCard({ model }: { readonly model: OqasConfig["model"] }): ReactNode {
  return (
    <Card title="Modèle" hint="le serveur que les agents appellent">
      <div className="config-body config-fields">
        <ChoiceField pointer="/model/provider" label="Fournisseur" value={model.provider} options={PROVIDERS} />
        <InputField pointer="/model/baseUrl" label="Adresse du serveur" value={model.baseUrl} code placeholder="https://" />
        <InputField pointer="/model/model" label="Modèle" value={model.model} code />
        <InputField
          pointer="/model/apiKeyEnv"
          label="Variable de la clé"
          value={model.apiKeyEnv}
          code
          hint="Le nom de la variable d’environnement qui tient la clé ; la clé n’est jamais écrite ici."
        />
        <InputField
          pointer="/model/reasoningEffort"
          label="Effort de raisonnement"
          value={model.reasoningEffort}
          hint="Un mot du serveur, tel que low ou high ; rien n’est envoyé sans."
        />
        <InputField
          pointer="/model/requestTimeoutSeconds"
          label="Attente d’une réponse, en secondes"
          value={model.requestTimeoutSeconds}
          numeric
          placeholder="120"
        />
        <CheckField
          pointer="/model/capabilities"
          member="vision"
          label="Lit les images"
          hint="les agents voient les captures des écrans"
          checked={model.capabilities?.includes("vision") === true}
        />
      </div>
    </Card>
  );
}

/**
 * How far the agents go on their own: autonomous, or bounded for each task, and the guardrail of a run.
 *
 * @param props - The autonomy of the draft; autonomous when it names none.
 * @returns Its card.
 */
export function AutonomyCard({ autonomy = { level: "autonomous" } }: { readonly autonomy?: OqasConfig["autonomy"] }): ReactNode {
  return (
    <Card title="Autonomie" hint="jusqu’où vont les agents seuls">
      <div className="config-body config-fields">
        <ChoiceField pointer="/autonomy/level" kind="level" label="Niveau" value={autonomy.level} options={AUTONOMIES} />
        <InputField
          pointer="/autonomy/guardrailMinutes"
          label="Garde-fou d’un run, en minutes"
          value={autonomy.guardrailMinutes}
          numeric
          placeholder={autonomy.level === "autonomous" ? "120" : "aucun"}
          hint="Au-delà, les tâches des agents s’arrêtent."
        />
        {autonomy.level === "bounded" && (
          <>
            <InputField pointer="/autonomy/task/maxMinutes" label="Minutes par tâche" value={autonomy.task.maxMinutes} numeric />
            <InputField pointer="/autonomy/task/maxIterations" label="Appels au modèle par tâche" value={autonomy.task.maxIterations} numeric />
            <InputField pointer="/autonomy/task/maxActions" label="Actions du navigateur par tâche" value={autonomy.task.maxActions} numeric />
            <PlaceErrors pointer="/autonomy/task" />
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * The levels of the pyramid of tests a plan is asked for.
 *
 * @param props - The design of the draft.
 * @returns Its card.
 */
export function DesignCard({ design }: { readonly design: OqasConfig["design"] }): ReactNode {
  const levels = design?.levels ?? DEFAULT_LEVELS;
  return (
    <Card title="Niveaux de conception" hint="de la base de la pyramide à son sommet">
      <fieldset className="config-body config-group">
        <legend className="sr-only">Niveaux de tests demandés à un plan</legend>
        {LEVELS.map(({ level, label, hint }) => (
          <CheckField
            key={level}
            pointer="/design/levels"
            member={level}
            defaults={DEFAULT_LEVELS}
            label={label}
            hint={hint}
            checked={levels.includes(level)}
          />
        ))}
        <PlaceErrors pointer="/design/levels" />
      </fieldset>
    </Card>
  );
}

/**
 * Where the tests and the state go in the test repository, each folder relative to its root.
 *
 * @param props - The layout of the draft; the defaults stand in the fields it leaves out.
 * @returns Its card.
 */
export function RepositoryCard({ repository = {} }: { readonly repository?: OqasConfig["repository"] }): ReactNode {
  return (
    <Card title="Organisation du dépôt" hint="chaque dossier relatif à la racine du dépôt de tests">
      <div className="config-body config-fields">
        <InputField pointer="/repository/appsDir" label="Dossier des applications" value={repository.appsDir} code placeholder="apps" />
        <InputField pointer="/repository/blocksDir" label="Dossier des blocs" value={repository.blocksDir} code placeholder="blocs" />
        <InputField pointer="/repository/journeysDir" label="Dossier des parcours" value={repository.journeysDir} code placeholder="parcours" />
        <InputField pointer="/repository/stateDir" label="Dossier d’état" value={repository.stateDir} code placeholder=".oqas" />
        <InputField pointer="/repository/indexDir" label="Dossier de l’index" value={repository.indexDir} code placeholder=".oqas/index" />
      </div>
    </Card>
  );
}
