import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import type { PlannedScenario } from "@open-qa-stack/domain/sessions";
import { Marked } from "./marked.ts";
import type { Theme } from "./palette.ts";
import type { Block } from "./thread-blocks.ts";
import { t } from "./i18n/i18n.ts";

/** What the plan the harness accepted needs. */
export interface PlanBlockProps {
  readonly block: Extract<Block, { kind: "plan" }>;
  readonly theme: Theme;
}

/** Texts as a list of quoted texts, as the screen shows each. */
function quoted(texts: readonly string[]): string {
  return texts.map((text) => JSON.stringify(text)).join(", ");
}

/** The facts of a scenario after its title, on one line: what it checks, what it does to the data, its domain and functionality. */
function factsOf(scenario: PlannedScenario): string {
  const domain = [scenario.domain, scenario.feature].filter((part) => part !== undefined).join("/");
  return [scenario.kind, scenario.effect, domain === "" ? undefined : domain].filter((part) => part !== undefined && part !== "").join(" · ");
}

/** A labelled line of a scenario. */
function labelled(label: string, text: string, theme: Theme): ReactNode {
  return h(Text, null, h(Text, theme.ink("muted"), `${label}: `), text);
}

/**
 * A scenario of the plan, in full: its level, its title, its case and application on its line, then what it
 * verifies, its facts, its sources and its data, and each step with what it expects — the texts the screen shows,
 * and those it no longer shows. A scenario of a thread written before the plan told more has its line alone.
 */
function Scenario({ scenario, rank, theme }: { readonly scenario: PlannedScenario; readonly rank: number; readonly theme: Theme }): ReactNode {
  const muted = theme.ink("muted");
  const between = ` ${theme.glyphs.separator} `;
  const place = [scenario.case, scenario.application].filter((part) => part !== undefined).join(between);
  const facts = factsOf(scenario);
  const sources = scenario.sources?.map(({ source, item }) => (item === undefined ? source : `${source} ${item}`)) ?? [];
  const data = scenario.data?.map(({ value, from }) => `${JSON.stringify(value)} (${from})`) ?? [];
  return h(
    Box,
    { flexDirection: "column" },
    h(
      Text,
      null,
      `${rank}. `,
      h(Text, muted, `${scenario.level} `),
      h(Text, { bold: true }, scenario.title),
      place === "" ? null : h(Text, muted, `${between}${place}`),
    ),
    h(
      Marked,
      null,
      scenario.intent === undefined ? null : h(Text, null, scenario.intent),
      facts === "" ? null : h(Text, muted, `${scenario.id}${between}${facts}`),
      sources.length === 0 ? null : labelled(t("plan.sources"), sources.join(", "), theme),
      scenario.data === undefined ? null : labelled(t("plan.data"), data.length === 0 ? t("plan.noData") : data.join(", "), theme),
      ...(scenario.steps ?? []).map((step, index) =>
        h(
          Box,
          { key: index, flexDirection: "column" },
          h(Text, null, h(Text, muted, t("plan.step", { number: index + 1 })), step.action, step.restores === true ? h(Text, muted, t("plan.restores")) : null),
          ...step.expects.map((expect, at) =>
            h(
              Marked,
              { key: at, mark: theme.glyphs.arrow, style: muted },
              h(Text, null, expect.result),
              expect.shows.length === 0 ? null : labelled(t("plan.shows"), quoted(expect.shows), theme),
              expect.absent.length === 0 ? null : labelled(t("plan.absent"), quoted(expect.absent), theme),
            ),
          ),
        ),
      ),
    ),
  );
}

/**
 * The plan the harness accepted, set apart from the turns of the agents: its title and how many scenarios, then
 * each scenario in full, nothing cut, since a terminal folds nothing.
 *
 * @param props - The block and the theme.
 * @returns The lines.
 */
export function PlanBlock({ block, theme }: PlanBlockProps): ReactNode {
  const { step } = block;
  const count = t("plan.scenarios", { count: step.scenarios.length });
  return h(
    Box,
    { flexDirection: "column", marginTop: 1 },
    h(
      Marked,
      { mark: theme.glyphs.passed, style: theme.ink("ok") },
      h(Text, null, h(Text, { bold: true }, step.title), h(Text, theme.ink("muted"), ` ${theme.glyphs.separator} ${count}`)),
      ...step.scenarios.map((scenario, index) => h(Scenario, { key: index, scenario, rank: index + 1, theme })),
    ),
  );
}
