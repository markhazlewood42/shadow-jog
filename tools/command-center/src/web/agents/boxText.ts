import type { LiveNode, LiveSession } from '../../shared/types';
import { formatDuration, msSince } from '../now/time';

// The words of the Agents diagram (design 5.4, revision 2): the detail line of each kind of box, and the line that the text list under the diagram has for it. They are plain
// functions of the data and of the clock, so the boxes and the list say the same thing and a test can fix the clock. All of them are labels, state words, names, numbers and times:
// no function here makes a sentence.

/** Between the parts of a detail line: a middle dot with a space on each side. */
const JOINT = ' · ';

/** The parts that are there, joined: a missing part (null, or empty) leaves no gap and no separator. */
const joined = (parts: readonly (string | null | undefined)[], joint: string = JOINT): string => parts.filter((part): part is string => part !== null && part !== undefined && part !== '').join(joint);

/** How long something has run, from its start to now: "45 s", "12 min", "1 h 5 min". Null when the start is not known, so a box shows no time and never a guess. */
export function runTimeText(startedAt: string | null, nowMs: number): string | null {
  const ms = msSince(startedAt, nowMs);
  return ms === null ? null : formatDuration(ms);
}

/** The detail line of a session box, after its dot: the state word and the run time ("working · 12 min"). */
export const sessionDetail = (session: LiveSession, nowMs: number): string => joined([session.state, runTimeText(session.startedAt, nowMs)]);

/**
 * The detail line of an agent box: the model and the run time ("fable · 12 min"), or the model and "done" once the agent ended. A finished agent has no time: its length would
 * not grow any more, and the word says so. An agent with no model has no model word.
 */
export const agentDetail = (node: LiveNode, nowMs: number): string => joined([node.model, node.state === 'done' ? 'done' : runTimeText(node.startedAt, nowMs)]);

/** The progress chip of a workflow box: the phase and the agents done of the agents started ("Build · 2 of 3"), or only the numbers when the journal names no phase. */
export const workflowChip = (node: LiveNode): string => (node.progress === undefined ? '' : joined([node.progress.phase, `${node.progress.done} of ${node.progress.started}`]));

/** "2 messages", "1 message", "3+ messages" (the plus: the count may be short). Null when none passed, because there is nothing to say. */
export function messagesText({ count, approximate }: LiveNode['messages']): string | null {
  if (count <= 0) return null;
  return `${count}${approximate ? '+' : ''} ${count === 1 && !approximate ? 'message' : 'messages'}`;
}

// ---- the text list ----
// The list under the diagram (TextList.tsx) is what a screen reader and a test read, so it holds the same facts as the boxes, as words in a row: the name first, then the
// state and the time. It uses commas, because it is read aloud.

/** A session: "title, working, 30 min". */
export const sessionListText = (session: LiveSession, nowMs: number): string => joined([session.title, session.state, runTimeText(session.startedAt, nowMs)], ', ');

/** An agent: "label, model, running, 12 min, 2 messages". A workflow: "name, workflow, running, Build · 2 of 3". A finished one has "done" and no time. */
export function nodeListText(node: LiveNode, nowMs: number): string {
  if (node.kind === 'workflow') return joined([node.label, 'workflow', node.state, workflowChip(node)], ', ');
  return joined([node.label, node.model, node.state, node.state === 'done' ? null : runTimeText(node.startedAt, nowMs), messagesText(node.messages)], ', ');
}
