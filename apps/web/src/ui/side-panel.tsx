import { useEffect, useRef, type ReactNode, type SyntheticEvent } from "react";
import { t } from "../i18n/i18n.ts";
import { Icon } from "./icon.tsx";

/** What a side panel is drawn from. */
export interface SidePanelProps {
  /** The identifier of its title, which names the panel. */
  readonly id: string;
  /** What the panel is about. */
  readonly title: string;
  /** The link that closes it: the page under it, without the panel. */
  readonly close: string;
  /** What the panel holds. */
  readonly children: ReactNode;
  /** What stays at its foot: what saves, or drops, what the person did in it. */
  readonly footer?: ReactNode;
}

/** Goes back to the page under the panel when the person presses Escape. */
const leaveTo =
  (close: string) =>
  (event: SyntheticEvent<HTMLDialogElement>): void => {
    event.preventDefault();
    window.location.hash = close;
  };

/**
 * A secondary task of a page in a panel of its own — what adds or changes a part of what the page shows —: the whole
 * screen of a phone, a panel at the right of a wide one. It is a modal dialog of the browser, which holds the focus
 * and leaves the page under it out of reach; Escape and its cross close it, and the page under it stays as it was.
 *
 * @param props - Its title, the link that closes it, what it holds and its foot.
 * @returns The panel.
 */
export function SidePanel({ id, title, close, children, footer }: SidePanelProps): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal();
  }, []);
  return (
    <dialog ref={dialog} className="side-panel" aria-labelledby={id} onCancel={leaveTo(close)}>
      <header className="side-panel-head">
        <h2 id={id}>{title}</h2>
        <a className="side-panel-close" href={close} aria-label={t("panel.close")}>
          <Icon name="close" size={20} />
        </a>
      </header>
      <div className="side-panel-body">{children}</div>
      {footer !== undefined && <div className="side-panel-foot">{footer}</div>}
    </dialog>
  );
}
