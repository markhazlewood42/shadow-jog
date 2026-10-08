import { MessageSquare } from 'lucide-react';
import { Link } from 'react-router';
import { type AgentsLive, type LiveSession, type ModuleName, sessionHref } from '../../shared/types';
import { LiveNotes } from '../agents/LiveNotes';
import { PanelContent } from '../PanelFrame';
import { usePanel } from '../usePanel';
import { GlassPanel, type PanelPlacement } from './GlassPanel';
import { formatDuration, msSince, useNow } from './time';

// "Running": the Claude sessions that are alive now (design 5.1, revision 2). One row for each: its title, a state word and how long it has run. The whole row is a link to the
// cluster of its session on the Agents page (`/agents#session-<id>`), which draws the agents and the workflows of each session: this panel shows none of them. It reads the live agents (GET /api/agents). That module starts from the
// process list of Claude Code, so a session is on the list while its process runs, and it leaves the list when the process ends.

/** The panel loads again when the agents module says that something changed (it looks at the process list every 3 seconds). */
const AGENTS_MODULES: readonly ModuleName[] = ['agents'];

/**
 * One session. The whole row is one link, so the target is as big as the row. The title is the underlined part, as in the other lists of this page, and the state and the
 * time are small text beside it. The state is a word, so it never depends on a color. The spaces between the pieces are for a screen reader and for a copy of the row:
 * the layout of the boxes ignores them.
 */
function SessionRow({ session, nowMs }: { session: LiveSession; nowMs: number }) {
  // From the start of its process to now. Null when the start is not known, so the row shows no time and never a guess.
  const runMs = msSince(session.startedAt, nowMs);
  return (
    <li>
      <Link to={sessionHref(session.id)} className="flex items-start gap-2 py-2.5 cc-focus-ring">
        <MessageSquare aria-hidden className="mt-0.5 size-4 shrink-0 text-cc-muted" />{' '}
        {/* The title comes from a session file: it is shown as text. */}
        <span className="min-w-0 flex-1 text-sm font-medium break-words text-cc-link underline underline-offset-2">{session.title}</span>{' '}
        <span className="shrink-0 text-right text-xs text-cc-muted">
          {session.state}
          {runMs !== null && (
            <>
              {' '}
              <span className="ml-1 font-mono text-cc-soft">{formatDuration(runMs)}</span>
            </>
          )}
        </span>
      </Link>
    </li>
  );
}

/**
 * The list of the panel: a row for each session in the order that the API gives (the oldest first, so a row does not jump when a session changes), or the label of the empty
 * state. Under it come two labels when they apply: how many runs of a script are left out, and that the file ages decided because the process list cannot be read. It is a
 * function of its two inputs, so a test can draw it with no server.
 */
export function RunningList({ live, now }: { live: AgentsLive; now: number }) {
  return (
    <div className="flex flex-col gap-3">
      {live.sessions.length === 0 ? (
        <p className="text-cc-muted">No active session</p>
      ) : (
        <ul aria-label="Active sessions" className="divide-y divide-cc-rule">
          {live.sessions.map((session) => (
            <SessionRow key={session.id} session={session} nowMs={now} />
          ))}
        </ul>
      )}
      <LiveNotes live={live} />
    </div>
  );
}

export function RunningPanel(placement: PanelPlacement) {
  const result = usePanel<AgentsLive>('/api/agents', AGENTS_MODULES);
  const now = useNow();
  return (
    <GlassPanel id="running" title="Running" {...placement}>
      <PanelContent title="Running" result={result}>
        {(live) => <RunningList live={live} now={now} />}
      </PanelContent>
    </GlassPanel>
  );
}
