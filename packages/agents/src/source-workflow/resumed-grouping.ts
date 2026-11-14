import type { SourceManifest } from "@open-qa-stack/shared";
import type { SourceExport } from "@open-qa-stack/tools";
import { Grouping } from "./grouping.ts";

/** Where the grouping of a source starts from, given what an earlier run left. */
export interface ResumedGrouping {
  /** The grouping, with the elements that did not change where the earlier run left them. */
  readonly grouping: Grouping;
  /** The domain each changed element was in, by name of the element. */
  readonly former: ReadonlyMap<string, string>;
}

/**
 * Starts the grouping of a source from the manifest of an earlier run.
 *
 * @remarks
 * An element whose fingerprint is the one of the manifest stays in its domain, or set aside, as it was. An
 * element that changed, is new or was left unplaced is to be placed again; one that left the source is
 * forgotten. Every domain of the manifest is remembered, so that an element may go back to it.
 *
 * @param previous - The manifest of the earlier run; none when there is none to start from.
 * @param exported - The export of the source, as it is now.
 * @returns The grouping to go on with, and the former domain of the elements that changed.
 */
export function resumedGrouping(previous: SourceManifest | undefined, exported: SourceExport): ResumedGrouping {
  const grouping = new Grouping();
  const former = new Map<string, string>();
  const domains = new Map((previous?.domains ?? []).map(({ id, label, description }) => [id, { id, label, description }]));
  for (const domain of domains.values()) grouping.remember(domain);
  const before = new Map((previous?.elements ?? []).map((element) => [element.name, element]));
  for (const { name, fingerprint } of exported.elements) {
    const was = before.get(name);
    if (was?.domain !== undefined && was.fingerprint !== fingerprint) former.set(name, was.domain);
    if (was?.fingerprint !== fingerprint) continue;
    if (was.domain !== undefined) grouping.place(name, domains.get(was.domain)!, was.role!);
    else if (was.dismissed !== undefined) grouping.dismiss(name, was.dismissed);
  }
  return { grouping, former };
}
