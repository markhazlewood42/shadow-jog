import { type AgentsLive, type ModuleName } from '../../shared/types';
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

export function AgentsPage() {
  useDocumentTitle('Agents');
  const result = usePanel<AgentsLive>('/api/agents', AGENTS_MODULES);
  const now = useNow(TICK_MS);
  // Under an error the panel draws the last good data too. That data may be old, so the diagram says nothing about a linked session then (see Diagram).
  const current = result.state === 'ready';

  return (
    <div className="min-h-screen">
      <main className="mx-auto flex max-w-[96rem] flex-col gap-6 px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <PanelFrame title="Agents" result={result}>
          {(live) => <Diagram live={live} nowMs={now} current={current} />}
        </PanelFrame>
      </main>
    </div>
  );
}
