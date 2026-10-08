import { Bot, MessageSquare, Workflow } from 'lucide-react';
import { useId } from 'react';
import type { LiveNode, LiveSession } from '../../shared/types';
import { agentDetail, sessionDetail, workflowChip } from './boxText';
import { CopyButton } from './CopyButton';
import type { LayoutBox } from './layout';

// One box of the Agents diagram (design 5.4, revision 2): a session, an agent or a workflow. A box is small and has a fixed size: one title line and one detail line. The title
// is cut with an ellipsis when it is too long, and the whole text is in its `title` attribute. Every word that comes from a session file (the title, the label of an agent, the name of
// a workflow, the name of a phase) is shown as text. Nothing here is html.

/** What a box shows: the session, or one of its nodes. */
export type BoxData = LiveSession | LiveNode;

/** A box to draw: where it goes (from the layout), and what it shows. The page keeps the entry of a box that left, so that it can draw the box once more while it fades out. */
export type BoxEntry = { box: LayoutBox; data: BoxData };

const isSession = (data: BoxData): data is LiveSession => 'nodes' in data;

const ICONS = { session: MessageSquare, agent: Bot, workflow: Workflow } as const;

/**
 * The look of a box that is alive, and of one that is done. A finished agent is dimmed with the tokens and not with `opacity`: the frame turns to the hairline, and the title
 * and the detail to the quieter text colors. Text on a faded box would fall below the 4.5 to 1 that every text keeps (docs/diagrams/profile/NOTES.md); these colors keep it.
 */
const LOOK = {
  alive: { frame: 'border-cc-rule-solid', title: 'text-cc-ink', detail: 'text-cc-muted', icon: 'text-cc-muted' },
  done: { frame: 'border-cc-rule', title: 'text-cc-muted', detail: 'text-cc-soft', icon: 'text-cc-soft' },
} as const;

/** The dot before the state word of a session: filled while it works, an outline while it waits for Mark. It is decoration: the state is also a word, so no color is needed. */
function StateDot({ working }: { working: boolean }) {
  return <span aria-hidden data-dot={working ? 'filled' : 'outlined'} className={`size-2 shrink-0 rounded-full border border-current text-cc-ink ${working ? 'bg-current' : ''}`} />;
}

/** The detail line: for a session, the dot and "working · 12 min"; for an agent, "fable · 12 min" or "fable · done"; for a workflow, one chip with its progress. */
function Detail({ data, nowMs }: { data: BoxData; nowMs: number }) {
  if (isSession(data)) {
    return (
      <>
        <StateDot working={data.state === 'working'} />
        {sessionDetail(data, nowMs)}
      </>
    );
  }
  if (data.kind === 'workflow') {
    // A workflow with no progress (the server always sends one) would be an empty chip: no chip, then.
    const chip = workflowChip(data);
    if (chip === '') return null;
    return (
      <span data-chip className="max-w-full truncate rounded-sm border border-cc-rule-solid px-1.5 font-mono text-xs leading-[14px] text-cc-ink">
        {chip}
      </span>
    );
  }
  return <>{agentDetail(data, nowMs)}</>;
}

type BoxViewProps = {
  entry: BoxEntry;
  /** The time now, in milliseconds. The run time in the detail line is counted to it. */
  nowMs: number;
  /** The box left the data and is waiting for its fade-out. */
  leaving: boolean;
};

/**
 * The box. The outer element is the one that is placed: it sits at the corner of the cluster and is moved to its place with a `transform`, which CSS can slide (a transition on
 * `transform`, 200 ms). The inner element is the one that draws: it fades and slides in when the box is new (an animation, which would fight with the transform if it were on the
 * outer element). A box that is leaving fades out through the `data-leaving` mark on the outer element.
 */
export function BoxView({ entry, nowMs, leaving }: BoxViewProps) {
  const { box, data } = entry;
  const titleId = useId();
  const title = isSession(data) ? data.title : data.label;
  const look = !isSession(data) && data.state === 'done' ? LOOK.done : LOOK.alive;
  const Icon = ICONS[box.kind];

  return (
    <div
      // A group named by its title: a screen reader says the title before the Copy button, so the buttons of many boxes are not all just "Copy path".
      role="group"
      aria-labelledby={titleId}
      data-box={box.kind}
      data-state={data.state}
      {...(leaving ? { 'data-leaving': 'true' } : {})}
      className="absolute top-0 left-0 data-leaving:pointer-events-none data-leaving:opacity-0 motion-safe:transition-[transform,opacity] motion-safe:duration-200 motion-safe:ease-out"
      style={{ width: box.w, height: box.h, transform: `translate(${box.x}px, ${box.y}px)` }}
    >
      <div className={`flex h-full flex-col justify-center overflow-hidden rounded-md border bg-cc-paper px-2.5 motion-safe:animate-cc-box-in ${look.frame}`}>
        <div className="flex h-4 items-center gap-1.5">
          <Icon aria-hidden className={`size-3.5 shrink-0 ${look.icon}`} />
          <span id={titleId} data-part="title" title={title} className={`min-w-0 flex-1 truncate text-[13px] leading-4 font-medium ${look.title}`}>
            {title}
          </span>
        </div>
        {/* The Copy button is at the end of the detail line, where there is room (a detail is short), so that the title keeps the whole width of its line. */}
        <div className="flex h-4 items-center gap-1.5 pl-5">
          <div data-part="detail" className={`flex min-w-0 flex-1 items-center gap-1.5 text-xs leading-4 whitespace-nowrap ${look.detail}`}>
            <Detail data={data} nowMs={nowMs} />
          </div>
          {data.filePath !== null && <CopyButton path={data.filePath} />}
        </div>
      </div>
    </div>
  );
}
