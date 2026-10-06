import { Bot, MessageSquare, Workflow } from 'lucide-react';
import type { ReactNode } from 'react';
import { ProgressBar } from './ProgressBar';
import { formatDuration } from './time';

/** The three kinds of thing that the Running panel lists, each with its own icon. */
export type RunKind = 'session' | 'agent' | 'workflow';

const ICONS = { session: MessageSquare, agent: Bot, workflow: Workflow } as const;

export type RunRowProps = {
  kind: RunKind;
  /** The name of the thing: the title of a session, what an agent was asked to do, the name of a workflow. This is transcript text: it is shown as text. */
  name: string;
  /** The state in words ("working", "waiting for you", "running", "done"). It is written out, so the state never depends on a color or a bar. */
  state: string;
  /** How far along the thing is, from 0 to 1, or null while it runs and nothing says how far (see ProgressBar). */
  progress: number | null;
  /** How long it has run, in milliseconds, or null when that is not known. */
  runMs: number | null;
  /** A second line under the name (for a workflow: the agents done and the phase it is in). */
  detail?: string;
  /** The agents and workflows of a session are drawn under the session and a little to the right of it. */
  nested?: boolean;
  /** Anything that belongs to the row and goes under its bar. The Agents page puts the phases of a workflow there. The Running panel has none. */
  children?: ReactNode;
};

/**
 * One row of the Running panel (and of the Agents page, which lists the same things in full): what it is, its state, a bar, and how long it has run. The bar and the words say the same thing two ways, so a person who
 * cannot see the bar (or has turned its motion off) still reads the state, and one who skims sees the bar.
 */
export function RunRow({ kind, name, state, progress, runMs, detail, nested = false, children }: RunRowProps) {
  const Icon = ICONS[kind];
  return (
    <li className={`flex flex-col gap-1.5 py-2.5 ${nested ? 'pl-6' : ''}`}>
      <div className="flex items-start gap-2">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-cc-muted" />
        <p className="min-w-0 flex-1 text-sm font-medium break-words">{name}</p>
        <p className="shrink-0 text-right text-xs text-cc-muted">
          {state}
          {runMs !== null && <span className="ml-2 font-mono text-cc-soft">{formatDuration(runMs)}</span>}
        </p>
      </div>
      {detail !== undefined && <p className="pl-6 text-xs text-cc-muted break-words">{detail}</p>}
      <div className="pl-6">
        <ProgressBar value={progress} label={`${state}: ${name}`} />
      </div>
      {children !== undefined && <div className="pl-6">{children}</div>}
    </li>
  );
}
