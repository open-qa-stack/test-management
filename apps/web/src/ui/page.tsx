import type { ReactNode } from "react";

/** A step of the breadcrumb of a page. */
export interface Crumb {
  /** Its label. */
  readonly label: string;
  /** Where it leads; none for the page itself and for a step that is no screen. */
  readonly href?: string;
}

/** What a page needs. */
export interface PageProps {
  /** Its breadcrumb, from the project to the page. */
  readonly crumbs: readonly Crumb[];
  /** Its title; none for a page that opens on its content, or whose header is an entity. */
  readonly title?: ReactNode;
  /** Its actions, the primary one last. */
  readonly actions?: ReactNode;
  /** What the page is for, in a line under its title. */
  readonly hint?: ReactNode;
  /** The header of the entity the page shows, in place of a title. */
  readonly entity?: ReactNode;
  /** Its content. */
  readonly children: ReactNode;
}

/**
 * A page of the console: a breadcrumb, a title or the header of an entity, its actions, what it is for in a line, then
 * its content. Its
 * title takes the focus when the console arrives on the page, without being a stop of the keyboard.
 *
 * @param props - The header and the content of the page.
 * @returns The page.
 */
export function Page({ crumbs, title, actions, hint, entity, children }: PageProps): ReactNode {
  return (
    <>
      <div className="ph">
        <div className="crumb">
          {crumbs.map((crumb, index) => (
            <span key={crumb.label} className="crumb-step">
              {index > 0 && <span className="crumb-sep">/</span>}
              {crumb.href !== undefined ? (
                <a href={crumb.href}>{crumb.label}</a>
              ) : index === crumbs.length - 1 ? (
                <b>{crumb.label}</b>
              ) : (
                <span>{crumb.label}</span>
              )}
            </span>
          ))}
        </div>
        {title !== undefined && <h1 tabIndex={-1}>{title}</h1>}
        {actions !== undefined && <div className="actions">{actions}</div>}
        {hint !== undefined && <p className="page-hint">{hint}</p>}
      </div>
      {entity}
      <div className="content">{children}</div>
    </>
  );
}
