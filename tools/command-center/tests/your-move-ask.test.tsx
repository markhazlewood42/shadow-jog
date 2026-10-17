// @vitest-environment happy-dom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DecisionDetail, type DecisionIssue, type DecisionPhase, type YourMoveInfo } from '../src/shared/types';
import { buildYourMoveItems } from '../src/shared/your-move';
import { withAsked } from '../src/web/decisions/DecisionPage';
import { YourMoveList, itemsForYou } from '../src/web/now/YourMovePanel';

// "Your move" and the decision page with the ask for more info (docs/command-center/needs-info-brief.md): the Now page splits the open decisions into "Waiting for you" and
// "Waiting for info", a decision with fresh info sorts first with the tag "More info posted", and the hosted page shows an Ask at once, before the snapshot catches up.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW_MS = Date.parse('2026-10-06T10:00:00Z');

function issue(number: number, phase?: DecisionPhase, extra: Partial<DecisionIssue> = {}): DecisionIssue {
  return {
    number,
    title: `Decision: Question ${number}?`,
    url: `https://github.com/fixture-owner/fixture-repo/issues/${number}`,
    state: 'open',
    question: `Question ${number}?`,
    context: null,
    options: [{ id: 'A', text: 'Yes' }],
    recommended: null,
    docs: [],
    raisedBy: null,
    waitsOn: null,
    createdAt: '2026-10-05T08:00:00Z',
    answer: null,
    problem: null,
    ...(phase === undefined ? {} : { phase }),
    ...extra,
  };
}

