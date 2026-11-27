import type { FormEventHandler, ReactNode } from "react";
import type { MemoryItem, MemoryList } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../api/polled-state.ts";
import { applicationName } from "../applications/application-names.ts";
import { dateText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { Badge, type BadgeTone } from "../ui/badge.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import { MEMORY_TYPES, MEMORY_VIEWS, memoryHref, type MemoryPlace } from "./memory-paths.ts";
import { MemoryPanel } from "./memory-panel.tsx";

/** The tone of the badge of each type of line: what a person gave, then what an agent noted. */
const TYPE_TONES: Readonly<Record<MemoryItem["type"], BadgeTone>> = { instruction: "info", correction: "warn", inferred: "ai" };

/** What the person does in the memory, which a static rendering of the screen has none of. */
export interface MemoryControls {
  /** Adds the instruction, or adjusts the line the panel is open on, from the form of the panel. */
  readonly save: FormEventHandler<HTMLFormElement>;
  /** Whether a change is under way. */
  readonly pending: boolean;
  /** Why the instance refused the last change, when it did. */
  readonly refusal?: string;
}

/** What the screen of the memory is drawn from. */
export interface MemoryScreenProps {
  /** The name of the project. */
  readonly project: string;
  readonly place: MemoryPlace;
  /** What the instance told of the memory. */
  readonly memory: PolledState<MemoryList>;
  readonly controls?: MemoryControls;
}

/** Where a line is kept and when it was written: the application or the project and the work, or what an agent noted it under. */
function originOf(item: MemoryItem): string {
  if (item.filed !== undefined) return t("memory.noted", { domain: item.filed.domain, kind: t(`memory.kinds.${item.filed.kind}`), date: dateText(item.at) });
  const where = item.application === undefined ? t("memory.project") : applicationName(item.application);
  return t("memory.given", { where, target: t(`memory.targets.${item.target}`), date: dateText(item.at) });
}

/** A line of the memory: its type, what it says, where it comes from, and the link that adjusts it. */
function Row({ item, place }: { readonly item: MemoryItem; readonly place: MemoryPlace }): ReactNode {
  return (
    <div className="row memory-row" role="listitem">
      <span className="grow">
        <Badge tone={TYPE_TONES[item.type]}>{t(`memory.types.${item.type}`)}</Badge>
        <span className="memory-text">{item.text}</span>
        <span className="small muted">{originOf(item)}</span>
      </span>
      <a className="btn sm" href={memoryHref({ ...place, panel: item.id })} aria-label={t("memory.adjustNamed", { text: item.text })}>
        {t("memory.adjust")}
      </a>
    </div>
  );
}

/**
 * The screen of the memory of the agents: what they keep in mind before each task — the instructions the people of the
 * project gave them, and what they noted themselves — view by view and narrowed to a type, with the panel that adds an
 * instruction and the one that adjusts a line.
 *
 * @param props - The name of the project, where the memory stands, what the instance told, and what the gestures do.
 * @returns The screen.
 */
export function MemoryScreen({ project, place, memory, controls }: MemoryScreenProps): ReactNode {
  const title = t("memory.title");
  const crumbs = [{ label: project }, { label: title }];
  if (memory.value === undefined)
    return (
      <Page crumbs={crumbs} title={title}>
        <EmptyState title={t("memory.reading")}>
          <span role="status">{memory.unread ?? t("memory.readingNote")}</span>
        </EmptyState>
      </Page>
    );
  const { items, counts } = memory.value;
  const shown = items.filter((item) => item.active === (place.view === "active") && (place.type === undefined || item.type === place.type));
  const counted = { active: counts.active, inactive: counts.inactive };
  const close = memoryHref({ view: place.view, ...(place.type === undefined ? {} : { type: place.type }) });
  const adjusted = items.find(({ id }) => id === place.panel);
  const panel = place.panel === "add" || adjusted !== undefined;
  return (
    <Page
      crumbs={crumbs}
      title={title}
      hint={t("memory.lead")}
      actions={
        <a className="btn primary" href={memoryHref({ ...place, panel: "add" })}>
          {t("memory.add")}
        </a>
      }
    >
      {memory.unread !== undefined && (
        <p className="memory-refusal small" role="alert">
          {memory.unread}
        </p>
      )}
      <nav className="memory-views" aria-label={t("memory.views")}>
        {MEMORY_VIEWS.map((view) => (
          <a
            key={view}
            className={view === place.view ? "chip on" : "chip"}
            href={memoryHref({ view, ...(place.type === undefined ? {} : { type: place.type }) })}
            aria-current={view === place.view ? "page" : undefined}
          >
            {t(`memory.view.${view}`)} <span className="muted">{counted[view]}</span>
          </a>
        ))}
      </nav>
      <nav className="memory-views" aria-label={t("memory.typeFilter")}>
        <a
          className={place.type === undefined ? "chip on" : "chip"}
          href={memoryHref({ view: place.view })}
          aria-current={place.type === undefined ? "page" : undefined}
        >
          {t("memory.allTypes")}
        </a>
        {MEMORY_TYPES.map((type) => (
          <a
            key={type}
            className={type === place.type ? "chip on" : "chip"}
            href={memoryHref({ view: place.view, type })}
            aria-current={type === place.type ? "page" : undefined}
          >
            {t(`memory.typesPlural.${type}`)}
          </a>
        ))}
      </nav>
      {shown.length === 0 ? (
        <EmptyState title={t(`memory.empty.${place.view}`)}>{t("memory.emptyNote")}</EmptyState>
      ) : (
        <div className="card" role="list" aria-label={t(`memory.view.${place.view}`)}>
          {shown.map((item) => (
            <Row key={item.id} item={item} place={place} />
          ))}
        </div>
      )}
      {panel && (
        <MemoryPanel
          {...(adjusted === undefined ? {} : { item: adjusted })}
          close={close}
          pending={controls?.pending ?? false}
          {...(controls === undefined ? {} : { onSubmit: controls.save })}
          {...(controls?.refusal === undefined ? {} : { refusal: controls.refusal })}
        />
      )}
    </Page>
  );
}
