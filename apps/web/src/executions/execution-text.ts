import type { Campaign, Execution, ExecutionOrigin, Session, TestLaunch } from "@open-qa-stack/domain/sessions";
import { durationText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { originName } from "../i18n/vocabulary.ts";

/**
 * How long the tests of an execution took together.
 *
 * @param execution - The execution.
 * @returns The duration, in the words of the person.
 */
export function executionDuration(execution: Pick<Execution, "results">): string {
  return durationText(execution.results.reduce((sum, result) => sum + result.durationMs, 0));
}

/**
 * The session that ran an execution, among those the console knows.
 *
 * @param execution - The execution.
 * @param sessions - The sessions of the project the console listed.
 * @returns What was asked of it; `undefined` for an execution no known session ran.
 */
export function requestOf(execution: Pick<Execution, "sessionId">, sessions: readonly Session[]): string | undefined {
  return sessions.find((session) => session.id === execution.sessionId)?.request;
}

/**
 * What an execution ran, in a few words: the session that asked for it, the campaign it was launched for, or how many tests it ran.
 *
 * @param execution - The execution.
 * @param sessions - The sessions of the project the console listed.
 * @param campaigns - The campaigns of the project the console listed, which name the one of an execution launched for it.
 * @returns The words.
 */
export function contentText(execution: Execution, sessions: readonly Session[], campaigns: readonly Pick<Campaign, "id" | "name">[] = []): string {
  const request = requestOf(execution, sessions);
  const campaign = campaigns.find(({ id }) => id === execution.campaignId);
  if (campaign !== undefined) return t("executions.campaignNamed", { name: campaign.name, count: execution.results.length });
  if (execution.campaignId !== undefined) return t("executions.campaign", { count: execution.results.length });
  return request === undefined ? t("executions.tests", { count: execution.results.length }) : t("executions.session", { request });
}

/** Where the execution a launch that runs will keep comes from, by the campaign it was launched for. */
export function launchOrigin(campaign: string | undefined): ExecutionOrigin {
  return campaign === undefined ? "manual" : "campaign";
}

/**
 * What a launch of tests runs, in a few words: where it comes from, with the name of its campaign, and the environment.
 *
 * @param launch - The launch.
 * @param campaigns - The campaigns of the project the console listed.
 * @returns The words.
 */
export function launchText({ campaign, environment }: TestLaunch, campaigns: readonly Pick<Campaign, "id" | "name" | "targetVersion">[]): string {
  const name = campaigns.find(({ id }) => id === campaign)?.name;
  const where = environmentText({ environment, ...(campaign === undefined ? {} : { campaignId: campaign }) }, campaigns);
  return [originName(launchOrigin(campaign)), name, where].filter((part) => part !== undefined).join(" · ");
}

/**
 * The environment an execution ran against, with the version the campaign it was launched for tests.
 *
 * @param execution - The execution, or a launch that runs.
 * @param campaigns - The campaigns of the project the console listed.
 * @returns The words; `undefined` when neither is known.
 */
export function environmentText(
  { environment, campaignId }: Pick<Execution, "environment" | "campaignId">,
  campaigns: readonly Pick<Campaign, "id" | "targetVersion">[],
): string | undefined {
  const version = campaigns.find(({ id }) => id === campaignId)?.targetVersion;
  const known = [environment, version].filter((part) => part !== undefined);
  return known.length === 0 ? undefined : known.join(" · ");
}
