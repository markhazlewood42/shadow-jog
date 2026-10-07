import { Info } from 'lucide-react';
import { type RefObject, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import { APP_NAME, type ModuleName, type SessionsInfo, sessionAnchor } from '../../shared/types';
import { PanelFrame } from '../PanelFrame';
import { useDocumentTitle } from '../docs/useDocumentTitle';
import { useNow } from '../now/time';
import { usePanel } from '../usePanel';
import { SessionCard } from './SessionCard';

// The Agents page (/agents): the full list behind "Running" on the Now page (design 5.4). Every recent session about Shadow Jog, the newest first, each with its agents and
// workflows, how long it ran, and where its files are. The server decides which sessions are listed (the files of the last week, kept to Shadow Jog by their working folder),
// and this page does not filter them again: what the server sends is what is drawn.

/** The page loads again when the sessions module says that something changed (it looks at the session files every 10 seconds). */
const SESSIONS_MODULES: readonly ModuleName[] = ['sessions'];

/** The start of the fragment of a link to a session (`#session-<id>`). Any other fragment is not a link to a session. */
const SESSION_FRAGMENT = `#${sessionAnchor('')}`;

/** The top bar: the name of the tool and the pages of the site. This page is the current one. */
function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-cc-rule-solid bg-cc-paper">
      <div className="mx-auto flex max-w-[96rem] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link to="/" className="font-semibold tracking-tight cc-focus-ring">
          {APP_NAME}
        </Link>
        <nav aria-label="Main" className="flex items-center gap-4 text-sm">
          <Link to="/" className="text-cc-muted hover:text-cc-ink cc-focus-ring">
            Now
          </Link>
          <Link to="/docs" className="text-cc-muted hover:text-cc-ink cc-focus-ring">
            Docs
          </Link>
          <Link to="/agents" aria-current="page" className="text-cc-ink cc-focus-ring">
            Agents
          </Link>
        </nav>
      </div>
    </header>
  );
}

/**
 * Scrolls to the element with this id once the page has it. The list loads after the page opens, so when the page is opened by a link to a session the browser's own jump to a
 * fragment finds nothing, and this does the jump when the card is there. It jumps once for each address: a list that loads again (every change of the sessions does it) must not
 * pull the page back while Mark reads. `scrolledTo` is kept by the page and not by the list, because the list is drawn in another place when a load fails (with the last good
 * data under the error), and a list that starts again would forget that it had scrolled.
 */
function useScrollTo(scrolledTo: RefObject<string | null>, id: string | null, present: boolean): void {
  useEffect(() => {
    if (id === null) {
      // The address has no link to a session any more: a link to the same session later is a new link, and scrolls again.
      scrolledTo.current = null;
      return;
    }
    if (!present || scrolledTo.current === id) return;
    scrolledTo.current = id;
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, [scrolledTo, id, present]);
}

/** "1 recent session file was looked at.", "3 recent session files were looked at.": the number and the verb that agrees with it. */
const lookedAt = (count: number): string => `${count} recent session ${count === 1 ? 'file was' : 'files were'} looked at.`;

/**
 * What the page says when it has no session to list. The words say why, because "empty" can mean two very different things: nothing was written in the window, or files were
 * found and none is a session of this project.
 */
function EmptyState({ info }: { info: SessionsInfo }) {
  return (
    <div className="flex flex-col gap-1 text-cc-muted">
      <p className="font-medium text-cc-ink">No session matches.</p>
      {info.scanned === 0 ? (
        <p>
          No session file was written in the recent window (7 days by default). The setting <code className="font-mono text-cc-soft">claude.recentSeconds</code> in the config sets the window.
        </p>
      ) : (
        <p>
          {lookedAt(info.scanned)}
          {info.skipped > 0 && ` ${info.skipped} ${info.skipped === 1 ? 'is' : 'are'} not about Shadow Jog, or could not be read.`}
        </p>
      )}
    </div>
  );
}

/** The note that says how many automated runs the list leaves out, with the setting that lists them. It is the same note as the Running panel has (ruling R18), and the page never hides a count silently. */
function HiddenSdkNote({ count }: { count: number }) {
  const one = count === 1;
  return (
    <p className="text-xs text-cc-soft">
      {count} automated SDK {one ? 'run is' : 'runs are'} hidden: a script started {one ? 'it' : 'them'}, not Mark. Set <code className="font-mono">claude.includeSdk</code> to true in the config to list{' '}
      {one ? 'it' : 'them'}.
    </p>
  );
}

/** The notice for a link to a session that is not in the list: it is older than the window, it is gone, or it was never there. A link that goes nowhere must say so. */
function SessionNotFound() {
  return (
    <div role="note" aria-label="Session not found" className="flex items-start gap-2 rounded-md border border-cc-rule-solid px-3 py-2 text-xs text-cc-muted">
      <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-cc-ink" />
      <p>The session in the link is not in this list. It may be older than the recent window, or its file may be gone.</p>
    </div>
  );
}

function SessionList({ info, now, scrolledTo }: { info: SessionsInfo; now: number; scrolledTo: RefObject<string | null> }) {
  // A link to a session ends in `#session-<id>` (see sessionHref in shared/types.ts, which "Your move" uses). The router keeps the fragment of the address as `hash`.
  const { hash } = useLocation();
  const linked = hash.startsWith(SESSION_FRAGMENT) ? hash.slice(1) : null;
  const found = linked !== null && info.sessions.some((session) => sessionAnchor(session.id) === linked);
  useScrollTo(scrolledTo, linked, found);

  return (
    <div className="flex flex-col gap-4">
      {linked !== null && !found && <SessionNotFound />}
      {info.sessions.length === 0 ? (
        <EmptyState info={info} />
      ) : (
        <ol aria-label="Sessions, newest first" className="flex flex-col gap-4">
          {info.sessions.map((session) => (
            <li key={session.id}>
              <SessionCard session={session} now={now} linked={sessionAnchor(session.id) === linked} />
            </li>
          ))}
        </ol>
      )}
      {info.hiddenSdk > 0 && <HiddenSdkNote count={info.hiddenSdk} />}
    </div>
  );
}

export function AgentsPage() {
  useDocumentTitle('Agents');
  const result = usePanel<SessionsInfo>('/api/sessions', SESSIONS_MODULES);
  const now = useNow();
  const scrolledTo = useRef<string | null>(null);

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="mt-1 max-w-prose text-cc-muted">
            Recent Claude sessions about Shadow Jog, the newest first, with their agents and workflows. The Running panel of the Now page shows only what is live: this is the full list.
          </p>
        </div>
        <PanelFrame title="Sessions" result={result}>
          {(info) => <SessionList info={info} now={now} scrolledTo={scrolledTo} />}
        </PanelFrame>
      </main>
    </div>
  );
}
