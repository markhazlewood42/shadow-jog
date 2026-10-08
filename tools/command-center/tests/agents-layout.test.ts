import { describe, expect, it } from 'vitest';
import type { LiveNode, LiveSession } from '../src/shared/types';
import { type ClusterLayout, type LayoutBox, type LayoutLine, SIZES, childrenOf, layoutSession, pathOf } from '../src/web/agents/layout';
import { kids, liveNode, liveSession, liveWorkflow } from './agents-diagram-helpers';

// The layout of one cluster of the Agents diagram (design 5.4, revision 2): a plain function of a LiveSession that gives the place of every box, the paths of the
// lines and the size of the cluster. It has no DOM and no React, so these tests need neither. How the boxes look and move in a browser is the job of e2e/agents.spec.ts.

const boxOf = (layout: ClusterLayout, id: string): LayoutBox => {
  const found = layout.boxes.find((box) => box.id === id);
  if (found === undefined) throw new Error(`The layout has no box ${id}.`);
  return found;
};
const linesOf = (layout: ClusterLayout, kind: LayoutLine['kind']): LayoutLine[] => layout.lines.filter((line) => line.kind === kind);
const midY = (box: LayoutBox): number => box.y + box.h / 2;
const bottom = (box: LayoutBox): number => box.y + box.h;

/** The distance from the top of one row to the top of the next. */
const STEP = SIZES.node.h + SIZES.rowGap;