const build = (decisions: DecisionIssue[]) => buildYourMoveItems({ decisions, asks: [], nowMs: NOW_MS });
const numbers = (items: ReturnType<typeof build>) => items.map((item) => item.text.match(/#(\d+)/)?.[1]);

describe('buildYourMoveItems with the ask cycle', () => {
  it('puts a decision with fresh info first, with the tag "More info posted", then the others, then the ones that wait for info', () => {
    const items = build([issue(1, 'open'), issue(2, 'needs-info'), issue(3, 'info-posted'), issue(4), issue(5, 'needs-info-empty'), issue(6, 'ask-unfinished')]);
    expect(numbers(items)).toEqual(['3', '1', '4', '6', '2', '5']);
    expect(items.find((item) => item.text.includes('#3'))?.tag).toBe('More info posted');
    expect(items.filter((item) => item.waitingForInfo === true).map((item) => item.text.match(/#(\d+)/)?.[1])).toEqual(['2', '5']);
  });

  it('a decision with no phase (an older snapshot) is an ordinary item for Mark', () => {
    const items = build([issue(7)]);
    expect(items).toHaveLength(1);
    expect(items[0]?.waitingForInfo).toBeUndefined();
    expect(items[0]?.tag).toBeUndefined();
    expect('waitingForInfo' in (items[0] ?? {})).toBe(false);
  });

  it('a decision that waits for info still links to its page', () => {
    expect(build([issue(2, 'needs-info')])[0]?.href).toBe('/decisions/2');
  });

  it('a live ask sits between the items for Mark and the ones that wait for info', () => {
    const items = buildYourMoveItems({
      decisions: [issue(2, 'needs-info'), issue(1)],
      asks: [{ sessionId: 's1', title: 'Session', lines: ['Review the diff'], at: '2026-10-06T09:50:00Z', light: null }],
      nowMs: NOW_MS,
    });
    expect(items.map((item) => item.source)).toEqual(['decision-issue', 'session', 'decision-issue']);
    expect(items[2]?.waitingForInfo).toBe(true);
  });
});

describe('the Your move list: "Waiting for you" and "Waiting for info"', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const show = (info: YourMoveInfo) =>
    act(() => {
      root.render(
        <MemoryRouter>
          <YourMoveList info={info} now={NOW_MS} />
        </MemoryRouter>,
      );
    });
  const listItems = (name: string) => [...container.querySelectorAll(`ol[aria-label="${name}"] li`)].map((li) => li.textContent ?? '');

  it('shows two lists with two headings when decisions wait for info, and counts only the items for Mark', () => {
    const info: YourMoveInfo = { items: build([issue(1), issue(3, 'info-posted'), issue(2, 'needs-info')]), missing: [] };
    show(info);
    expect(container.textContent).toContain('Waiting for you');
    expect(container.textContent).toContain('Waiting for info');
    const forYou = listItems('What waits for Mark');
    expect(forYou).toHaveLength(2);
    expect(forYou[0]).toContain('Decision #3');
    expect(forYou[0]).toContain('More info posted');
    expect(forYou[1]).toContain('Decision #1');
    const forInfo = listItems('Waiting for info');
    expect(forInfo).toHaveLength(1);
    expect(forInfo[0]).toContain('Decision #2');
    expect(itemsForYou(info)).toHaveLength(2);
  });

  it('says "Nothing for you" when every decision waits for info, and still lists them', () => {
    show({ items: build([issue(2, 'needs-info')]), missing: [] });
    expect(container.textContent).toContain('Nothing for you');
    expect(listItems('Waiting for info')).toHaveLength(1);
    expect(container.querySelector('ol[aria-label="What waits for Mark"]')).toBeNull();
  });

  it('with no decision that waits for info it looks as before: one list, no headings', () => {
    show({ items: build([issue(1)]), missing: [] });
    expect(container.textContent).not.toContain('Waiting for you');
    expect(container.textContent).not.toContain('Waiting for info');
    expect(listItems('What waits for Mark')).toHaveLength(1);
  });
});

describe('withAsked: the hosted page shows an Ask before the snapshot has it', () => {
  const detail = (over: Partial<DecisionDetail> = {}): DecisionDetail => ({ ...issue(41, 'open'), thread: [], sections: [], ...over });
  const asked = { text: 'Why is C slow?', at: '2026-10-06T10:00:00Z' };

  it('shows "needs-info" with the question at the end of the thread', () => {
    const shown = withAsked(detail(), asked);
    expect(shown.phase).toBe('needs-info');
    expect(shown.thread?.at(-1)).toEqual({ kind: 'question', text: 'Why is C slow?', at: asked.at, cut: false });
  });

  it('hides a half answer that the question replaced, and changes nothing without a question', () => {
    const half = { option: 'A', note: null, at: '2026-10-06T09:00:00Z', complete: false };
    expect(withAsked(detail({ answer: half }), asked).answer).toBeNull();
    const plain = detail();
    expect(withAsked(plain, null)).toBe(plain);
  });

  it('is done when the snapshot has the question: the snapshot is the truth', () => {
    const confirmed = detail({ phase: 'needs-info', thread: [{ kind: 'question', text: 'Why is C slow?', at: asked.at, cut: false }] });
    expect(withAsked(confirmed, asked)).toBe(confirmed);
    // A later info in the snapshot is not hidden by the old reply.
    const answered = detail({
      phase: 'info-posted',
      thread: [
        { kind: 'question', text: 'Why is C slow?', at: asked.at, cut: false },
        { kind: 'info', text: 'Because.', at: '2026-10-06T11:00:00Z', cut: false },
      ],
    });
    expect(withAsked(answered, asked)).toBe(answered);
  });

  it('shows the optimistic state when the same text was asked before and a session answered it: only the newest pending question counts', () => {
    const old = detail({
      phase: 'info-posted',
      thread: [
        { kind: 'question', text: 'Why is C slow?', at: '2026-10-05T09:00:00Z', cut: false },
        { kind: 'info', text: 'Because.', at: '2026-10-05T11:00:00Z', cut: false },
      ],
    });
    const shown = withAsked(old, asked);
    expect(shown.phase).toBe('needs-info');
    expect(shown.thread?.at(-1)).toEqual({ kind: 'question', text: 'Why is C slow?', at: asked.at, cut: false });
    expect(shown.thread).toHaveLength(3);
    // A question after the answered one, with other text: the newest question is the one that counts.
    const other = detail({
      phase: 'needs-info',
      thread: [
        { kind: 'question', text: 'Why is C slow?', at: '2026-10-05T09:00:00Z', cut: false },
        { kind: 'question', text: 'Why is B slow?', at: '2026-10-05T10:00:00Z', cut: false },
      ],
    });
    expect(withAsked(other, asked).thread).toHaveLength(3);
  });

  it('turns ask-unfinished into needs-info after a Retry that the snapshot does not show yet', () => {
    const unfinished = detail({ phase: 'ask-unfinished', thread: [{ kind: 'question', text: 'Why is C slow?', at: asked.at, cut: false }] });
    expect(withAsked(unfinished, asked).phase).toBe('needs-info');
  });

  it('leaves a decision that is not open alone', () => {
    const closed = detail({ state: 'closed' });
    expect(withAsked(closed, asked)).toBe(closed);
  });
});
