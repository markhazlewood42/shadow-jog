import { describe, expect, it } from 'vitest';
import { decisionsWithoutIssue, issueCovers } from '../src/shared/decision-coverage';
import type { Decision, DecisionIssue } from '../src/shared/types';

// The check that an open decision of the engine docs has a decision issue (your-move-redesign.md section 5). "Your move" shows a decision only through its
// GitHub issue, so an open doc decision with no issue is invisible to Mark. These tests run the check over made-up decisions and issues.

function decision(id: string, extra: Partial<Decision> = {}): Decision {
  return {
    id,
    number: id,
    source: 'engine',
    question: `Question of ${id}?`,
    answer: 'A',
    milestone: null,
    who: 'Mark',
    option: null,
    status: 'open',
    change: null,
    docSlug: 'engine/decisions',
    anchor: `${id.toLowerCase()}-heading`,
    ...extra,
  };
}

function issue(number: number, extra: Partial<DecisionIssue> = {}): DecisionIssue {
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
    ...extra,
  };
}

describe('decisionsWithoutIssue', () => {
  it('fails on an open decision of Mark that has no decision issue: it is named', () => {
    expect(decisionsWithoutIssue([decision('E5')], []).map((entry) => entry.id)).toEqual(['E5']);
    // Another issue that has nothing to do with it does not cover it.
    expect(decisionsWithoutIssue([decision('E5')], [issue(80)]).map((entry) => entry.id)).toEqual(['E5']);
  });

  it('an issue that links to the heading of the decision covers it', () => {
    const covering = issue(81, { docs: [{ docId: 'engine/decisions', slug: 'engine/decisions', anchor: 'e5-heading', heading: 'E5' }] });
    expect(decisionsWithoutIssue([decision('E5')], [covering])).toEqual([]);
    // The same anchor in another doc is another heading.
    const otherDoc = issue(82, { docs: [{ docId: 'PHASE-0.2', slug: 'PHASE-0.2', anchor: 'e5-heading', heading: 'E5' }] });
    expect(decisionsWithoutIssue([decision('E5')], [otherDoc]).map((entry) => entry.id)).toEqual(['E5']);
  });

  it('an issue whose title or question names the id covers it, as a whole word only', () => {
    expect(decisionsWithoutIssue([decision('D5', { source: 'phase-0.2', anchor: null })], [issue(83, { title: 'Decision D5: What happens to PixelLab?' })])).toEqual([]);
    expect(decisionsWithoutIssue([decision('D5')], [issue(84, { question: 'Settle d5 before M2?' })])).toEqual([]);
    // D50 and AD5 are not D5.
    expect(decisionsWithoutIssue([decision('D5')], [issue(85, { title: 'Decision D50: other' }), issue(86, { title: 'Decision AD5: other' })]).map((entry) => entry.id)).toEqual(['D5']);
  });

  it('an issue in any state counts: an answered one whose doc is not updated yet is a doc to fix, not a missing issue', () => {
    expect(decisionsWithoutIssue([decision('E5')], [issue(87, { title: 'Decision E5: x', state: 'answered' })])).toEqual([]);
    expect(decisionsWithoutIssue([decision('E5')], [issue(88, { title: 'Decision E5: x', state: 'closed' })])).toEqual([]);
  });

  it('only an open decision that waits for Mark is checked: approved, changed and "Agent (FYI)" decisions are not', () => {
    const list = [decision('E1', { status: 'approved' }), decision('E2', { status: 'changed', change: 'edited' }), decision('E3', { who: 'Agent (FYI)' }), decision('E4', { who: 'mark' }), decision('E6')];
    expect(decisionsWithoutIssue(list, []).map((entry) => entry.id)).toEqual(['E4', 'E6']);
  });

  it('keeps the order of the docs', () => {
    expect(decisionsWithoutIssue([decision('E9'), decision('D5'), decision('C1')], []).map((entry) => entry.id)).toEqual(['E9', 'D5', 'C1']);
  });

  it('a decision with no heading (anchor null) can be covered only by its id', () => {
    const noHeading = decision('C3', { anchor: null, source: 'engine-update', docSlug: 'engine/README' });
    expect(issueCovers(issue(89, { docs: [{ docId: 'engine/README', slug: 'engine/README', anchor: '', heading: null }] }), noHeading)).toBe(false);
    expect(issueCovers(issue(90, { title: 'Decision C3: roundPixels' }), noHeading)).toBe(true);
  });
});