describe('the layout of a cluster', () => {
  it('layout places a session box with no children', () => {
    const layout = layoutSession(liveSession('s1'));
    // The box of the brief: 240 by 52 pixels, in the corner of the cluster.
    expect(SIZES.session).toEqual({ w: 240, h: 52 });
    expect(SIZES.node).toEqual({ w: 216, h: 44 });
    expect(layout.boxes).toEqual([{ id: 's1', kind: 'session', depth: 0, x: 0, y: 0, w: 240, h: 52 }]);
    // Nothing hangs under it: no line and no label, and the cluster is the size of the box.
    expect(layout.lines).toEqual([]);
    expect(layout.more).toEqual([]);
    expect(layout.width).toBe(240);
    expect(layout.height).toBe(52);
  });

  it('layout stacks children below the session on a trunk', () => {
    const layout = layoutSession(liveSession('s1', { nodes: [liveNode('a'), liveWorkflow('w'), liveNode('c')] }));
    const [a, w, c] = ['a', 'w', 'c'].map((id) => boxOf(layout, id)) as [LayoutBox, LayoutBox, LayoutBox];

    // One column, one level below the session. The kind of a box follows the node: a workflow is a box of the same size as an agent.
    expect([a, w, c].map((box) => [box.kind, box.depth, box.x, box.w, box.h])).toEqual([
      ['agent', 1, SIZES.indent, 216, 44],
      ['workflow', 1, SIZES.indent, 216, 44],
      ['agent', 1, SIZES.indent, 216, 44],
    ]);
    // The first row starts below the session box, with room for the trunk to show, and each next row is one step lower.
    expect(a.y).toBe(SIZES.session.h + SIZES.sessionGap);
    expect([a.y, w.y, c.y]).toEqual([a.y, a.y + STEP, a.y + 2 * STEP]);
    // Two boxes of a column never touch.
    expect(w.y - bottom(a)).toBe(SIZES.rowGap);

    // One trunk: from the bottom edge of the session box, down to the middle of the last child.
    const trunks = linesOf(layout, 'trunk');
    expect(trunks).toHaveLength(1);
    expect(trunks[0]?.ownerId).toBe('s1');
    expect(trunks[0]?.points).toEqual([
      { x: SIZES.trunkInset, y: SIZES.session.h },
      { x: SIZES.trunkInset, y: midY(c) },
    ]);
    expect(trunks[0]?.path).toBe(`M ${SIZES.trunkInset} ${SIZES.session.h} L ${SIZES.trunkInset} ${midY(c)}`);
    // The trunk is left of every child, so it never runs through a box.
    expect(SIZES.trunkInset).toBeLessThan(SIZES.indent);

    // The cluster is as wide as its widest box and as high as its lowest.
    expect(layout.width).toBe(SIZES.indent + SIZES.node.w);
    expect(layout.height).toBe(bottom(c));
  });

  it('layout indents a nested agent by one level', () => {
    // a starts b, and b starts c. d is another child of the session, after all of them.
    const nodes = [liveNode('a'), liveNode('b', { parentId: 'a' }), liveNode('c', { parentId: 'b' }), liveNode('d')];
    const layout = layoutSession(liveSession('s1', { nodes }));
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => boxOf(layout, id)) as [LayoutBox, LayoutBox, LayoutBox, LayoutBox];

    // Each level moves right by one step, and a nested agent follows its parent in the next row.
    expect([a, b, c, d].map((box) => box.depth)).toEqual([1, 2, 3, 1]);
    expect([a.x, b.x, c.x, d.x]).toEqual([SIZES.indent, 2 * SIZES.indent, 3 * SIZES.indent, SIZES.indent]);
    expect([a.y, b.y, c.y, d.y]).toEqual([a.y, a.y + STEP, a.y + 2 * STEP, a.y + 3 * STEP]);

    // A parent that is an agent has a trunk of its own: from the bottom of its box, at the inset from its left edge, to the middle of its last child.
    const trunk = (ownerId: string) => linesOf(layout, 'trunk').find((line) => line.ownerId === ownerId);
    expect(trunk('a')?.points).toEqual([
      { x: a.x + SIZES.trunkInset, y: bottom(a) },
      { x: a.x + SIZES.trunkInset, y: midY(b) },
    ]);
    expect(trunk('b')?.points).toEqual([
      { x: b.x + SIZES.trunkInset, y: bottom(b) },
      { x: b.x + SIZES.trunkInset, y: midY(c) },
    ]);
    // c has no child and d has none: no trunk. The trunk of the session runs on to d, past the rows of the nested agents, on their left.
    expect(trunk('c')).toBeUndefined();
    expect(trunk('d')).toBeUndefined();
    expect(trunk('s1')?.points[1]).toEqual({ x: SIZES.trunkInset, y: midY(d) });
    expect(linesOf(layout, 'trunk')).toHaveLength(3);

    // The line of a nested agent starts at the trunk of its parent, not at the trunk of the session.
    const spawn = (ownerId: string) => linesOf(layout, 'spawn').find((line) => line.ownerId === ownerId);
    expect(spawn('b')?.points[0]).toEqual({ x: a.x + SIZES.trunkInset, y: midY(b) });
    expect(spawn('c')?.points[0]).toEqual({ x: b.x + SIZES.trunkInset, y: midY(c) });
    expect(spawn('d')?.points[0]).toEqual({ x: SIZES.trunkInset, y: midY(d) });

    // The cluster grows to the right with the depth.
    expect(layout.width).toBe(c.x + SIZES.node.w);
    expect(layout.height).toBe(bottom(d));
  });

  it('layout shows 12 children and counts the rest', () => {
    // 12 children are all shown, and there is no label.
    const twelve = layoutSession(liveSession('s1', { nodes: kids(12) }));
    expect(twelve.boxes.map((box) => box.id)).toEqual(['s1', ...Array.from({ length: 12 }, (_, i) => `k${i + 1}`)]);
    expect(twelve.more).toEqual([]);

    // 13 children: the first 12 are shown, in the order of the data, and the label counts the one that is left out.
    const thirteen = layoutSession(liveSession('s1', { nodes: kids(13) }));
    expect(thirteen.boxes.map((box) => box.id)).toEqual(['s1', ...Array.from({ length: 12 }, (_, i) => `k${i + 1}`)]);
    expect(thirteen.boxes.find((box) => box.id === 'k13')).toBeUndefined();
    const last = boxOf(thirteen, 'k12');
    expect(thirteen.more).toEqual([{ parentId: 's1', count: 1, text: '+1 more', x: SIZES.indent, y: bottom(last) + SIZES.rowGap, w: expect.any(Number), h: SIZES.moreHeight }]);
    // The label sits in the column of the children, below the last of them, and the cluster is high enough to hold it.
    expect(thirteen.height).toBe(bottom(last) + SIZES.rowGap + SIZES.moreHeight);
    // The trunk goes to the last child that is shown, not to the label.
    expect(linesOf(thirteen, 'trunk')[0]?.points[1]).toEqual({ x: SIZES.trunkInset, y: midY(last) });
    // No line is drawn for a child that is left out.
    expect(thirteen.lines.some((line) => line.ownerId === 'k13')).toBe(false);

    // The count is how many are left: 20 children give "+8 more".
    expect(layoutSession(liveSession('s1', { nodes: kids(20) })).more.map((label) => [label.count, label.text])).toEqual([[8, '+8 more']]);

    // A child that is left out takes its own children with it, and they are counted: k13 and the agent that k13 started are 2 boxes.
    const withKids = layoutSession(liveSession('s1', { nodes: [...kids(13), liveNode('g1', { parentId: 'k13' })] }));
    expect(withKids.boxes.some((box) => box.id === 'g1')).toBe(false);
    expect(withKids.more.map((label) => label.text)).toEqual(['+2 more']);

    // The limit holds for every parent, not only the session: an agent with 14 children shows 12 of them, and the label is in its column.
    const nested = layoutSession(liveSession('s1', { nodes: [liveNode('p'), ...kids(14, 'p', 'n'), liveNode('after')] }));
    const parent = boxOf(nested, 'p');
    expect(nested.boxes.filter((box) => box.depth === 2)).toHaveLength(12);
    expect(nested.more).toHaveLength(1);
    expect(nested.more[0]).toMatchObject({ parentId: 'p', count: 2, text: '+2 more', x: 2 * SIZES.indent });
    // The row after the label starts below it, so the label overlaps no box.
    const label = nested.more[0] as ClusterLayout['more'][number];
    expect(boxOf(nested, 'after').y).toBe(label.y + label.h + SIZES.rowGap);
    expect(label.y).toBe(bottom(boxOf(nested, 'n12')) + SIZES.rowGap);
    expect(parent.depth).toBe(1);
  });

  it('layout keeps the order of the data', () => {
    // The ids and the labels are not in the order of the alphabet, the states are mixed, and the starts are not in order. The rows follow the data, whatever the fields say.
    const nodes = [
      liveNode('zeta', { label: 'Zulu', state: 'done', model: null, startedAt: null }),
      liveNode('alpha', { label: 'Alpha', startedAt: '2026-01-01T00:00:00.000Z' }),
      liveWorkflow('mid', { label: 'Mike' }),
    ];
    const layout = layoutSession(liveSession('s1', { nodes }));
    expect(layout.boxes.map((box) => box.id)).toEqual(['s1', 'zeta', 'alpha', 'mid']);
    expect(layout.boxes.map((box) => box.y)).toEqual([...layout.boxes.map((box) => box.y)].sort((a, b) => a - b));

    // The reverse data gives the reverse rows: the layout never sorts.
    const reversed = layoutSession(liveSession('s1', { nodes: [...nodes].reverse() }));
    expect(reversed.boxes.map((box) => box.id)).toEqual(['s1', 'mid', 'alpha', 'zeta']);

    // A nested agent that the data lists before its parent still stands under its parent. The siblings keep their order.
    const early = layoutSession(liveSession('s1', { nodes: [liveNode('child', { parentId: 'p' }), liveNode('p'), liveNode('other')] }));
    expect(early.boxes.map((box) => [box.id, box.depth])).toEqual([
      ['s1', 0],
      ['p', 1],
      ['child', 2],
      ['other', 1],
    ]);

    // The same data twice gives the same layout, to the pixel: a box does not move when nothing changed. (A copy of the data is another object with the same words.)
    const session = liveSession('s1', { nodes: [...kids(5), liveNode('n', { parentId: 'k2' })] });
    expect(layoutSession(structuredClone(session))).toEqual(layoutSession(session));
    // A node that changes state does not change its place or the place of any other.
    const finished = { ...session, nodes: session.nodes.map((node) => (node.id === 'k3' ? { ...node, state: 'done' as const, endedAt: node.startedAt } : node)) };
    expect(layoutSession(finished).boxes).toEqual(layoutSession(session).boxes);
  });

  it('layout draws a spawn line for each child and a message line only with a count', () => {
    // Four children (b has messages), a nested agent with messages, and a workflow.
    const messages = (count: number, approximate = false) => ({ messages: { count, approximate } });
    const nodes = [liveNode('a', messages(0)), liveNode('b', messages(2)), liveNode('c', { parentId: 'b', ...messages(5) }), liveNode('d', messages(0)), liveWorkflow('w')];
    const layout = layoutSession(liveSession('s1', { nodes }));

    // A spawn line for every box that is drawn, and nothing else: solid, from the trunk of the parent to the left edge of the box, at the middle of the box.
    const spawns = linesOf(layout, 'spawn');
    expect(spawns.map((line) => line.ownerId)).toEqual(['a', 'b', 'c', 'd', 'w']);
    for (const line of spawns) {
      const box = boxOf(layout, line.ownerId);
      const parent = box.depth === 1 ? { x: 0 } : boxOf(layout, 'b');
      expect(line.points).toEqual([
        { x: parent.x + SIZES.trunkInset, y: midY(box) },
        { x: box.x - SIZES.arrowGap, y: midY(box) },
      ]);
      expect(line.path).toBe(`M ${parent.x + SIZES.trunkInset} ${midY(box)} L ${box.x - SIZES.arrowGap} ${midY(box)}`);
      expect(line.count).toBeUndefined();
    }

    // A message line only for the boxes with a count above 0: b and c. a, d and the workflow have none.
    const messageLines = linesOf(layout, 'messages');
    expect(messageLines.map((line) => line.ownerId)).toEqual(['b', 'c']);
    expect(messageLines.map((line) => line.count?.text)).toEqual(['2', '5']);
    for (const line of messageLines) {
      const box = boxOf(layout, line.ownerId);
      const spawn = spawns.find((candidate) => candidate.ownerId === line.ownerId) as LayoutLine;
      const [from, to] = line.points as [LayoutLine['points'][number], LayoutLine['points'][number]];
      // A short segment between the trunk and the box, level, and not on the spawn line.
      expect(from.y).toBe(to.y);
      expect(from.y).not.toBe(spawn.points[0]?.y);
      expect(from.x).toBeGreaterThan(spawn.points[0]?.x as number);
      expect(to.x).toBeLessThan(box.x);
      // Its count is a label on the segment, inside the arm between the trunk and the box, and level with the segment.
      const count = line.count as NonNullable<LayoutLine['count']>;
      expect(count.x).toBeGreaterThanOrEqual(from.x);
      expect(count.x + count.w).toBeLessThanOrEqual(to.x);
      expect(count.y + count.h / 2).toBe(from.y);
    }

    // The counts move nothing: the boxes are where they would be with no message at all.
    const quiet = layoutSession(liveSession('s1', { nodes: nodes.map((node) => ({ ...node, messages: { count: 0, approximate: false } })) }));
    expect(layout.boxes).toEqual(quiet.boxes);
    expect(linesOf(quiet, 'messages')).toEqual([]);
    expect(linesOf(quiet, 'spawn').map((line) => line.points)).toEqual(spawns.map((line) => line.points));
  });

  it('layout marks an approximate count with a plus', () => {
    const textOf = (messages: LiveNode['messages']) => linesOf(layoutSession(liveSession('s1', { nodes: [liveNode('a', { messages })] })), 'messages')[0]?.count?.text;
    expect(textOf({ count: 3, approximate: false })).toBe('3');
    expect(textOf({ count: 3, approximate: true })).toBe('3+');
    expect(textOf({ count: 12, approximate: true })).toBe('12+');
    // "At least 0" is still 0: no message line, with a plus or without.
    expect(textOf({ count: 0, approximate: true })).toBeUndefined();
    expect(linesOf(layoutSession(liveSession('s1', { nodes: [liveNode('a', { messages: { count: 0, approximate: true } })] })), 'messages')).toEqual([]);

    // The label is wide enough for its text: a longer text gets a wider label, and the segment still has room around it.
    const widthOf = (count: number, approximate: boolean) => linesOf(layoutSession(liveSession('s1', { nodes: [liveNode('a', { messages: { count, approximate } })] })), 'messages')[0]?.count?.w as number;
    expect(widthOf(3, true)).toBeGreaterThan(widthOf(3, false));
    expect(widthOf(12, true)).toBeGreaterThan(widthOf(3, true));
  });

  it('F5: a message count of 100 or more shows as 99+', () => {
    const textOf = (count: number, approximate: boolean) => linesOf(layoutSession(liveSession('s1', { nodes: [liveNode('a', { messages: { count, approximate } })] })), 'messages')[0]?.count?.text;
    expect(textOf(99, false)).toBe('99');
    expect(textOf(100, false)).toBe('99+');
    expect(textOf(12345, false)).toBe('99+');
    expect(textOf(99, true)).toBe('99+');
    expect(textOf(150, true)).toBe('99+');
    expect(textOf(7, true)).toBe('7+');
  });

  it('F5: a message badge is never wider than the gap between the trunk and the box', () => {
    // The gap is the arm less the two ends of the message line.
    const gap = SIZES.arm - SIZES.messageStart - SIZES.messageEnd;
    for (const count of [1, 99, 100, 1000, 12345]) {
      for (const approximate of [false, true]) {
        const w = linesOf(layoutSession(liveSession('s1', { nodes: [liveNode('a', { messages: { count, approximate } })] })), 'messages')[0]?.count?.w as number;
        expect(w, `${count} ${approximate}`).toBeLessThanOrEqual(gap);
      }
    }
  });

  it('layout keeps every line and every label out of every box', () => {
    // A flat cluster, a deep one, a capped one, and one with messages everywhere (also the long counts): in each, no segment of a line enters the inside of a box.
    const messages = { count: 123, approximate: true };
    const sessions: LiveSession[] = [
      liveSession('flat', { nodes: kids(4) }),
      liveSession('deep', { nodes: [liveNode('a'), liveNode('b', { parentId: 'a' }), liveNode('c', { parentId: 'b' }), liveNode('d', { parentId: 'a' }), liveNode('e')] }),
      liveSession('capped', { nodes: [liveNode('p'), ...kids(13, 'p', 'n'), ...kids(13)] }),
      liveSession('talk', { nodes: [liveNode('a', { messages }), liveNode('b', { parentId: 'a', messages }), liveWorkflow('w'), liveNode('c', { messages: { count: 1, approximate: false } })] }),
    ];
    for (const session of sessions) {
      const layout = layoutSession(session);
      for (const line of layout.lines) {
        for (let i = 1; i < line.points.length; i += 1) {
          const [p, q] = [line.points[i - 1], line.points[i]] as [LayoutLine['points'][number], LayoutLine['points'][number]];
          // The lines are level or plumb.
          expect(p.x === q.x || p.y === q.y, `${session.id}/${line.id} is level or plumb`).toBe(true);
          const [x1, x2] = [Math.min(p.x, q.x), Math.max(p.x, q.x)];
          const [y1, y2] = [Math.min(p.y, q.y), Math.max(p.y, q.y)];
          for (const box of layout.boxes) {
            // A plumb segment crosses a box when it is strictly inside the box's columns and overlaps its rows; a level one, the other way round.
            // A segment that only touches an edge of a box (the arrow at the box, the trunk at the bottom of its parent) does not cross it.
            const crosses = x1 === x2 ? box.x < x1 && x1 < box.x + box.w && y1 < box.y + box.h && y2 > box.y : box.y < y1 && y1 < box.y + box.h && x1 < box.x + box.w && x2 > box.x;
            expect(crosses, `${session.id}/${line.id} crosses ${box.id}`).toBe(false);
          }
        }
        if (line.count !== undefined) {
          const count = line.count;
          for (const box of layout.boxes) {
            const apart = count.x + count.w <= box.x || count.x >= box.x + box.w || count.y + count.h <= box.y || count.y >= box.y + box.h;
            expect(apart, `${session.id}/${line.id}: the count overlaps ${box.id}`).toBe(true);
          }
        }
      }
      // Two boxes never overlap, and a label "+N more" overlaps no box.
      for (const [i, one] of layout.boxes.entries()) {
        for (const other of layout.boxes.slice(i + 1)) {
          const apart = one.x + one.w <= other.x || other.x + other.w <= one.x || one.y + one.h <= other.y || other.y + other.h <= one.y;
          expect(apart, `${session.id}: ${one.id} and ${other.id} overlap`).toBe(true);
        }
        for (const label of layout.more) {
          const apart = one.x + one.w <= label.x || label.x + label.w <= one.x || one.y + one.h <= label.y || label.y + label.h <= one.y;
          expect(apart, `${session.id}: ${one.id} and the label of ${label.parentId} overlap`).toBe(true);
        }
      }
    }
  });

  it('layout puts every node in the cluster once, even when its parent is unknown or the parents form a loop', () => {
    // x starts from a parent that is not in the list, y and z each name the other as the parent, w names itself, and the last one has the id of the session.
    const nodes = [liveNode('ok'), liveNode('x', { parentId: 'nobody' }), liveNode('y', { parentId: 'z' }), liveNode('z', { parentId: 'y' }), liveNode('w', { parentId: 'w' }), liveNode('ok', { label: 'The same id again' }), liveNode('s1')];
    const layout = layoutSession(liveSession('s1', { nodes }));
    // Each is a child of the session, in the order of the data. The repeated id and the id of the session are not boxes of their own.
    expect(layout.boxes.map((box) => [box.id, box.depth])).toEqual([
      ['s1', 0],
      ['ok', 1],
      ['x', 1],
      ['y', 1],
      ['z', 1],
      ['w', 1],
    ]);
    expect(childrenOf(liveSession('s1', { nodes })).get('s1')?.map((node) => node.id)).toEqual(['ok', 'x', 'y', 'z', 'w']);
  });
});

describe('pathOf', () => {
  it('joins the points into one path: a move to the first, and a line to each of the others', () => {
    expect(pathOf([{ x: 12, y: 52 }, { x: 12, y: 92 }])).toBe('M 12 52 L 12 92');
    expect(
      pathOf([
        { x: 1, y: 2 },
        { x: 3, y: 4 },
        { x: 5.5, y: 6 },
      ]),
    ).toBe('M 1 2 L 3 4 L 5.5 6');
    expect(pathOf([])).toBe('');
  });
});
