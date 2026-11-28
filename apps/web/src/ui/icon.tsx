import type { ReactNode } from "react";

/** The drawing of each icon, as the content of a 24 × 24 outline. */
const DRAWINGS = {
  block: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M11 7h4a2 2 0 0 1 2 2v4"/>',
  home: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  agent: '<path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4zM5 17l.9 2.1L8 20l-2.1.9L5 23l-.9-2.1L2 20l2.1-.9z"/>',
  discovery: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-2 6-4 2 2-6z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/>',
  review: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5V16h8v-2.5A6 6 0 0 0 12 3z"/>',
  tests: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  collections:
    '<rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="8"/><rect x="3" y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/>',
  campaign: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  pause: '<path d="M7 4v16M17 4v16"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  memory: '<path d="M12 3a7 7 0 0 0-7 7c0 3 2 4 2 6h10c0-2 2-3 2-6a7 7 0 0 0-7-7zM9 20h6"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.3 2.6a7 7 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.7 1l.3 2.6h5l.3-2.6a7 7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5c.1-.3.1-.7.1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>',
  collapse: '<path d="M15 6l-6 6 6 6"/>',
  code: '<path d="M8 6l-5 6 5 6M16 6l5 6-5 6M14 4l-4 16"/>',
  api: '<path d="M4 4h16v16H4zM4 9h16M9 9v11"/>',
  database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  document: '<path d="M6 3h9l4 4v14H6zM15 3v4h4M9 12h6M9 16h6"/>',
  ticket: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h6"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  data: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
  columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
  export: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  warning: '<path d="M12 3l10 18H2zM12 10v5M12 18h.01"/>',
  git: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 8.5v7M18 11.5a6 6 0 0 1-6 6H8.5"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.500-8-9V6z"/><path d="M9 12l2.200 2.200L15 10"/>',
  eye: '<path d="M2 12s3.600-7 10-7 10 7 10 7-3.600 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16zM13.500 6.500l4 4"/>',
  thought: '<path d="M8 18a5 5 0 0 1-1-9.900A6 6 0 0 1 18.500 9 4.500 4.500 0 0 1 17 18zM9 21h.01M12 21h.01"/>',
  restart: '<path d="M3 12a9 9 0 1 0 3-6.700M3 4v5h5"/>',
  forward: '<path d="M5 4l10 8-10 8zM19 5v14"/>',
  send: '<path d="M4 12l16-8-6 16-3-7z"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.500"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5"/>',
} as const;

/** The name of an icon of the console. */
export type IconName = keyof typeof DRAWINGS;

/** What an icon needs. */
/** The sides an icon is drawn at, in CSS pixels: steps of the grid of the console. */
export type IconSize = 12 | 16 | 20 | 24;

/** The side of the square every icon is drawn in, in the units of its drawing. */
const VIEW = 24;

/** How thick the line of an icon is, in CSS pixels, whatever its size. */
const STROKE = 1.5;

export interface IconProps {
  /** Which icon. */
  readonly name: IconName;
  /** Its side; 16 px by default. */
  readonly size?: IconSize;
}

/**
 * An outline icon, drawn with the colour of the text around it and hidden from assistive technologies. Its line
 * keeps one thickness on the screen at every size, so that a small icon beside a large one reads as the same hand.
 *
 * @param props - The icon and its size.
 * @returns The icon.
 */
export function Icon({ name, size = 16 }: IconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={(STROKE * VIEW) / size}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: DRAWINGS[name] }}
    />
  );
}
