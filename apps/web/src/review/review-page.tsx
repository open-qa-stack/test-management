import { useEffect, type ReactNode } from "react";
import type { TestProposal } from "@open-qa-stack/domain/sessions";
import { api } from "../api/instance-api.ts";
import type { PolledState } from "../api/polled-state.ts";
import { usePolled } from "../api/use-polled.ts";
import type { Route } from "../routing/route.ts";
import { hearShortcuts } from "../ui/shortcuts.ts";
import { reviewHref, reviewPlaceOf } from "./review-paths.ts";
import { listedTests, ReviewScreen, shownTest } from "./review-screen.tsx";

/**
 * The screen of the review in a browser: it keeps the queue and the test shown in step with the instance, and moves to
 * the next test with J and to the one before with K, as the address keeps it.
 *
 * @param props - The name of the project, and where the console is.
 * @returns The screen.
 */
export function ReviewPage({ project, route }: { readonly project: string; readonly route: Route }): ReactNode {
  const place = reviewPlaceOf(route);
  const queue = usePolled(() => api.reviews(), "reviews");
  const tests = queue.value === undefined ? [] : listedTests(queue.value, place);
  const shown = shownTest(tests, place);
  const read = usePolled<TestProposal | undefined>(() => (shown === undefined ? Promise.resolve(undefined) : api.proposal(shown.id)), shown?.id ?? "");
  // The answer about the test shown before is not shown on the card of another; why the instance could not read this one is.
  const proposal: PolledState<TestProposal> =
    read.value !== undefined && read.value.id === shown?.id ? { value: read.value } : read.unread === undefined ? {} : { unread: read.unread };
  useEffect(() => {
    const at = shown === undefined ? -1 : tests.indexOf(shown);
    const to = (rank: number) => () => {
      const test = tests[rank];
      if (test !== undefined) window.location.hash = reviewHref({ ...place, id: test.id });
    };
    return hearShortcuts(document, { j: to(at + 1), k: to(at - 1) });
  });
  return <ReviewScreen project={project} place={place} queue={queue} {...(shown === undefined ? {} : { proposal })} />;
}
