import type { ClusterLayout, LayoutLine } from './layout';
import type { Leaving } from './motion';

// The lines of one cluster of the Agents diagram (design 5.4, revision 2): one SVG layer that sits behind the boxes, and the small labels with the counts that sit on the dashed
// lines. The layout (layout.ts) has already worked out every point, so this file only draws them.
//
// SVG in short, for a reader who has not used it: an <svg> is a drawing board with its own coordinates, in pixels, with (0, 0) at the top left. A <path> draws a line through the
// points in its `d` attribute ("M 12 52 L 12 92" is "move to (12, 52), then draw a line to (12, 92)"). `stroke` is the color of the line, and `currentColor` means "the text color of
// this element", so the lines take their color from a Tailwind text class and no color value is written here. A <marker> is a small shape that a line wears at its end: the arrowhead.

/** The width of every line, in pixels. The flash (src/web/theme.css) settles back to this width. */
const STROKE = 1.5;

/** The dashes of a message line: 3 pixels of line, 3 pixels of gap. */
const DASHES = '3 3';

/** The id of the arrowhead that the spawn lines of a cluster point to. Each cluster has its own, named by its session, so two clusters never share an id. */
const markerIdOf = (sessionId: string): string => `cc-arrow-${sessionId}`;

/**
 * How a line moves. A line follows its box: when the boxes slide to new places, the `d` of a line changes, and CSS moves the line to it in the same 200 ms with the same easing (a
 * browser that cannot do that, one without CSS transitions of `d`, redraws the line at once, and the box still slides). A line that is leaving also fades with its box.
 */
const MOVE = 'motion-safe:transition-[d,opacity] motion-safe:duration-200 motion-safe:ease-out';

type LineViewProps = { line: LayoutLine; leaving: boolean; flashing: boolean; markerId: string };

function LineView({ line, leaving, flashing, markerId }: LineViewProps) {
  const fading = leaving ? 'opacity-0' : '';
  const common = { 'data-line': line.kind, 'data-owner': line.ownerId, d: line.path, fill: 'none', stroke: 'currentColor', strokeWidth: STROKE } as const;

  if (line.kind === 'messages') {
    // The line is dashed. It flashes (a CSS animation) for one second when its count grows: it turns white and thick, and settles back.
    return <path {...common} strokeDasharray={DASHES} className={`text-cc-muted ${MOVE} ${fading} ${flashing ? 'motion-safe:animate-cc-flash' : ''}`} />;
  }
  if (line.kind === 'spawn') {
    return <path {...common} markerEnd={`url(#${markerId})`} className={`text-cc-soft ${MOVE} ${fading}`} />;
  }
  // The trunk. A square end makes the corner where a trunk meets the last arm a clean corner.
  return <path {...common} strokeLinecap="square" className={`text-cc-soft ${MOVE} ${fading}`} />;
}

type LinesProps = {
  layout: Pick<ClusterLayout, 'width' | 'height'>;
  /** The lines to draw, with the ones that left in the last 200 ms (marked as leaving). */
  lines: readonly Leaving<LayoutLine>[];
  /** The message lines that flash now, by the id of their box, each with the token of the growth (it is part of the key, so a second growth starts the flash again). */
  flashing: ReadonlyMap<string, number>;
  /** The session of the cluster: it names the arrowhead. */
  sessionId: string;
};

/** The key of a line or of its count: its id, and the token of the flash that it is in, so that a new growth makes a new element and the animation starts again. */
const keyOf = (line: LayoutLine, flashing: ReadonlyMap<string, number>): string => `${line.id}:${line.kind === 'messages' ? (flashing.get(line.ownerId) ?? 0) : 0}`;

/** The SVG layer. It is hidden from a screen reader (the text list says the same in words), and it does not take the pointer: the boxes above it do. */
export function Lines({ layout, lines, flashing, sessionId }: LinesProps) {
  const markerId = markerIdOf(sessionId);
  return (
    <svg data-lines aria-hidden="true" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} className="pointer-events-none absolute inset-0 overflow-visible">
      <defs>
        {/* The arrowhead: a triangle whose point is at the end of the line, in pixels and not scaled by the width of the line. `orient="auto"` turns it along the line. */}
        <marker id={markerId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto" className="text-cc-soft">
          <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
        </marker>
      </defs>
      {lines.map(({ item: line, leaving }) => (
        <LineView key={keyOf(line, flashing)} line={line} leaving={leaving} flashing={line.kind === 'messages' && flashing.has(line.ownerId)} markerId={markerId} />
      ))}
    </svg>
  );
}

/**
 * The counts on the dashed lines: a small label for each message line, level with its line. They are HTML and not SVG text, so that a label slides to a new place with a
 * transition on `transform`, as the boxes do, and stays on its line while it moves (SVG text cannot be moved by CSS transitions). They are above the SVG layer and never
 * overlap a box (the layout keeps them in the arm between a trunk and a box). A screen reader skips them: the text list says "2 messages" for the same line.
 */
export function CountBadges({ lines, flashing }: Pick<LinesProps, 'lines' | 'flashing'>) {
  return (
    <>
      {lines.map(({ item: line, leaving }) => {
        if (line.count === undefined) return null;
        const { text, x, y, w, h } = line.count;
        return (
          <span
            key={keyOf(line, flashing)}
            aria-hidden="true"
            data-count={line.ownerId}
            {...(leaving ? { 'data-leaving': 'true' } : {})}
            className={`pointer-events-none absolute top-0 left-0 flex items-center justify-center rounded-[3px] border border-cc-rule-solid bg-cc-paper-2 font-mono text-[11px] leading-none text-cc-muted data-leaving:opacity-0 motion-safe:transition-[transform,opacity] motion-safe:duration-200 motion-safe:ease-out ${flashing.has(line.ownerId) ? 'motion-safe:animate-cc-flash' : ''}`}
            style={{ width: w, height: h, transform: `translate(${x}px, ${y}px)` }}
          >
            {text}
          </span>
        );
      })}
    </>
  );
}
