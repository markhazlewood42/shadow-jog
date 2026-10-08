import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { type AgentsLive, sessionAnchor } from '../../shared/types';
import { Cluster } from './Cluster';
import { LiveNotes } from './LiveNotes';
import { useLeaving } from './motion';
import { TextList } from './TextList';

// The live diagram of the Agents page (design 5.4, revision 2): the labels above it, one cluster for each live session, and the text list under it. It is a plain function of
// the live data and of the clock, so a test draws it with no server.

/** The start of the fragment of a link to a session (`#session-<id>`). Any other fragment is not a link to a session. */
const SESSION_FRAGMENT = `#${sessionAnchor('')}`;

/**
 * Scrolls to the cluster of the session that the address names (`/agents#session-<id>`, the link of "Your move"), once the page has it. The data loads after the page opens,
 * so the browser's own jump to a fragment finds nothing; this does the jump when the cluster is there. It jumps once for each address: a diagram that loads again (every change
 * of the agents does it) must not pull the page back while Mark reads. A link to a session that is not live goes nowhere, and says nothing: the page has no sentence for it.
 */
function useScrollToLinkedSession(sessionIds: readonly string[]): void {
  const { hash } = useLocation();
  const scrolledTo = useRef<string | null>(null);
  const target = hash.startsWith(SESSION_FRAGMENT) ? hash.slice(1) : null;
  const present = target !== null && sessionIds.some((id) => sessionAnchor(id) === target);

  useEffect(() => {
    if (target === null) {
      // The address has no link to a session any more: a link to the same session later is a new link, and scrolls again.
      scrolledTo.current = null;
      return;
    }
    if (!present || scrolledTo.current === target) return;
    scrolledTo.current = target;
    document.getElementById(target)?.scrollIntoView({ block: 'start' });
  }, [target, present]);
}

type DiagramProps = {
  live: AgentsLive;
  /** The time now, in milliseconds. */
  nowMs: number;
};

export function Diagram({ live, nowMs }: DiagramProps) {
  // A session whose process ended is still drawn for 200 ms, so that its cluster can fade out.
  const clusters = useLeaving(live.sessions, (session) => session.id);
  useScrollToLinkedSession(live.sessions.map((session) => session.id));

  return (
    <div className="flex flex-col gap-4">
      {/* The labels of the source: nothing when both are quiet (`empty:hidden`), so that the column has no gap for them. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 empty:hidden">
        <LiveNotes live={live} />
      </div>
      {live.sessions.length === 0 && <p className="text-cc-muted">No active session</p>}
      {clusters.length > 0 && (
        // Columns of at least 22rem: three clusters side by side in a wide window, and one column in a narrow one (at 800 px). The sessions keep the order of the data.
        <div className="grid grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] gap-x-8 gap-y-6">
          {clusters.map(({ item, leaving }) => (
            <Cluster key={item.id} session={item} nowMs={nowMs} leaving={leaving} />
          ))}
        </div>
      )}
      <TextList sessions={live.sessions} nowMs={nowMs} />
    </div>
  );
}
