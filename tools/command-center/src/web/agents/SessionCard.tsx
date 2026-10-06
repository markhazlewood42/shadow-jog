import { Button } from '@heroui/react';
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, GitBranch, MessageSquare, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { type AgentInfo, type SessionInfo, type SessionState, type WorkflowInfo, sessionAnchor } from '../../shared/types';
import { ProgressBar } from '../now/ProgressBar';
import { RunRow, type RunRowProps } from '../now/RunRow';
import { Age, formatDuration } from '../now/time';

// One session of the Agents page: a card with the title and the state of the session, how long it ran, where its files are, and under them its agents and workflows,
// drawn with the same rows as the Running panel of the Now page. Every word that comes from a session file (the title, the branch, what an agent was asked to do, the
// name of a phase) is shown as text. Nothing here is html.

/**
 * Where Claude Code keeps its session files, written the way a shell reads it. `SessionInfo.folder` is a folder inside it (see shared/types.ts), and it is what the
 * config's `claude.projectsRoot` points at. The server does not send the full path of that folder, so the page writes this one: it is the place where Claude Code
 * keeps its files on every machine (unless `CLAUDE_CONFIG_DIR` moves them), and a shell expands the `~`.
 */
export const CLAUDE_PROJECTS = '~/.claude/projects';

/** A session shows this many of its agents until Mark asks for all of them. The real sessions have up to 55, and a card that long would push the other sessions off the screen. */
export const AGENTS_SHOWN = 5;

/** How long the Copy button says "Copied" before it goes back to "Copy". */
const COPIED_SHOWN_MS = 2000;

/** The words of a session's state. A state is always a word on the page, so it never depends on a color. */
const STATE_WORDS: Record<SessionState, string> = { working: 'working', waiting: 'waiting for you', idle: 'idle', unknown: 'unknown' };

// ---- where the files are ----
// A web page cannot open a file: address, so the page shows each path as text with a button that copies it. The three paths are built from what the server sends
// (the folder and the id of the session, the id of a workflow run), by the layout that Claude Code writes (see src/server/sessions/discover.ts).

/** The file that holds the conversation of a session. */
export const sessionFilePath = (session: SessionInfo): string => `${CLAUDE_PROJECTS}/${session.folder}/${session.id}.jsonl`;

/** The folder that holds the files of a session's agents (`agent-<id>.jsonl`), and, in a folder of its own for each run, the files of its workflows. */
export const agentFilesPath = (session: SessionInfo): string => `${CLAUDE_PROJECTS}/${session.folder}/${session.id}/subagents`;

/** The journal of a workflow run: one row for each agent that started and each that has a result. It is where the phases come from. */
export const journalPath = (session: SessionInfo, workflow: WorkflowInfo): string => `${agentFilesPath(session)}/workflows/${workflow.id}/journal.jsonl`;

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * A path as text, and a button that copies it to the clipboard. `context` names what the path belongs to, so that the buttons of a page with many paths do not all
 * have the same name for a screen reader. The path can be selected with one click, so a person whose browser refuses the clipboard can still copy it by hand.
 */
function FilePath({ label, path, context }: { label: string; path: string; context: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A timer must not outlive the path that it belongs to: when a card leaves the page (its session drops off the list), its timer is stopped.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  async function copy(): Promise<void> {
    if (timer.current !== null) clearTimeout(timer.current);
    try {
      // The clipboard belongs to the browser. A page may use it only when it is a secure page (https, or localhost, which this one is) and the person lets it, and it says no
      // by rejecting the call (or by having no `navigator.clipboard` at all, which throws here too). Either way the person is told, and the button never says "Copied" for a copy that did not happen.
      await navigator.clipboard.writeText(path);
      setState('copied');
      timer.current = setTimeout(() => setState('idle'), COPIED_SHOWN_MS);
    } catch {
      setState('failed');
    }
  }

  const Icon = state === 'copied' ? Check : Copy;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="text-cc-soft">{label}</span>
      <code className="min-w-0 font-mono break-all text-cc-muted select-all">{path}</code>
      <Button size="sm" variant="tertiary" aria-label={`Copy the path of the ${label.toLowerCase()} of ${context}`} onPress={() => void copy()}>
        <Icon aria-hidden className="size-3.5" />
        {state === 'copied' ? 'Copied' : 'Copy'}
      </Button>
      {/* A copy is silent for a person who cannot see the button change, so the result is also said in words. The region is on the page before the words, which is what makes a screen reader read them. */}
      <span role="status" className="sr-only">
        {state === 'copied' ? 'Path copied.' : ''}
      </span>
      {state === 'failed' && (
        // Ink and not amber: the one or two amber items of a page are not spent on an error (the Look).
        <p role="alert" className="flex basis-full items-center gap-1.5 text-cc-muted">
          <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-cc-ink" />
          Could not copy the path. Select it and copy it by hand.
        </p>
      )}
    </div>
  );
}

