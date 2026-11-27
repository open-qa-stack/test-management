import { useEffect, useState, type ReactNode } from "react";
import { reviewDecisionOf, type DecidedTest, type ReviewDecision, type TestProposal } from "@open-qa-stack/domain/sessions";
import type { ApiError } from "../api/api-error.ts";
import { api } from "../api/instance-api.ts";
import type { PolledState } from "../api/polled-state.ts";
import { usePolled } from "../api/use-polled.ts";
import { t } from "../i18n/i18n.ts";
import type { Route } from "../routing/route.ts";
import { hearShortcuts } from "../ui/shortcuts.ts";
import { reviewHref, reviewPlaceOf } from "./review-paths.ts";
import { listedTests, ReviewScreen, shownTest, type ReviewControls } from "./review-screen.tsx";

/** Where a decision stands: under way, refused with why, or kept with what came of it. */
interface Deciding {
  readonly pending: boolean;
  readonly refusal?: string;
  readonly told?: string;
}

/** What is told of a decision kept. */
function toldOf({ entered }: DecidedTest): string {
  if (entered === undefined) return t("review.told.setAside");
  return t(entered.committed ? "review.told.committed" : "review.told.unchanged", { branch: entered.branch });
}

/**
 * The screen of the review in a browser: it keeps the queue and the test shown in step with the instance, moves to the
 * next test with J and to the one before with K, as the address keeps it, validates the test shown with V, and sets it
 * aside from its panel. Once a decision is kept, the queue is read again and the next test shown.
 *
 * @param props - The name of the project, and where the console is.
 * @returns The screen.
 */
export function ReviewPage({ project, route }: { readonly project: string; readonly route: Route }): ReactNode {
  const place = reviewPlaceOf(route);
  const [decided, setDecided] = useState(0);
  const [deciding, setDeciding] = useState<Deciding>({ pending: false });
  const queue = usePolled(() => api.reviews(), `reviews:${decided}`);
  const tests = queue.value === undefined ? [] : listedTests(queue.value, place);
  const shown = shownTest(tests, place);
  const read = usePolled<TestProposal | undefined>(() => (shown === undefined ? Promise.resolve(undefined) : api.proposal(shown.id)), shown?.id ?? "");
  // The answer about the test shown before is not shown on the card of another; why the instance could not read this one is.
  const proposal: PolledState<TestProposal> =
    read.value !== undefined && read.value.id === shown?.id ? { value: read.value } : read.unread === undefined ? {} : { unread: read.unread };
  const decide = (decision: ReviewDecision): void => {
    if (shown === undefined) return;
    setDeciding({ pending: true });
    api.decide(shown.id, decision).then(
      (kept) => {
        setDeciding({ pending: false, told: toldOf(kept) });
        setDecided((count) => count + 1);
        // The test leaves the view: the next one is shown, and the panel closes.
        window.location.hash = reviewHref({ view: place.view, ...(place.domain === undefined ? {} : { domain: place.domain }) });
      },
      (error: ApiError) => setDeciding({ pending: false, refusal: error.message }),
    );
  };
  const controls: ReviewControls = {
    ...deciding,
    validate: () => decide({ status: "validated" }),
    setAside: (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const decision = reviewDecisionOf({
        status: "set_aside",
        reason: form.get("reason"),
        coveredBy: form.get("coveredBy"),
        note: form.get("note"),
      });
      if (typeof decision === "string") setDeciding({ pending: false, refusal: t("review.setAside.incomplete") });
      else decide(decision);
    },
  };
  useEffect(() => {
    const at = shown === undefined ? -1 : tests.indexOf(shown);
    const to = (rank: number) => () => {
      const test = tests[rank];
      if (test !== undefined) window.location.hash = reviewHref({ ...place, id: test.id });
    };
    // V validates the test shown when it is one to review and no decision is under way.
    const validate = () => {
      if (proposal.value?.status === "in_review" && !deciding.pending) controls.validate();
    };
    return hearShortcuts(document, { j: to(at + 1), k: to(at - 1), v: validate });
  });
  return <ReviewScreen project={project} route={route} place={place} queue={queue} controls={controls} {...(shown === undefined ? {} : { proposal })} />;
}
