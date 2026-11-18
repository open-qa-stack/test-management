import type { ReactNode } from "react";
import { t } from "../i18n/i18n.ts";
import { Icon } from "../ui/icon.tsx";
import { lookTitleOf } from "./look.ts";
import { LookView } from "./look-view.tsx";
import { LOOK_TITLE_ID, type OpenedLook } from "./opened-look.ts";

/** The identifier of what the look is — the path of a file, the application and the address of a page — which names the panel with its title. */
const SUBTITLE_ID = "look-panel-subtitle";

/** What the panel of a look needs. */
export interface LookPanelProps {
  /** The look the address opens. */
  readonly opened: OpenedLook;
  /** The address of the session without that look, which closes the panel. */
  readonly close: string;
}

/**
 * What an agent had before its eyes when it acted, in a panel a person opens from that action: the whole
 * screen of a phone, a drawer at the right of a wide one. It does not hold the keyboard — the thread stays
 * in reach behind it — and is titled by what it shows, “Test file” or “Page looked at”, and named by
 * that title and by what it is: the path of the file, or the application and the address of the page.
 *
 * @param props - The look, and the address that closes it.
 * @returns The panel.
 */
export function LookPanel({ opened, close }: LookPanelProps): ReactNode {
  const [title, subtitle] = lookTitleOf(opened.look);
  return (
    <section className="look-panel" role="dialog" aria-modal="false" aria-labelledby={`${LOOK_TITLE_ID} ${SUBTITLE_ID}`}>
      <header className="look-panel-head">
        <div className="look-panel-titles">
          <h2 id={LOOK_TITLE_ID} tabIndex={-1}>
            {title}
          </h2>
          <p id={SUBTITLE_ID} className="look-panel-subtitle">
            {subtitle}
          </p>
        </div>
        <a className="look-panel-close" href={close} aria-label={t("look.close")}>
          <Icon name="close" size={20} />
        </a>
      </header>
      <LookView look={opened.look} caption={opened.action} />
    </section>
  );
}