// ---- how long, and how far ----

const timeOf = (iso: string | null): number | null => {
  const ms = iso === null ? Number.NaN : Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/** How long something ran: from its start to its end, or to now while it has no end. Null when a time that is needed is not known (a length that was guessed would be a wrong one). */
function lengthOf(startedAt: string | null, endedAt: string | null, nowMs: number): number | null {
  const start = timeOf(startedAt);
  if (start === null) return null;
  if (endedAt === null) return nowMs - start;
  const end = timeOf(endedAt);
  return end === null ? null : end - start;
}

/**
 * How long a session has run. A live one (it works, or it waits for Mark) is still running, so its length goes up to now. One that is over ran until its last write,
 * and its length stays the same however long ago that was.
 */
export function sessionRunMs(session: SessionInfo, nowMs: number): number | null {
  const live = session.state === 'working' || session.state === 'waiting';
  return lengthOf(session.startedAt, live ? null : session.lastActivityAt, nowMs);
}

/**
 * The row of an agent: what it was asked to do, its state, a bar, and how long it ran. Claude Code writes no percent for an agent, so its bar says only the three things
 * that are known: it runs (a bar that moves), it is done (a full bar), or it stopped without an end (an empty bar). The Running panel does not list a stopped agent, and this
 * page does, because it is the full list.
 */
export function agentRow(agent: AgentInfo, nowMs: number): RunRowProps {
  return {
    kind: 'agent',
    name: agent.description || agent.agentType || `Agent ${agent.id}`,
    state: agent.state,
    progress: agent.state === 'running' ? null : agent.state === 'done' ? 1 : 0,
    runMs: lengthOf(agent.startedAt, agent.endedAt, nowMs),
    // What kind of agent it is, and the name of its file (it is in the folder of the agent files that the card shows).
    detail: [agent.agentType, agent.model, `agent-${agent.id}.jsonl`].filter((part) => part !== '').join(' · '),
    nested: true,
  };
}

/**
 * The row of a workflow. A journal has no times and no total, so its bar is the agents that are done of the agents that started. Before any agent started there is
 * nothing to measure: a run that is at work has a bar that moves, and any other has an empty one.
 */
export function workflowRow(workflow: WorkflowInfo, nowMs: number): RunRowProps {
  const running = workflow.state === 'running';
  return {
    kind: 'workflow',
    name: workflow.name,
    state: workflow.state,
    progress: workflow.started > 0 ? workflow.done / workflow.started : running ? null : 0,
    // A journal has no times of its own. The run began when its file was made and ended with its last write, so a run that is over has that length and one that is at work has run until now.
    runMs: lengthOf(workflow.startedAt, running ? null : workflow.lastEventAt, nowMs),
    detail: `${workflow.done} of ${workflow.started} agents done`,
    nested: true,
  };
}

/** What runs comes before what does not. The sort is stable, so the rest keeps the order of the server: the newest first. */
export function runningFirst<T extends { state: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running'));
}

// ---- a workflow's phases ----

/** One phase of a workflow: its name, the agents done of the agents that started, and a bar with the same two numbers. */
function PhaseRow({ phase }: { phase: WorkflowInfo['phases'][number] }) {
  const name = phase.name === '' ? 'Unnamed phase' : phase.name;
  const done = `${phase.done} of ${phase.started} agents done`;
  return (
    <li className="flex flex-col gap-1.5 py-2">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm break-words">{name}</p>
        <p className="shrink-0 text-xs text-cc-muted">{done}</p>
      </div>
      <ProgressBar value={phase.started > 0 ? phase.done / phase.started : 0} label={`${name}: ${done}`} />
    </li>
  );
}

/**
 * The button that opens a workflow into its phases, and the phases. A workflow can have hundreds of agents, so they are not listed one by one: the phases (the groups that
 * the workflow's script gave them) say how far each part is. The journal is the file that the phases were read from, so its path is here and not on the card.
 */
function WorkflowPhases({ session, workflow }: { session: SessionInfo; workflow: WorkflowInfo }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="flex flex-col gap-2">
      {/* The button names no state of its own: `aria-expanded` is what tells a screen reader whether the phases are open. */}
      <Button size="sm" variant="tertiary" className="self-start" aria-expanded={open} {...(open ? { 'aria-controls': panelId } : {})} onPress={() => setOpen(!open)}>
        <Chevron aria-hidden className="size-3.5" />
        Phases ({workflow.phases.length})
      </Button>
      {open && (
        <div id={panelId} className="flex flex-col gap-2">
          {workflow.phases.length === 0 ? (
            <p className="text-xs text-cc-muted">The journal names no phase.</p>
          ) : (
            <ul aria-label={`Phases of ${workflow.name}`} className="divide-y divide-cc-rule">
              {workflow.phases.map((phase, index) => (
                // A phase has no id of its own, and a journal names each phase once, so its place in the list is its key.
                <PhaseRow key={`${index}:${phase.name}`} phase={phase} />
              ))}
            </ul>
          )}
          <FilePath label="Journal file" path={journalPath(session, workflow)} context={workflow.name} />
        </div>
      )}
    </div>
  );
}

