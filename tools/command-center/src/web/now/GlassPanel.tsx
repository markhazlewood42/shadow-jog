import { Plasma, usePlasmaRuntime } from '@cruxgarden/plasma-ui';
import type { ReactNode, RefObject } from 'react';
import { type Offset, type PanelId, loadLayout, saveLayout } from './layout';

// One panel of the Now page. With the glass on it is a PlasmaUI surface: liquid glass that Mark can drag, and that snaps to a grid. With the glass off
// (the switch, or no WebGL2) it is the plain navy box with the lavender frame that every other panel of the site is. This is the only file that draws a
// surface, so a change of PlasmaUI's API touches this one.

export type GlassPanelProps = {
  /** Which panel this is. The arrangement is kept by id. */
  id: PanelId;
  /** The name of the panel: it is the name of the region for a screen reader. */
  title: string;
  /** Panels snap only to panels of the same group. All the panels of the Now page are one group. */
  group?: string;
  /** Where the panel starts, as how far it was moved from its place in the layout of the page (the saved arrangement). */
  defaultOffset?: Offset;
  /** The area that the panels are dragged in, and the origin of the grid that they snap to. Without it, the window is the area. */
  bounds?: RefObject<HTMLElement | null>;
  /** Classes for the place of the panel in the page (for example the columns that it takes). */
  className?: string;
  children: ReactNode;
};

/** What a panel of the Now page takes from the page: where it sits (the arrangement that was saved, the area it is dragged in, its place in the layout). */
export type PanelPlacement = Pick<GlassPanelProps, 'defaultOffset' | 'bounds' | 'className'>;

const DEFAULT_GROUP = 'now';

/** The corner radius, in pixels, of a panel in both modes: the plain box and the glass have the same shape. */
const PANEL_RADIUS = 8;

/**
 * The frame of a plain panel: the second navy, and the lavender line of the Look. The glass has neither: its edge is its rim, and a fill would hide the glass.
 */
const PLAIN_FRAME = 'border border-cc-rule-solid bg-cc-paper-2';

export function GlassPanel({ id, title, group = DEFAULT_GROUP, defaultOffset, bounds, className = '', children }: GlassPanelProps) {
  // The panel is glass when PlasmaUI has a renderer, and plain otherwise: with the glass off there is none, and while it starts (see GlassProvider) there is none yet. When PlasmaUI
  // cannot start its renderer there is none either, and the panel stays plain. (PlasmaUI would draw its own CSS fallback then, frosted and with a shadow, which is not the Look.)
  const { renderer } = usePlasmaRuntime();
  const drawn = renderer !== null;

  // The panel stays the same element when the glass is switched, so that what it holds (the loaded data, the scroll of a list) is not thrown away. With
  // the glass off it is still a PlasmaUI element, one that is not registered with any canvas and is not draggable: it only keeps its place in the arrangement.
  return (
    <Plasma
      as="section"
      aria-label={title}
      radius={PANEL_RADIUS}
      // The panels hold text and links. A panel that leans toward the pointer moves the thing that is about to be clicked.
      lean={false}
      draggable={drawn}
      snap
      group={group}
      {...(bounds === undefined ? {} : { bounds })}
      {...(defaultOffset === undefined ? {} : { defaultOffset })}
      // The offset that PlasmaUI reports is where the panel settles (on the grid, or against a neighbor), so it is what is kept.
      onDragEnd={(offset) => saveLayout({ ...loadLayout(), [id]: offset })}
      className={`${drawn ? '' : PLAIN_FRAME} ${className} cc-focus-ring`}
    >
      {children}
    </Plasma>
  );
}
