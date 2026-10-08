import { useMemo } from 'react';
import { type LiveNode, type LiveSession, sessionAnchor } from '../../shared/types';
import { type BoxEntry, BoxView } from './BoxView';
import { layoutSession, nodeIndex } from './layout';
import { CountBadges, Lines } from './Lines';
import { useFlash, useLeaving } from './motion';

// One cluster of the Agents diagram (design 5.4, revision 2): one live session, with the agents and workflows that it started. The numbers come from the layout
// (layout.ts); this file draws them. The boxes are HTML (so their text can be selected, and the Copy buttons are real buttons), and the lines are one SVG layer behind the boxes.
// Both sit in one box with a fixed size, in which every part is placed by its coordinates: that is what lets a box slide to a new place with a CSS transition.

type ClusterProps = {
  session: LiveSession;
  /** The time now, in milliseconds. The page moves it on every 15 seconds, so a run time that still grows grows on the screen. */
  nowMs: number;
  /** The session left the data and the cluster is waiting for its fade-out. */
  leaving: boolean;
};

export function Cluster({ session, nowMs, leaving }: ClusterProps) {
  const layout = useMemo(() => layoutSession(session), [session]);

  // Every box with what it shows. The session box shows the session; each of the others shows its node.
  const entries = useMemo<BoxEntry[]>(() => {
    const nodes = nodeIndex(session);
    return layout.boxes.flatMap((box): BoxEntry[] => {
      if (box.kind === 'session') return [{ box, data: session }];
      const node: LiveNode | undefined = nodes.get(box.id);
      return node === undefined ? [] : [{ box, data: node }];
    });
  }, [layout, session]);

  // The counts of messages, by box, a box with none included: a message line flashes when its count grows, and the first message of a box that had none is growth too (the
  // line comes into the diagram with a flash). A box that is new has no earlier count, so its line comes with the box and does not flash.
  const counts = useMemo(() => new Map(session.nodes.map((node) => [node.id, node.messages.count])), [session]);

  // A box or a line that left in the last 200 ms is still drawn, as it was, and fades out.
  const boxes = useLeaving(entries, (entry) => entry.box.id);
  const lines = useLeaving(layout.lines, (line) => line.id);
  const flashing = useFlash(counts);

  return (
    // The cluster is a scroll box of its own for a tree that is wider than its column (a deep one), so that it never runs under the cluster next to it. The anchor id is the one
    // that "Your move" links to (sessionHref), and `scroll-mt-20` leaves room for the bar at the top of the page, which stays in view.
    <div
      id={sessionAnchor(session.id)}
      data-cluster={session.id}
      {...(leaving ? { 'data-leaving': 'true' } : {})}
      className="min-w-0 scroll-mt-20 overflow-x-auto overflow-y-hidden data-leaving:pointer-events-none data-leaving:opacity-0 motion-safe:transition-opacity motion-safe:duration-200 motion-safe:ease-out"
    >
      <div className="relative" style={{ width: layout.width, height: layout.height }}>
        <Lines layout={layout} lines={lines} flashing={flashing} sessionId={session.id} />
        {boxes.map(({ item, leaving: boxLeaving }) => (
          <BoxView key={item.box.id} entry={item} nowMs={nowMs} leaving={boxLeaving} />
        ))}
        <CountBadges lines={lines} flashing={flashing} />
        {layout.more.map((label) => (
          // A plain label: the boxes after the limit are in the text list. It is not a control, so it is not in the tab order.
          <span key={label.parentId} data-more={label.parentId} className="absolute top-0 left-0 text-xs leading-5 whitespace-nowrap text-cc-soft" style={{ height: label.h, transform: `translate(${label.x}px, ${label.y}px)` }}>
            {label.text}
          </span>
        ))}
      </div>
    </div>
  );
}
