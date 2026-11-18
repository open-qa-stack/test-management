import { isRecord } from "../../json.ts";
import type { Remark } from "./step.ts";

/** A field of an entry, when it is a text that says something. */
function said(entry: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = entry[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** A remark of a finding — what is wrong, where, by which rule, about the test or its plan — or of a duplicate — which scenario, of what, why. */
function remarkOf(entry: Readonly<Record<string, unknown>>): Remark | undefined {
  const text = said(entry, "what") ?? said(entry, "reason");
  if (text === undefined) return undefined;
  const where = said(entry, "where");
  const rule = said(entry, "rule");
  const concerns = said(entry, "concerns");
  const scenario = said(entry, "id");
  const of = said(entry, "of");
  return {
    text,
    ...(where === undefined ? {} : { where }),
    ...(rule === undefined ? {} : { rule }),
    ...(concerns === undefined ? {} : { concerns }),
    ...(scenario === undefined || of === undefined ? {} : { duplicate: { scenario, of } }),
  };
}

/**
 * Reads the remarks a reviewer hands in with its verdict: the call that reports them holds a list of findings,
 * or of duplicates.
 *
 * @param args - The arguments of a call of a reviewer.
 * @returns Its remarks, each that says something, in order; `undefined` for a call that holds no such list,
 * which is no verdict: a reviewer may read before it reports.
 */
export function remarksOf(args: unknown): Remark[] | undefined {
  const list = isRecord(args) ? (args["findings"] ?? args["duplicates"]) : undefined;
  if (!Array.isArray(list)) return undefined;
  return list.flatMap((entry: unknown) => {
    const remark = isRecord(entry) ? remarkOf(entry) : undefined;
    return remark === undefined ? [] : [remark];
  });
}
