import type { AgentInfo, ModuleName, SessionInfo, SessionsInfo, WorkflowInfo } from '../../shared/types';
import { PanelContent } from '../PanelFrame';
import { usePanel } from '../usePanel';
import { GlassPanel, type PanelPlacement } from './GlassPanel';
import { RunRow, type RunRowProps } from './RunRow';
import { useNow } from './time';

// "Running": what is going on right now, one row for each live session, agent and workflow (design 5.1). The full list, with every session of the last
// week and links to its files, is the Agents page.

/** The panel loads again when the sessions module says that something changed (it looks at the session files every 10 seconds). */
const SESSIONS_MODULES: readonly ModuleName[] = ['sessions'];

/** An agent or workflow that finished stays on the list for this long, with a full bar, so that Mark sees that it ended. After that it is old news (the Agents page has it). */
export const FINISHED_KEPT_MS = 10 * 60 * 1000;

/** A row, with the key that React needs to tell it from the others. */
export type RunningRow = RunRowProps & { key: string };

const timeOf = (iso: string | null): number | null => {
  const ms = iso === null ? Number.NaN : Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/** How long something ran: from its start to its end, or to now while it has no end. Null when the start is not known. */
function lengthOf(startedAt: string | null, endedAt: string | null, nowMs: number): number | null {
  const start = timeOf(startedAt);
  if (start === null) return null;
  return (timeOf(endedAt) ?? nowMs) - start;
}

/** Whether something that ended at `endedAt` ended recently enough to be on the list. A time that is not known is not recent. */
function endedRecently(endedAt: string | null, nowMs: number): boolean {
  const end = timeOf(endedAt);
  return end !== null && nowMs - end <= FINISHED_KEPT_MS;
}

function sessionRow(session: SessionInfo, nowMs: number): RunningRow {
  const working = session.state === 'working';
  return {
    key: `session:${session.id}`,
    kind: 'session',
    name: session.title,
    state: working ? 'working' : 'waiting for you',
    // A session that works moves; one that waits for Mark has nothing in progress, and its bar stands empty.
    progress: working ? null : 0,
    runMs: lengthOf(session.startedAt, null, nowMs),
  };
}

function agentRow(agent: AgentInfo, nowMs: number): RunningRow {
  const running = agent.state === 'running';
  return {
    key: `agent:${agent.sessionId}:${agent.id}`,
    kind: 'agent',
    name: agent.description || agent.agentType || `Agent ${agent.id}`,
    state: running ? 'running' : 'done',
    // Agents report no percent done: a running one has a bar that moves, and a finished one a full bar.
    progress: running ? null : 1,
    runMs: lengthOf(agent.startedAt, agent.endedAt, nowMs),
    nested: true,
  };
}

function workflowRow(workflow: WorkflowInfo, nowMs: number): RunningRow {
  const running = workflow.state === 'running';
  const phases = workflow.phases.map((phase) => `${phase.name || 'phase'} ${phase.done}/${phase.started}`).join(', ');
  return {
    key: `workflow:${workflow.sessionId}:${workflow.id}`,
    kind: 'workflow',
    name: workflow.name,
    state: running ? 'running' : 'done',
    // A workflow has real progress: the agents that are done of the agents that started. Before any started, there is nothing to measure.
    progress: running ? (workflow.started > 0 ? workflow.done / workflow.started : null) : 1,
    runMs: lengthOf(workflow.startedAt, running ? null : workflow.lastEventAt, nowMs),
    detail: `${workflow.done} of ${workflow.started} agents done${phases === '' ? '' : `. Phases: ${phases}`}`,
    nested: true,
  };
}

/**
 * The rows of the panel, in order: each live session (working, or waiting for Mark) with, under it, its agents and workflows that are running or that
 * finished a few minutes ago. A session that is idle, or that this page cannot read, is not live and has no row. An agent that a workflow started is not
 * a row of its own (a workflow has hundreds of them): the row of the workflow stands for them, with its progress. An agent or workflow that stopped without
 * ending (nothing was written for a while) has no row either: it is not running, and it did not finish.
 */
export function runningRows(info: SessionsInfo, nowMs: number): RunningRow[] {
  return info.sessions
    .filter((session) => session.state === 'working' || session.state === 'waiting')
    .flatMap((session) => {
      const agents = session.agents.filter((agent) => agent.workflowId === null && (agent.state === 'running' || (agent.state === 'done' && endedRecently(agent.endedAt, nowMs))));
      const workflows = session.workflows.filter((workflow) => workflow.state === 'running' || (workflow.state === 'done' && endedRecently(workflow.lastEventAt, nowMs)));
      // What still runs comes before what just ended.
      const stillRunning = (state: string) => (state === 'running' ? 0 : 1);
      const nested = [
        ...agents.map((agent) => ({ order: stillRunning(agent.state), row: agentRow(agent, nowMs) })),
        ...workflows.map((workflow) => ({ order: stillRunning(workflow.state), row: workflowRow(workflow, nowMs) })),
      ]
        .sort((a, b) => a.order - b.order)
        .map((entry) => entry.row);
      return [sessionRow(session, nowMs), ...nested];
    });
}

function RunningList({ info, now }: { info: SessionsInfo; now: number }) {
  const rows = runningRows(info, now);
  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <p className="text-cc-muted">Nothing is running right now. A session, an agent or a workflow that works shows up here.</p>
      ) : (
        <ul aria-label="Running now" className="divide-y divide-cc-rule">
          {rows.map(({ key, ...row }) => (
            <RunRow key={key} {...row} />
          ))}
        </ul>
      )}
      {info.hiddenSdk > 0 && (
        <p className="text-xs text-cc-soft">
          {info.hiddenSdk} automated SDK {info.hiddenSdk === 1 ? 'run is' : 'runs are'} hidden: a script started {info.hiddenSdk === 1 ? 'it' : 'them'}, not Mark.
        </p>
      )}
    </div>
  );
}

export function RunningPanel(placement: PanelPlacement) {
  const result = usePanel<SessionsInfo>('/api/sessions', SESSIONS_MODULES);
  const now = useNow();
  return (
    <GlassPanel id="running" title="Running" {...placement}>
      <PanelContent title="Running" result={result}>
        {(info) => <RunningList info={info} now={now} />}
      </PanelContent>
    </GlassPanel>
  );
}
