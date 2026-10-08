import type { LiveNode, LiveSession } from '../../shared/types';

// The layout of one cluster of the Agents diagram (design 5.4, revision 2). A cluster is one live session: the session box on top and, below it, the agents and workflows
// that it started, each one a box in a column, joined to its parent by lines.
//
// This file is a plain function of data. It reads no DOM and draws nothing: it only works out numbers (where each box goes, which points each line passes through, how big the
// cluster is). Then the components draw them (Cluster.tsx): the boxes as HTML, the lines as one SVG layer behind the boxes. Keeping the numbers apart from the drawing is what
// makes them testable without a browser (tests/agents-layout.test.ts), and what lets the size of a box change in one place.
//
// All numbers are pixels in the coordinate system of the cluster: x grows to the right, y grows downward, and (0, 0) is the top left corner of the session box.
//
//   ┌──────────────────────┐   the session box (240 by 52)
//   └──────────────────────┘
//    │                          the trunk of the session: a vertical line from the bottom of the session box
//    ├────────►┌────────────┐   a spawn line (solid, with an arrow): from the trunk to the left edge of a box
//    │         └────────────┘
//    │   ┄ 2 ┄►┌────────────┐   ... and, when messages passed, a message line (dashed, with the count) next to it
//    │         │ nested ... │
//    │         └────────────┘
//    │              │             an agent that started another agent has a trunk of its own, and its child is one level to the right
//    └────────►┌────────────┐
//              └────────────┘

/**
 * The fixed sizes of the diagram, in pixels. They are one object so that a change after a look at the screen is a change in one place. A box has one size for its kind
 * (design 5.4: boxes have fixed sizes), so a box never changes size when its text changes: the text is cut instead.
 */
const TRUNK_INSET = 12;
const ARM = 44;
export const SIZES = {
  session: { w: 240, h: 52 },
  node: { w: 216, h: 44 },
  /** The space between two boxes of a column. */
  rowGap: 12,
  /** The space between the session box and its first child. The trunk shows in it. */
  sessionGap: 18,
  /** A trunk runs down at this distance from the left edge of its parent. */
  trunkInset: TRUNK_INSET,
  /** From a trunk to the left edge of a child: the length of the spawn line. The count of a message line sits in this space. */
  arm: ARM,
  /** How far each level moves to the right. A child is one `arm` right of the trunk of its parent. */
  indent: TRUNK_INSET + ARM,
  /** A spawn line stops this far from the box, so that the point of its arrow touches the box and does not go into it. */
  arrowGap: 1,
  /** A parent shows this many children, and a label counts the others. */
  maxChildren: 12,
  /** The height of the label "+N more". */
  moreHeight: 20,
  /** The label with the count of a message line: its height, the room around its text, and the width of one character of its 12 px mono text (7.2 px, kept to whole pixels). */
  badge: { h: 14, pad: 8, char: 7 },
  /** A message line is level, this far above the bottom edge of its box (so it is under the spawn line, which is at the middle). */
  messageInset: 8,
  /** A message line starts this far right of the trunk, and stops this far left of the box. */
  messageStart: 4,
  messageEnd: 6,
} as const;

export type Point = { x: number; y: number };

export type BoxKind = 'session' | 'agent' | 'workflow';

/** The place of one box. `id` is the id of the session or of the node that the box shows. `depth` is 0 for the session, 1 for what it started, 2 for what those started ... */
export type LayoutBox = { id: string; kind: BoxKind; depth: number; x: number; y: number; w: number; h: number };

export type LineKind = 'trunk' | 'spawn' | 'messages';

/**
 * One line, as the points it passes through and as an SVG path (`path` is `pathOf(points)`).
 * - `trunk`: the vertical line under a parent that has children. `ownerId` is the parent.
 * - `spawn`: the solid line from the trunk of a parent to the box of a child, which the page ends with an arrow. `ownerId` is the child.
 * - `messages`: the dashed line next to a spawn line, for a child whose messages count is above 0. `ownerId` is the child, and `count` is the label that sits on the line.
 * Every line is level or plumb, so a line never has a slope that could cut a corner of a box.
 */
export type LayoutLine = {
  id: string;
  kind: LineKind;
  ownerId: string;
  points: Point[];
  path: string;
  count?: { text: string; x: number; y: number; w: number; h: number };
};

/** The label "+N more" under the last child that is shown, for a parent with more children than the limit. `count` is how many boxes are left out, the grandchildren included. */
export type LayoutMore = { parentId: string; count: number; text: string; x: number; y: number; w: number; h: number };

export type ClusterLayout = { width: number; height: number; boxes: LayoutBox[]; lines: LayoutLine[]; more: LayoutMore[] };

