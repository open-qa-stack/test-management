import type { ReactNode } from "react";
import {
  DEFAULT_BATCH_TESTS,
  DEFAULT_GUARDRAIL_MINUTES,
  DEFAULT_IDLE_ROUNDS,
  DEFAULT_LANGUAGE,
  DEFAULT_TASK_MINUTES,
  LANGUAGES,
  type OqasConfig,
  type TestLevel,
} from "@open-qa-stack/domain/sessions";
import { LANGUAGE_NAMES, t } from "../i18n/i18n.ts";
import { Card } from "../ui/card.tsx";
import { AdvancedFields, CheckField, ChoiceField, InputField, PlaceErrors, RadioField } from "./configuration-fields.tsx";
import { LEVELS, levelHint, levelName } from "../i18n/vocabulary.ts";

/** The levels a plan is asked for when the configuration names none. */
const DEFAULT_LEVELS: readonly TestLevel[] = ["smoke", "functional", "business"];

/** The languages the configuration may name, each by its own name. */
const LANGUAGE_CHOICES = LANGUAGES.map((language) => ({ value: language, label: LANGUAGE_NAMES[language] }));

/**
 * How far the agents go on their own: autonomous, or bounded for each task and for the batch of tests of a run, and the guardrail
 * of a run.
 *
 * @param props - The autonomy of the draft; autonomous when it names none.
 * @returns Its card.
 */
export function AutonomyCard({
  autonomy = { level: "bounded", task: { maxMinutes: DEFAULT_TASK_MINUTES } },
}: {
  readonly autonomy?: OqasConfig["autonomy"];
}): ReactNode {
  return (
    <Card title={t("configuration.settings.autonomy.title")} hint={t("configuration.settings.autonomy.hint")}>
      <div className="config-body">
        <div className="config-fields">
          <RadioField
            pointer="/autonomy/level"
            kind="level"
            label={t("configuration.settings.autonomy.level")}
            value={autonomy.level}
            options={[
              { value: "bounded", label: t("configuration.settings.bounded") },
              { value: "autonomous", label: t("configuration.settings.autonomous") },
            ]}
          />
        </div>
        {/* The limits are an expert's: the level says how far the agents go, and the defaults hold. */}
        <AdvancedFields pointers={["/autonomy/guardrailMinutes", "/autonomy/task", "/autonomy/batch"]}>
          <InputField
            pointer="/autonomy/guardrailMinutes"
            label={t("configuration.settings.autonomy.guardrail")}
            value={autonomy.guardrailMinutes}
            numeric
            placeholder={String(DEFAULT_GUARDRAIL_MINUTES)}
            hint={t("configuration.settings.autonomy.guardrailHint")}
          />
          {autonomy.level === "bounded" && (
            <>
              <InputField
                pointer="/autonomy/task/maxMinutes"
                label={t("configuration.settings.autonomy.maxMinutes")}
                value={autonomy.task.maxMinutes}
                numeric
              />
              <InputField
                pointer="/autonomy/task/maxIterations"
                label={t("configuration.settings.autonomy.maxIterations")}
                value={autonomy.task.maxIterations}
                numeric
              />
              <InputField
                pointer="/autonomy/task/maxActions"
                label={t("configuration.settings.autonomy.maxActions")}
                value={autonomy.task.maxActions}
                numeric
              />
              <PlaceErrors pointer="/autonomy/task" />
              <InputField
                pointer="/autonomy/batch/maxTests"
                label={t("configuration.settings.autonomy.maxTests")}
                value={autonomy.batch?.maxTests}
                numeric
                placeholder={String(DEFAULT_BATCH_TESTS)}
                hint={t("configuration.settings.autonomy.maxTestsHint")}
              />
              <InputField
                pointer="/autonomy/batch/maxIdleRounds"
                label={t("configuration.settings.autonomy.maxIdleRounds")}
                value={autonomy.batch?.maxIdleRounds}
                numeric
                placeholder={String(DEFAULT_IDLE_ROUNDS)}
                hint={t("configuration.settings.autonomy.maxIdleRoundsHint")}
              />
            </>
          )}
        </AdvancedFields>
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
    <Card title={t("configuration.settings.design.title")} hint={t("configuration.settings.design.hint")}>
      <fieldset className="config-body config-group">
        <legend className="sr-only">{t("configuration.settings.design.legend")}</legend>
        {LEVELS.map((level) => (
          <CheckField
            key={level}
            pointer="/design/levels"
            member={level}
            defaults={DEFAULT_LEVELS}
            label={levelName(level)}
            hint={levelHint(level)}
            checked={levels.includes(level)}
          />
        ))}
        <PlaceErrors pointer="/design/levels" />
      </fieldset>
    </Card>
  );
}

/**
 * The languages of the product: the one it speaks to the person in, the console and the agents alike, and the one
 * of what the tests say.
 *
 * @param props - The configuration of the draft; English where it names none.
 * @returns Its card.
 */
export function LanguageCard({ config }: { readonly config: OqasConfig }): ReactNode {
  return (
    <Card title={t("configuration.settings.languages.title")} hint={t("configuration.settings.languages.hint")}>
      <div className="config-body config-fields">
        <ChoiceField
          pointer="/language"
          label={t("configuration.settings.languages.language")}
          hint={t("configuration.settings.languages.languageHint")}
          value={config.language ?? DEFAULT_LANGUAGE}
          options={LANGUAGE_CHOICES}
        />
        <ChoiceField
          pointer="/design/testLanguage"
          label={t("configuration.settings.languages.testLanguage")}
          hint={t("configuration.settings.languages.testLanguageHint")}
          value={config.design?.testLanguage ?? DEFAULT_LANGUAGE}
          options={LANGUAGE_CHOICES}
        />
      </div>
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
    <Card title={t("configuration.settings.repository.title")} hint={t("configuration.settings.repository.hint")}>
      <div className="config-body">
        <div className="config-fields">
          <InputField pointer="/repository/appsDir" label={t("configuration.settings.repository.appsDir")} value={repository.appsDir} code placeholder="apps" />
        </div>
        {/* The other folders are an expert's: their defaults hold. */}
        <AdvancedFields pointers={["/repository/blocksDir", "/repository/journeysDir", "/repository/stateDir", "/repository/knowledgeDir"]}>
          <InputField
            pointer="/repository/blocksDir"
            label={t("configuration.settings.repository.blocksDir")}
            value={repository.blocksDir}
            code
            placeholder="blocs"
          />
          <InputField
            pointer="/repository/journeysDir"
            label={t("configuration.settings.repository.journeysDir")}
            value={repository.journeysDir}
            code
            placeholder="parcours"
          />
          <InputField
            pointer="/repository/stateDir"
            label={t("configuration.settings.repository.stateDir")}
            value={repository.stateDir}
            code
            placeholder=".oqas"
          />
          <InputField
            pointer="/repository/knowledgeDir"
            label={t("configuration.settings.repository.knowledgeDir")}
            value={repository.knowledgeDir}
            code
            placeholder=".oqas/knowledge"
          />
        </AdvancedFields>
      </div>
    </Card>
  );
}
