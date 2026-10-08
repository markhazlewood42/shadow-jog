import { Link } from 'react-router';
import { APP_NAME, type AgentsLive, type ModuleName } from '../../shared/types';
import { PanelFrame } from '../PanelFrame';
import { useDocumentTitle } from '../docs/useDocumentTitle';
import { useNow } from '../now/time';
import { usePanel } from '../usePanel';
import { Diagram } from './Diagram';

// The Agents page (/agents): a live diagram of the Claude sessions about Shadow Jog that are alive now, and of the agents and workflows that each one started (design 5.4, revision 2).
// It reads GET /api/agents. The server decides what is alive (it starts from the process list of Claude Code) and in what order the sessions stand, and this page does not filter or
// sort them again: what the server sends is what is drawn. The page has no sentence: the heading and the labels say what is there.

/** The page loads again when the agents module says that something changed (it looks at the process list every 3 seconds). */
const AGENTS_MODULES: readonly ModuleName[] = ['agents'];

/** The run times on the boxes move on every 15 seconds, between two loads of the data. */
const TICK_MS = 15_000;

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

export function AgentsPage() {
  useDocumentTitle('Agents');
  const result = usePanel<AgentsLive>('/api/agents', AGENTS_MODULES);
  const now = useNow(TICK_MS);

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto flex max-w-[96rem] flex-col gap-6 px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <PanelFrame title="Agents" result={result}>
          {(live) => <Diagram live={live} nowMs={now} />}
        </PanelFrame>
      </main>
    </div>
  );
}
