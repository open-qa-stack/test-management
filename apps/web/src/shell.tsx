import type { ReactNode } from "react";

/** What the shell frames. */
export interface ShellProps {
  /** The page shown in the main area. */
  readonly children?: ReactNode;
}

/**
 * The frame of every screen: a sidebar from 960 px wide, a bottom tab bar below.
 *
 * @param props - The page to frame.
 * @returns The shell.
 */
export function Shell({ children }: ShellProps): ReactNode {
  return (
    <div className="shell">
      <aside className="shell-sidebar" />
      <main className="shell-page">{children}</main>
      <nav className="shell-tab-bar" />
    </div>
  );
}