// ---- the card ----

export type SessionCardProps = {
  session: SessionInfo;
  /** The time now, in milliseconds. The page draws again every 30 seconds, so a length that is still growing grows on the page. */
  now: number;
  /** The address of the page names this session (the link of "Your move"). Its card is marked, and the page scrolled to it. */
  linked: boolean;
};

export function SessionCard({ session, now, linked }: SessionCardProps) {
  const titleId = useId();
  const [showAll, setShowAll] = useState(false);

  // The agents that a workflow started are not rows: a workflow has up to hundreds of them, and its own row (with its phases) stands for them, as on the Running panel.
  const workflows = runningFirst(session.workflows);
  const agents = runningFirst(session.agents.filter((agent) => agent.workflowId === null));
  const shownAgents = showAll ? agents : agents.slice(0, AGENTS_SHOWN);
  const hasRows = workflows.length + agents.length > 0;
  const runMs = sessionRunMs(session, now);

  return (
    <article
      id={sessionAnchor(session.id)}
      aria-labelledby={titleId}
      {...(linked ? { 'aria-current': 'location' as const } : {})}
      // `scroll-mt-20` leaves room for the bar at the top of the page, which stays in view: a card that was scrolled to would stand under it. The card that was linked to is
      // the one focal item of the page (the Look): an amber frame, on the second navy with the amber tint of a focal box.
      className={`flex scroll-mt-20 flex-col gap-3 rounded-md border p-4 ${linked ? 'border-cc-accent cc-focal' : 'border-cc-rule'}`}
    >
      <header className="flex items-start gap-2">
        <MessageSquare aria-hidden className="mt-0.5 size-4 shrink-0 text-cc-muted" />
        <h3 id={titleId} className="min-w-0 flex-1 text-sm font-medium break-words">
          {session.title}
        </h3>
        <p className="shrink-0 text-right text-xs text-cc-muted">
          <span>{STATE_WORDS[session.state]}</span>
          {runMs !== null && (
            <>
              <span className="sr-only">, run time </span>
              <span className="ml-2 font-mono text-cc-soft">{formatDuration(runMs)}</span>
            </>
          )}
        </p>
      </header>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-xs text-cc-soft">
        <span>
          started <Age iso={session.startedAt} now={now} />
        </span>
        <span>
          last active <Age iso={session.lastActivityAt} now={now} />
        </span>
        {session.branch !== '' && (
          <span className="inline-flex items-center gap-1">
            <GitBranch aria-hidden className="size-3 shrink-0" />
            <span className="font-mono break-all">{session.branch}</span>
          </span>
        )}
        {/* The server checked that the address of a pull request is http or https, and that the pull request is of this repository. */}
        {session.prs.map((pr) => (
          <a key={pr.number} href={pr.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cc-link underline underline-offset-2 cc-focus-ring">
            PR #{pr.number}
            <ExternalLink aria-hidden className="size-3" />
          </a>
        ))}
      </p>

      <div className="flex flex-col gap-1.5 pl-6">
        <FilePath label="Session file" path={sessionFilePath(session)} context={session.title} />
        {hasRows && <FilePath label="Agent files" path={agentFilesPath(session)} context={session.title} />}
      </div>

      {hasRows && (
        <div className="flex flex-col gap-2">
          <ul aria-label={`Agents and workflows of ${session.title}`} className="divide-y divide-cc-rule border-t border-cc-rule">
            {workflows.map((workflow) => (
              <RunRow key={`workflow:${workflow.id}`} {...workflowRow(workflow, now)}>
                <WorkflowPhases session={session} workflow={workflow} />
              </RunRow>
            ))}
            {shownAgents.map((agent) => (
              <RunRow key={`agent:${agent.id}`} {...agentRow(agent, now)} />
            ))}
          </ul>
          {agents.length > AGENTS_SHOWN && (
            <Button size="sm" variant="tertiary" className="self-start" aria-expanded={showAll} onPress={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer agents' : `Show all ${agents.length} agents`}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
