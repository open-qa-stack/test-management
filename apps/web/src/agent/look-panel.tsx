import type { ReactNode } from "react";
import { Icon } from "../ui/icon.tsx";
import { LookView } from "./look-view.tsx";
import { LOOK_TITLE_ID, type OpenedLook } from "./opened-look.ts";

/** The identifier of the sentence of the action a look belongs to, which names the panel with its title. */
const ACTION_ID = "look-panel-action";

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
 * in reach behind it — and is named by its title and by the action it belongs to.
 *
 * @param props - The look, and the address that closes it.
 * @returns The panel.
 */
export function LookPanel({ opened, close }: LookPanelProps): ReactNode {
  return (
    <section className="look-panel" role="dialog" aria-modal="false" aria-labelledby={`${LOOK_TITLE_ID} ${ACTION_ID}`}>
      <header className="look-panel-head">
        <div className="look-panel-titles">
          <h2 id={LOOK_TITLE_ID} tabIndex={-1}>
            Sous les yeux de l’agent
          </h2>
          <p id={ACTION_ID} className="look-panel-action">
            {opened.action}
          </p>
        </div>
        <a className="look-panel-close" href={close} aria-label="Fermer">
          <Icon name="close" size={18} />
        </a>
      </header>
      <LookView look={opened.look} />
    </section>
  );
}
