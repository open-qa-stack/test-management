import type { FormEventHandler, ReactNode } from "react";
import type { ReviewedTest, ReviewQueue, TestProposal } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../api/polled-state.ts";
import { t } from "../i18n/i18n.ts";
import { levelName } from "../i18n/vocabulary.ts";
import { hrefTo, withPanel, type Route } from "../routing/route.ts";
import { EmptyState } from "../ui/empty-state.tsx";
import { Icon } from "../ui/icon.tsx";
import { Page } from "../ui/page.tsx";
import { ReviewCard, type ReviewGestures } from "./review-card.tsx";
import { ReviewSetAside } from "./review-set-aside.tsx";
import { ReviewCorrect } from "./review-correct.tsx";
import { REVIEW_VIEWS, reviewHref, type ReviewPlace, type ReviewView } from "./review-paths.ts";

/** The panel of the review that sets the test shown aside, as the address names it. */
export const SET_ASIDE_PANEL = "set-aside";

/** The panel of the review that asks for the correction of the test shown, as the address names it. */
export const CORRECT_PANEL = "correct";

/** What the person does of the test shown, which a static rendering of the screen has none of. */
export interface ReviewControls {
  readonly validate: () => void;
  readonly setAside: FormEventHandler<HTMLFormElement>;
  /** Asks for the correction of the test shown, from the form of its panel. */
  readonly correct: FormEventHandler<HTMLFormElement>;
  /** Puts the test shown, set aside, back in review. */
  readonly restore: () => void;
  /** Whether a decision is under way. */
  readonly pending: boolean;
  /** Why the instance refused the last decision, when it did. */
  readonly refusal?: string;
  /** What came of the last decision, once it was kept. */
  readonly told?: string;
}

/** What the screen of the review is drawn from. */
export interface ReviewScreenProps {
  /** The name of the project. */
  readonly project: string;
  /** Where the console is, which names the panel open over the review. */
  readonly route: Route;
  /** Where the review stands, as the address keeps it. */
  readonly place: ReviewPlace;
  /** What the instance told of the queue of the review. */
  readonly queue: PolledState<ReviewQueue>;
  /** What it told of the test shown, once one is. */
  readonly proposal?: PolledState<TestProposal>;
  readonly controls?: ReviewControls;
}

/** The tests of a view, in the order of the queue. */
function inView(queue: ReviewQueue, view: ReviewView): readonly ReviewedTest[] {
  if (view === "updates") return [];
  // The tests in correction stay among the new ones, which they come back to.
  return queue.tests.filter((test) => (view === "new" ? test.status !== "set_aside" : test.status === "set_aside"));
}

/**
 * The tests a place of the review lists: those of its view, narrowed to its domain.
 *
 * @param queue - The queue of the review.
 * @param place - Where the review stands.
 * @returns The tests, in the order of the queue.
 */
export function listedTests(queue: ReviewQueue, place: ReviewPlace): readonly ReviewedTest[] {
  return inView(queue, place.view).filter((test) => place.domain === undefined || test.domain === place.domain);
}

/**
 * The test a place of the review shows: the one its address names when the list holds it, or else the first of the list.
 *
 * @param tests - The tests the place lists.
 * @param place - Where the review stands.
 * @returns The test; none for an empty list.
 */
export function shownTest(tests: readonly ReviewedTest[], place: ReviewPlace): ReviewedTest | undefined {
  return tests.find((test) => test.id === place.id) ?? tests[0];
}

/** The views of the review, each with how many tests it holds. */
function Views({ queue, place }: { readonly queue: ReviewQueue; readonly place: ReviewPlace }): ReactNode {
  const counts: Readonly<Record<ReviewView, number>> = { new: queue.counts.inReview, updates: 0, set_aside: queue.counts.setAside };
  return (
    <nav className="review-views" aria-label={t("review.views")}>
      {REVIEW_VIEWS.map((view) => (
        <a
          key={view}
          className={view === place.view ? "chip on" : "chip"}
          href={reviewHref({ view, ...(place.domain === undefined ? {} : { domain: place.domain }) })}
          aria-current={view === place.view ? "page" : undefined}
        >
          {t(`review.view.${view}`)} <span className="muted">{counts[view]}</span>
        </a>
      ))}
    </nav>
  );
}

/** The filter of the domains of a view: every domain, then each domain its tests come from. */
function Domains({ queue, place }: { readonly queue: ReviewQueue; readonly place: ReviewPlace }): ReactNode {
  const domains = [...new Set(inView(queue, place.view).map((test) => test.domain))];
  if (domains.length < 2 && place.domain === undefined) return null;
  return (
    <nav className="review-domains" aria-label={t("review.domainFilter")}>
      {[undefined, ...domains].map((domain) => (
        <a
          key={domain ?? ""}
          className={domain === place.domain ? "chip on" : "chip"}
          href={reviewHref({ view: place.view, ...(domain === undefined ? {} : { domain }) })}
          aria-current={domain === place.domain ? "page" : undefined}
        >
          {domain ?? t("review.allDomains")}
        </a>
      ))}
    </nav>
  );
}

/** A test of the list, which shows it on the card: its title, then where it comes from and how it went. */
function Row({
  test,
  place,
  rank,
  shown,
}: {
  readonly test: ReviewedTest;
  readonly place: ReviewPlace;
  readonly rank: number;
  readonly shown: boolean;
}): ReactNode {
  const detail = [test.domain, levelName(test.level), ...(test.status === "in_correction" ? [t("review.status.in_correction")] : [])].join(" · ");
  const sound = test.verdict === "passed" && test.reviewed;
  return (
    <a className={shown ? "row review-row on" : "row review-row"} href={reviewHref({ ...place, id: test.id })} aria-current={shown ? "true" : undefined}>
      <span className="small muted review-row-rank">{rank}</span>
      <span className="grow">
        <b>{test.title}</b>
        <span className="small muted review-row-detail">{detail}</span>
      </span>
      {sound && (
        <span className="review-row-sound" role="img" aria-label={t("review.sound")}>
          <Icon name="check" />
        </span>
      )}
    </a>
  );
}

