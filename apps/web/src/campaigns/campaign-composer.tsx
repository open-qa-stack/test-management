import type { ReactNode } from "react";
import type { RepositoryTest } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../api/polled-state.ts";
import { t } from "../i18n/i18n.ts";
import { Badge } from "../ui/badge.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { facetsOf, filteredTests, testKey, type CompositionFilter } from "./campaign-composition.ts";

/** What the composition of a campaign needs: the tests of the repository, what narrows them, what is chosen, and what changes it. */
export interface ComposerProps {
  readonly tests: PolledState<readonly RepositoryTest[]>;
  readonly filter: CompositionFilter;
  /** The keys of the tests chosen, as the person ticked them. */
  readonly chosen: ReadonlySet<string>;
  /** Whether the choice differs from the one the instance keeps. */
  readonly changed: boolean;
  /** Whether the choice is being kept by the instance. */
  readonly saving: boolean;
  readonly onFilter: (filter: CompositionFilter) => void;
  /** Ticks or unticks tests, by their keys. */
  readonly onTick: (keys: readonly string[], ticked: boolean) => void;
  readonly onSave: () => void;
}

/** A list to narrow the tests by one criterion: every value, or one of those the tests bear. */
function Criterion({
  label,
  every,
  values,
  value,
  onChange,
}: {
  readonly label: string;
  readonly every: string;
  readonly values: readonly string[];
  readonly value: string | undefined;
  readonly onChange: (value: string | undefined) => void;
}): ReactNode {
  return (
    <label className="campaign-composer-criterion small">
      <span className="muted">{label}</span>
      <select aria-label={label} value={value ?? ""} onChange={(event) => onChange(event.currentTarget.value === "" ? undefined : event.currentTarget.value)}>
        <option value="">{every}</option>
        {values.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A test of the repository, which the person ticks to choose it. */
function TestRow({ test, ticked, onTick }: { readonly test: RepositoryTest; readonly ticked: boolean; readonly onTick: ComposerProps["onTick"] }): ReactNode {
  const facets = [test.level, test.domain, ...test.applications].filter((facet) => facet !== undefined);
  return (
    <label className={ticked ? "row campaign-composer-test ticked" : "row campaign-composer-test"}>
      <input type="checkbox" checked={ticked} onChange={(event) => onTick([testKey(test)], event.currentTarget.checked)} />
      <span className="grow">
        <b>{test.title}</b>
        <span className="small muted mono campaign-path">{test.path}</span>
        <span className="campaign-composer-facets">
          {facets.map((facet) => (
            <Badge key={facet} tone="outline">
              {facet}
            </Badge>
          ))}
        </span>
      </span>
    </label>
  );
}

/**
 * The composition of a planned campaign: the tests of the repository, narrowed by words, level, domain, application and
 * tag, each ticked to choose it, those shown ticked or unticked at once, then the choice kept by the instance.
 */
export function CampaignComposer({ tests, filter, chosen, changed, saving, onFilter, onTick, onSave }: ComposerProps): ReactNode {
  const listed = tests.value;
  if (listed === undefined)
    return (
      <EmptyState title={t("campaignComposer.reading")}>
        <span role="status">{tests.unread ?? t("campaignComposer.readingNote")}</span>
      </EmptyState>
    );
  if (listed.length === 0) return <EmptyState title={t("campaignComposer.none")}>{t("campaignComposer.noneNote")}</EmptyState>;
  const facets = facetsOf(listed);
  const shown = filteredTests(listed, filter, chosen);
  const keys = shown.map(testKey);
  const set = (change: Partial<CompositionFilter>): void => onFilter({ ...filter, ...change });
  return (
    <section className="card campaign-composer" aria-label={t("campaignComposer.title")}>
      <div className="campaign-composer-head">
        <h2 className="campaign-plan-title">{t("campaignComposer.title")}</h2>
        <span className="small" role="status">
          {t("campaignComposer.chosen", { count: chosen.size, total: listed.length })}
        </span>
      </div>
      <div className="campaign-composer-filters">
        <label className="campaign-composer-criterion campaign-composer-words small">
          <span className="muted">{t("campaignComposer.search")}</span>
          <input
            type="search"
            value={filter.words}
            placeholder={t("campaignComposer.searchPlaceholder")}
            onChange={(event) => set({ words: event.currentTarget.value })}
          />
        </label>
        <Criterion
          label={t("campaignComposer.level")}
          every={t("campaignComposer.every")}
          values={facets.levels}
          value={filter.level}
          onChange={(level) => set({ level })}
        />
        <Criterion
          label={t("campaignComposer.domain")}
          every={t("campaignComposer.every")}
          values={facets.domains}
          value={filter.domain}
          onChange={(domain) => set({ domain })}
        />
        <Criterion
          label={t("campaignComposer.application")}
          every={t("campaignComposer.every")}
          values={facets.applications}
          value={filter.application}
          onChange={(application) => set({ application })}
        />
        <Criterion
          label={t("campaignComposer.tag")}
          every={t("campaignComposer.every")}
          values={facets.tags}
          value={filter.tag}
          onChange={(tag) => set({ tag })}
        />
        <label className="check small">
          <input type="checkbox" checked={filter.chosenOnly} onChange={(event) => set({ chosenOnly: event.currentTarget.checked })} />
          {t("campaignComposer.chosenOnly")}
        </label>
      </div>
      <div className="campaign-composer-bulk small">
        <span className="muted">{t("campaignComposer.shown", { count: shown.length })}</span>
        <button type="button" className="btn sm" disabled={keys.every((key) => chosen.has(key))} onClick={() => onTick(keys, true)}>
          {t("campaignComposer.tickShown")}
        </button>
        <button type="button" className="btn sm" disabled={keys.every((key) => !chosen.has(key))} onClick={() => onTick(keys, false)}>
          {t("campaignComposer.untickShown")}
        </button>
      </div>
      <div className="campaign-composer-list">
        {shown.length === 0 ? (
          <p className="small muted campaign-composer-empty">{t("campaignComposer.noMatch")}</p>
        ) : (
          shown.map((test) => <TestRow key={testKey(test)} test={test} ticked={chosen.has(testKey(test))} onTick={onTick} />)
        )}
      </div>
      <div className="campaign-composer-foot">
        <span className="small muted">{changed ? t("campaignComposer.unsaved") : t("campaignComposer.saved")}</span>
        <button type="button" className="btn primary" disabled={!changed || saving} onClick={onSave}>
          {saving ? t("campaignComposer.saving") : t("campaignComposer.save", { count: chosen.size })}
        </button>
      </div>
    </section>
  );
}