/** An SVG path through these points: a move to the first, and a straight line to each of the others (`M 12 52 L 12 92`). */
export function pathOf(points: readonly Point[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

/**
 * The nodes of a session by their id, in the order of the data. A node that repeats an id that came before, or has the id of the session, is left out, because two boxes
 * cannot have one id (the id is the key of a box on the page).
 */
export function nodeIndex(session: LiveSession): Map<string, LiveNode> {
  const byId = new Map<string, LiveNode>();
  for (const node of session.nodes) {
    if (node.id !== session.id && !byId.has(node.id)) byId.set(node.id, node);
  }
  return byId;
}

/**
 * Who hangs under whom: the nodes of a session by the id of their parent, each list in the order of the data. The data comes from files that Claude Code writes, so this
 * is careful not to lose a box or to loop:
 * - a node whose parent is the session, or a node whose own chain of parents ends at the session, hangs where its `parentId` says;
 * - any other node (its parent is not in the list, or the parents form a loop) hangs on the session. No node is dropped.
 * A node that `nodeIndex` leaves out (a repeated id) is not in the tree. The page and the list of text under it use the same function, so they always agree on the shape of the tree.
 */
export function childrenOf(session: LiveSession): Map<string, LiveNode[]> {
  const byId = nodeIndex(session);

  /** Whether the chain of parents of a node ends at the session (and does not run in a circle on the way). */
  const reachesSession = (start: LiveNode): boolean => {
    const seen = new Set<string>([start.id]);
    let at = start.parentId;
    while (at !== session.id) {
      if (seen.has(at)) return false;
      seen.add(at);
      const parent = byId.get(at);
      if (parent === undefined) return false;
      at = parent.parentId;
    }
    return true;
  };

  const children = new Map<string, LiveNode[]>();
  for (const node of byId.values()) {
    const parentId = reachesSession(node) ? node.parentId : session.id;
    const siblings = children.get(parentId);
    if (siblings === undefined) children.set(parentId, [node]);
    else siblings.push(node);
  }
  return children;
}

/** The text of a count: `2`, or `2+` when the count may be short because the part of the file that was read was cut. */
function countText(messages: LiveNode['messages']): string {
  return `${messages.count}${messages.approximate ? '+' : ''}`;
}

/**
 * Turns one live session into the place of every box, the paths of the lines and the size of the cluster.
 *
 * The rows are laid out from the top. A child gets the next free row, and the children of that child follow it at once, one level to the right, before the next child:
 * the order of the data is kept among brothers, and a nested agent stands under its parent. A box never moves because another box changed state or got a message: only a
 * box that comes or goes moves the boxes after it. A parent shows at most `SIZES.maxChildren` children, and the label "+N more" counts the rest.
 */
export function layoutSession(session: LiveSession): ClusterLayout {
  const children = childrenOf(session);
  const root: LayoutBox = { id: session.id, kind: 'session', depth: 0, x: 0, y: 0, w: SIZES.session.w, h: SIZES.session.h };
  const boxes: LayoutBox[] = [root];
  const lines: LayoutLine[] = [];
  const more: LayoutMore[] = [];

  /** The top of the next free row. */
  let nextRow = root.h + SIZES.sessionGap;

  /** The number of boxes in the part of the tree under these nodes, the nodes themselves included. */
  const sizeOf = (nodes: readonly LiveNode[]): number => nodes.reduce((sum, node) => sum + 1 + sizeOf(children.get(node.id) ?? []), 0);

  const line = (kind: LineKind, ownerId: string, points: Point[], count?: LayoutLine['count']): LayoutLine => ({
    id: `${kind}:${ownerId}`,
    kind,
    ownerId,
    points,
    path: pathOf(points),
    ...(count === undefined ? {} : { count }),
  });

  /** The dashed line of a child with messages: a short level segment in the arm, under the spawn line, with the count as a label on its middle. */
  const messageLine = (node: LiveNode, box: LayoutBox, trunkX: number): LayoutLine => {
    const y = box.y + box.h - SIZES.messageInset;
    const from = { x: trunkX + SIZES.messageStart, y };
    const to = { x: box.x - SIZES.messageEnd, y };
    const text = countText(node.messages);
    const w = SIZES.badge.pad + SIZES.badge.char * text.length;
    return line('messages', node.id, [from, to], { text, x: Math.round((from.x + to.x) / 2 - w / 2), y: y - SIZES.badge.h / 2, w, h: SIZES.badge.h });
  };

  /** Places the children of one parent, each followed by its own children. */
  const placeChildrenOf = (parent: LayoutBox): void => {
    const all = children.get(parent.id) ?? [];
    if (all.length === 0) return;
    const shown = all.slice(0, SIZES.maxChildren);
    const depth = parent.depth + 1;
    const x = depth * SIZES.indent;
    const trunkX = parent.x + SIZES.trunkInset;

    // The trunk is worked out after its children are placed (it ends at the last of them) but goes in the list before their lines: a parent's lines come first, so the
    // page draws the trunk under the arms that branch off it.
    const trunkAt = lines.length;
    let lastMiddle = parent.y + parent.h;
    for (const node of shown) {
      const box: LayoutBox = { id: node.id, kind: node.kind, depth, x, y: nextRow, w: SIZES.node.w, h: SIZES.node.h };
      boxes.push(box);
      const middle = box.y + box.h / 2;
      lines.push(line('spawn', node.id, [{ x: trunkX, y: middle }, { x: box.x - SIZES.arrowGap, y: middle }]));
      if (node.messages.count > 0) lines.push(messageLine(node, box, trunkX));
      lastMiddle = middle;
      nextRow = box.y + box.h + SIZES.rowGap;
      placeChildrenOf(box);
    }
    // The trunk runs from the bottom of the parent to the middle of its last child that is shown: the arms of the other children branch off it on the way.
    lines.splice(trunkAt, 0, line('trunk', parent.id, [{ x: trunkX, y: parent.y + parent.h }, { x: trunkX, y: lastMiddle }]));

    const hidden = sizeOf(all.slice(SIZES.maxChildren));
    if (hidden > 0) {
      const text = `+${hidden} more`;
      more.push({ parentId: parent.id, count: hidden, text, x, y: nextRow, w: SIZES.badge.char * text.length, h: SIZES.moreHeight });
      nextRow += SIZES.moreHeight + SIZES.rowGap;
    }
  };
  placeChildrenOf(root);

  const right = [...boxes.map((box) => box.x + box.w), ...more.map((label) => label.x + label.w)];
  const low = [...boxes.map((box) => box.y + box.h), ...more.map((label) => label.y + label.h)];
  return { width: Math.max(...right), height: Math.max(...low), boxes, lines, more };
}
