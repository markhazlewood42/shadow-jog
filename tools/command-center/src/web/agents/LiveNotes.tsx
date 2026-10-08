import type { AgentsLive } from '../../shared/types';

// The two small labels that go with every view of the live sessions (design 5.1 and 5.4, revision 2): how many sessions of a script are left out, and that the file ages
// decided because the process list cannot be read. The Running panel of the Now page and the Agents page show the same two from the same data, so they share this one
// component, and the words cannot drift apart.

/** "1 script run hidden", "3 script runs hidden": the number and the noun that agrees with it. */
const hiddenRunsLabel = (count: number): string => `${count} script ${count === 1 ? 'run' : 'runs'} hidden`;

/**
 * The labels, in this order: the runs that a script started and that are left out (a label only when there are some), then the state of the source (a label only when the
 * file ages decided). Each is a paragraph of small text, and nothing is a sentence. The component draws no frame of its own, so a view puts the labels where it needs them.
 */
export function LiveNotes({ live }: { live: Pick<AgentsLive, 'hiddenScripts' | 'source'> }) {
  return (
    <>
      {live.hiddenScripts > 0 && <p className="text-xs text-cc-soft">{hiddenRunsLabel(live.hiddenScripts)}</p>}
      {live.source === 'file-age' && <p className="text-xs text-cc-soft">Process list unavailable</p>}
    </>
  );
}
