import type { LiveNode, LiveSession } from '../../shared/types';
import { nodeListText, sessionListText } from './boxText';
import { childrenOf } from './layout';

// The text list under the Agents diagram (design 5.4, revision 2): every session and every agent in words. It is visually hidden: a screen reader reads it, and the end-to-end
// tests read it. It names every box, also the ones that the diagram leaves out after its limit of 12 children, because the limit is a matter of room on the screen and not of facts.
// It uses the same tree as the layout (`childrenOf`), so an agent that another agent started is in the list of its parent.

type Tree = ReadonlyMap<string, readonly LiveNode[]>;

/** The agents and workflows that hang under one parent, each with the ones that hang under it. */
function Branch({ parentId, tree, nowMs }: { parentId: string; tree: Tree; nowMs: number }) {
  const nodes = tree.get(parentId);
  if (nodes === undefined) return null;
  return (
    <ul>
      {nodes.map((node) => (
        <li key={node.id}>
          <span>{nodeListText(node, nowMs)}</span>
          <Branch parentId={node.id} tree={tree} nowMs={nowMs} />
        </li>
      ))}
    </ul>
  );
}

export function TextList({ sessions, nowMs }: { sessions: readonly LiveSession[]; nowMs: number }) {
  if (sessions.length === 0) return null;
  return (
    <ul aria-label="Sessions and agents" className="sr-only">
      {sessions.map((session) => (
        <li key={session.id}>
          <span>{sessionListText(session, nowMs)}</span>
          <Branch parentId={session.id} tree={childrenOf(session)} nowMs={nowMs} />
        </li>
      ))}
    </ul>
  );
}