function Steps({ tests, shown, place }: { readonly tests: readonly ReviewedTest[]; readonly shown: ReviewedTest; readonly place: ReviewPlace }): ReactNode {
  const at = tests.indexOf(shown);
  const before = tests[at - 1];
  const after = tests[at + 1];
  return (
    <nav className="review-steps-nav" aria-label={t("review.progress")}>
      {before === undefined ? <span /> : <a href={reviewHref({ ...place, id: before.id })}>{t("review.previous")}</a>}
      <span className="small muted">{t("review.position", { at: at + 1, count: tests.length })}</span>
      {after === undefined ? <span /> : <a href={reviewHref({ ...place, id: after.id })}>{t("review.next")}</a>}
    </nav>
  );
}

/** The card of the test shown, once the instance told it, or why it cannot be read. */
function Shown({ proposal, gestures }: { readonly proposal: PolledState<TestProposal> | undefined; readonly gestures?: ReviewGestures }): ReactNode {
  if (proposal?.value !== undefined) return <ReviewCard proposal={proposal.value} {...(gestures === undefined ? {} : { gestures })} />;
  return (
    <p className="card review-card small muted" role="status">
      {proposal?.unread ?? t("review.reading")}
    </p>
  );
}

/** What a view says when it lists nothing: all reviewed, no update yet, nothing set aside, or nothing for the domain. */
function Nothing({ place }: { readonly place: ReviewPlace }): ReactNode {
  if (place.domain !== undefined)
    return (
      <EmptyState title={t("review.noMatch")} action={<a href={reviewHref({ view: place.view })}>{t("review.clearFilters")}</a>}>
        {t("review.noMatchNote")}
      </EmptyState>
    );
  if (place.view === "new")
    return (
      <EmptyState title={t("review.allReviewed")} action={<a href={hrefTo("/agent")}>{t("review.startSession")}</a>}>
        {t("review.allReviewedNote")}
      </EmptyState>
    );
  return <EmptyState title={t(`review.empty.${place.view}`)}>{t(`review.emptyNote.${place.view}`)}</EmptyState>;
}

/**
 * The screen of the review: the tests the agents wrote, view by view and narrowed to a domain, and the card of the one
 * shown, which the address names so that a person shares what they look at. Nothing enters the test repository without
 * a decision of theirs.
 *
 * @param props - The name of the project, where the review stands, and what the instance told.
 * @returns The screen.
 */
export function ReviewScreen({ project, route, place, queue, proposal, controls }: ReviewScreenProps): ReactNode {
  const title = t("review.title");
  const crumbs = [{ label: project }, { label: title }];
  if (queue.value === undefined)
    return (
      <Page crumbs={crumbs} title={title}>
        <EmptyState title={t("review.readingQueue")}>
          <span role="status">{queue.unread ?? t("review.readingQueueNote")}</span>
        </EmptyState>
      </Page>
    );
  const tests = listedTests(queue.value, place);
  const shown = shownTest(tests, place);
  const close = withPanel(route);
  const gestures: ReviewGestures | undefined =
    controls === undefined
      ? undefined
      : {
          validate: controls.validate,
          restore: controls.restore,
          setAside: withPanel(route, SET_ASIDE_PANEL),
          correct: withPanel(route, CORRECT_PANEL),
          pending: controls.pending,
          ...(controls.refusal === undefined ? {} : { refusal: controls.refusal }),
        };
  // A panel is for the test to review it names; one that is no longer is not opened.
  const reviewing = proposal?.value?.status === "in_review" ? proposal.value : undefined;
  const panel = route.query["panel"] === SET_ASIDE_PANEL ? reviewing : undefined;
  const correcting = route.query["panel"] === CORRECT_PANEL ? reviewing : undefined;
  return (
    <Page crumbs={crumbs} title={title} hint={t("review.lead")}>
      {queue.unread !== undefined && (
        <p className="review-unread small" role="alert">
          {queue.unread}
        </p>
      )}
      {controls?.told !== undefined && (
        <p className="review-told small" role="status">
          {controls.told}
        </p>
      )}
      <div className="review-filters">
        <Views queue={queue.value} place={place} />
        <Domains queue={queue.value} place={place} />
      </div>
      {shown === undefined ? (
        <Nothing place={place} />
      ) : (
        <div className="review-layout">
          <div className="card review-list" role="list" aria-label={t(`review.view.${place.view}`)}>
            {tests.map((test, rank) => (
              <div key={test.id} role="listitem">
                <Row test={test} place={place} rank={rank + 1} shown={test === shown} />
              </div>
            ))}
            <p className="small muted review-keys">{t("review.keys")}</p>
          </div>
          <div className="review-shown">
            <Steps tests={tests} shown={shown} place={place} />
            <Shown proposal={proposal} {...(gestures === undefined ? {} : { gestures })} />
          </div>
        </div>
      )}
      {panel !== undefined && (
        <ReviewSetAside
          proposal={panel}
          close={close}
          pending={controls?.pending ?? false}
          {...(controls === undefined ? {} : { onSubmit: controls.setAside })}
        />
      )}
      {correcting !== undefined && (
        <ReviewCorrect
          proposal={correcting}
          close={close}
          pending={controls?.pending ?? false}
          {...(controls === undefined ? {} : { onSubmit: controls.correct })}
        />
      )}
    </Page>
  );
}
