import { Box, Text } from "ink";
import { createElement as h, type ReactNode } from "react";
import type { Remark, ReviewStep } from "@open-qa-stack/domain/sessions";
import { Marked } from "./marked.ts";
import { SpeakerHead } from "./speaker-head.ts";
import type { Theme } from "./palette.ts";
import type { Block } from "./thread-blocks.ts";

/** What the verdict of a reviewer needs. */
export interface ReviewBlockProps {
  readonly block: Extract<Block, { kind: "review" }>;
  readonly theme: Theme;
}

/** The plural of a count, as `2 remarks`. */
function counted(count: number, one: string): string {
  return `${count} ${one}${count === 1 ? "" : "s"}`;
}

/** What a reviewer looked at, and what it came to: none found, a count, not taken yet, or not taken. */
function summaryOf(step: ReviewStep): string {
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

/**
 * The verdict of a reviewer, under its name: what it reviewed and what it came to, then each remark in full,
 * where it is first. The call it was handed in with, and the word the reviewer replied, are not written.
 *
 * @param props - The block and the theme.
 * @returns The lines.
 */
export function ReviewBlock({ block, theme }: ReviewBlockProps): ReactNode {
  const { step } = block;
  const muted = theme.ink("muted");
  return h(
    Box,
    { flexDirection: "column", marginTop: 1 },
    h(SpeakerHead, { speaker: step.from, after: `${theme.glyphs.separator} ${summaryOf(step)}`, theme }),
    ...step.remarks.map((remark, index) => {
      const place = placeOf(remark);
      return h(Marked, { key: index, mark: "-", style: muted }, h(Text, null, place === "" ? null : h(Text, { bold: true }, `${place}: `), remark.text));
    }),
  );
}
