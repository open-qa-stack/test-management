import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import type { Remark, ReviewStep, VerdictStep } from "@open-qa-stack/domain/sessions";
import { Marked } from "./marked.ts";
import { SpeakerHead } from "./speaker-head.ts";
import type { Theme } from "./palette.ts";
import type { Block } from "./thread-blocks.ts";

/** What a verdict needs. */
export interface VerdictBlockProps {
  readonly block: Extract<Block, { kind: "verdict" | "review" }>;
  readonly theme: Theme;
}

/** The plural of a count, as `2 remarks`. */
function counted(count: number, one: string): string {
  return `${count} ${one}${count === 1 ? "" : "s"}`;
}

/** What a verdict of the harness came to, and what it is about: its gate, its phase, its scenario, its tool. */
function harnessSummary(step: VerdictStep, between: string): string {
  // A thread tells the refusals of the harness, and the errors the work hit: what it accepts is told by what follows.
  const verdict = step.code === undefined ? "error" : "refused";
  const about = [
    step.code,
    step.about,
    step.scenario === undefined ? undefined : `scenario ${step.scenario}`,
    step.tool === undefined ? undefined : `tool ${step.tool}`,
  ];
  return [verdict, ...about.filter((part) => part !== undefined)].join(` ${between} `);
}

/** What a reviewer looked at, and what it came to: none found, a count, not taken yet, or not taken. */
function reviewSummary(step: ReviewStep): string {
  const reviewed = step.scenario === undefined ? "reviewed the plan" : `reviewed the test of ${step.scenario}`;
  const found = step.from === "plan_reviewer" ? "duplicate" : "remark";
  const verdict = step.remarks.length === 0 ? `no ${found}` : counted(step.remarks.length, found);
  const state = step.refused === true ? ", not taken by the harness" : step.pending === true ? ", handing it in" : "";
  return `${reviewed}: ${verdict}${state}`;
}

/** Where a remark is and what it breaks, before what it says: the scenario a duplicate is and what it repeats, the place, the rule, a plan it concerns. */
function placeOf(remark: Remark): string {
  const parts = [
    remark.duplicate === undefined ? undefined : `${remark.duplicate.scenario} repeats ${remark.duplicate.of}`,
    remark.where,
    remark.rule === undefined ? undefined : `(${remark.rule})`,
    remark.concerns === "plan" ? "[plan]" : undefined,
  ];
  return parts.filter((part) => part !== undefined).join(" ");
}

/** What a verdict of the harness says under its head: what was refused, why and what to do, then the page it quotes, in full. */
function harnessBody(step: VerdictStep, theme: Theme): ReactNode[] {
  const muted = theme.ink("muted");
  return [
    h(
      Marked,
      { key: "reason" },
      step.subject === undefined ? null : h(Text, { bold: true }, step.subject),
      h(Text, null, step.reason),
      ...(step.page === undefined
        ? []
        : [
            h(Text, { key: "at", ...muted }, `The page was at ${step.page.name}:`),
            ...step.page.lines.map((line, index) => h(Text, { key: index, ...muted }, line)),
          ]),
    ),
  ];
}

/** The remarks of a reviewer under its head, each in full, where it is first. */
function reviewBody(step: ReviewStep, theme: Theme): ReactNode[] {
  const muted = theme.ink("muted");
  return step.remarks.map((remark, index) => {
    const place = placeOf(remark);
    return h(Marked, { key: index, mark: "-", style: muted }, h(Text, null, place === "" ? null : h(Text, { bold: true }, `${place}: `), remark.text));
  });
}

/**
 * A verdict, whoever gave it, in one form: its author under its mark, the kind of judge it is — the harness, an
 * automatic check, or an agent that reviews — and what it came to and is about, on one line; then what it says in
 * full. The call a reviewer handed its verdict in with, and the word it replied, are not written.
 *
 * @param props - The block and the theme.
 * @returns The lines.
 */
export function VerdictBlock({ block, theme }: VerdictBlockProps): ReactNode {
  const between = theme.glyphs.separator;
  const head =
    block.kind === "verdict"
      ? h(SpeakerHead, { speaker: "harness", after: `${between} automatic check ${between} ${harnessSummary(block.step, between)}`, theme })
      : h(SpeakerHead, { speaker: block.step.from, after: `${between} agent ${between} ${reviewSummary(block.step)}`, theme });
  return h(
    Box,
    { flexDirection: "column", marginTop: 1 },
    head,
    ...(block.kind === "verdict" ? harnessBody(block.step, theme) : reviewBody(block.step, theme)),
  );
}
