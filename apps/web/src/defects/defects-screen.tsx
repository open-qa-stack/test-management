import type { ReactNode } from "react";
import type { DefectList, DefectStage, DefectStatus, ListedDefect } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../api/polled-state.ts";
import { dateText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { testHref } from "../tests/tests-paths.ts";
import { Badge, type BadgeTone } from "../ui/badge.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import { DEFECT_VIEWS, defectsHref, type DefectView } from "./defects-paths.ts";

/** The stages each view holds. */
const IN_VIEW: Readonly<Record<DefectView, readonly DefectStage[]>> = { open: ["open"], to_replay: ["to_replay"], closed: ["replayed", "closed"] };

/** The tone of the badge of each stage. */
const STAGE_TONES: Readonly<Record<DefectStage, BadgeTone>> = { open: "ko", to_replay: "warn", replayed: "ok", closed: "neutral" };

/** The tone of the badge of each severity: the more serious, the louder. */
const SEVERITY_TONES = { S1: "ko", S2: "warn", S3: "info", S4: "neutral" } as const;

/** What the person does of a defect, which a static rendering of the screen has none of. */
export interface DefectsControls {
  readonly change: (id: string, status: DefectStatus) => void;
  /** The defect a change is under way for, when one is. */
  readonly pending?: string;
  /** Why the instance refused the last change, when it did. */
  readonly refusal?: string;
}

/** What the screen of the defects is drawn from. */
export interface DefectsScreenProps {
  /** The name of the project. */
  readonly project: string;
  readonly view: DefectView;
  /** What the instance told of the defects. */
  readonly defects: PolledState<DefectList>;
  readonly controls?: DefectsControls;
}

/** The gestures of a defect, by where it stands: fix one open, close one fixed or open, open again one closed or fixed. */
const GESTURES: Readonly<Record<DefectStage, readonly DefectStatus[]>> = {
  open: ["fixed", "closed"],
  to_replay: ["closed", "open"],
  replayed: ["closed", "open"],
  closed: ["open"],
};

/** A defect of the table: its reference, its title, its severity, where it stands, its test, when it was reported, and what can be done of it. */
function Row({ defect, controls }: { readonly defect: ListedDefect; readonly controls: DefectsControls | undefined }): ReactNode {
  return (
    <tr>
      <td className="mono">{defect.id}</td>
      <td>{defect.title}</td>
      <td>
        <Badge tone={SEVERITY_TONES[defect.severity]}>{t(`defects.severities.${defect.severity}`)}</Badge>
      </td>
      <td>
        <Badge tone={STAGE_TONES[defect.stage]}>{t(`defects.stages.${defect.stage}`)}</Badge>
      </td>
      <td>
        <a href={testHref(defect.test.path)}>{defect.test.title}</a>
      </td>
      <td className="small muted">{dateText(defect.openedAt)}</td>
      <td className="defects-gestures">
        {GESTURES[defect.stage].map((status) => (
          <button
            key={status}
            type="button"
            className="btn sm"
            disabled={controls === undefined || controls.pending !== undefined}
            onClick={() => controls?.change(defect.id, status)}
          >
            {t(`defects.gestures.${status}`)}
          </button>
        ))}
      </td>
    </tr>
  );
}

/**
 * The screen of the defects reported from tests that failed, kept by the instance: those to deal with, those fixed whose
 * test is to run again, and those closed or whose test passed since, each view with how many it holds, as the address
 * keeps it. A defect is reported from the card of a test that failed.
 *
 * @param props - The name of the project, the view, what the instance told, and what the gestures do.
 * @returns The screen.
 */
export function DefectsScreen({ project, view, defects, controls }: DefectsScreenProps): ReactNode {
  const title = t("defects.title");
  const crumbs = [{ label: project }, { label: title }];
  if (defects.value === undefined)
    return (
      <Page crumbs={crumbs} title={title}>
        <EmptyState title={t("defects.reading")}>
          <span role="status">{defects.unread ?? t("defects.readingNote")}</span>
        </EmptyState>
      </Page>
    );
  const { items, counts } = defects.value;
  const shown = items.filter(({ stage }) => IN_VIEW[view].includes(stage));
  const counted: Readonly<Record<DefectView, number>> = { open: counts.open, to_replay: counts.toReplay, closed: counts.closed };
  return (
    <Page crumbs={crumbs} title={title} hint={t("defects.lead")}>
      {(defects.unread ?? controls?.refusal) !== undefined && (
        <p className="defects-unread small" role="alert">
          {controls?.refusal ?? defects.unread}
        </p>
      )}
      <nav className="defects-views" aria-label={t("defects.views")}>
        {DEFECT_VIEWS.map((known) => (
          <a key={known} className={known === view ? "chip on" : "chip"} href={defectsHref(known)} aria-current={known === view ? "page" : undefined}>
            {t(`defects.view.${known}`)} <span className="muted">{counted[known]}</span>
          </a>
        ))}
      </nav>
      {shown.length === 0 ? (
        <EmptyState title={t(`defects.empty.${view}`)}>{t(`defects.emptyNote.${view}`)}</EmptyState>
      ) : (
        <div className="card defects-table">
          <table>
            <thead>
              <tr>
                <th scope="col">{t("defects.columns.reference")}</th>
                <th scope="col">{t("defects.columns.title")}</th>
                <th scope="col">{t("defects.columns.severity")}</th>
                <th scope="col">{t("defects.columns.stage")}</th>
                <th scope="col">{t("defects.columns.test")}</th>
                <th scope="col">{t("defects.columns.opened")}</th>
                <th scope="col">
                  <span className="sr-only">{t("defects.columns.gestures")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((defect) => (
                <Row key={defect.id} defect={defect} controls={controls} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
