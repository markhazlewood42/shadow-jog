import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderDoc } from '../src/server/docs/render';
import { resolveHref } from '../src/server/docs/links';
import { DECISION_FIELDS, answerComment, flattenEventPages, parseDecisionIssue, readDecisionIssue } from '../src/server/decisions/parse';
import { MARK_LOGIN, isMarkLogin } from '../src/server/github/github';
import type { DecisionIssue } from '../src/shared/types';
import { PACKAGE_DIR, REPO_DIR } from './helpers';

// The parser of the decisions module: it reads what `gh issue view` (or `gh issue list`) and the events of
// the issue printed, and makes a DecisionIssue. The repo is public, so the parser trusts only what Mark's
// account wrote (the "Trust" rule), and shows every word of the issue as plain text. The fixtures are made up
// (fixtures/gh): the issues of a "Burrow" product, and one forged issue that has an answer from a look-alike login.

type Json = Record<string, unknown>;
/** One issue of a fixture: what gh prints for the issue, and (as `events`) what `gh api .../events` printed for it. */
type Fixture = Json & { number: number; events: Json[] };

const readJson = (file: string) => JSON.parse(readFileSync(join(PACKAGE_DIR, 'fixtures', 'gh', file), 'utf8')) as unknown;
const SEED = (readJson('issues.json') as { issues: Fixture[] }).issues;
const FORGED = readJson('issue-forged.json') as Fixture;
const UNREADABLE = readJson('issue-unreadable.json') as Fixture;

/** The issue of the seed with this number, split into what gh printed for the issue and what it printed for the events. */
function fixture(number: number): { issue: Json; events: Json[] } {
  const found = SEED.find((entry) => entry.number === number);
  if (found === undefined) throw new Error(`the seed has no issue ${number}`);
  const { events, ...issue } = found;
  return { issue, events };
}
const splitFixture = ({ events, ...issue }: Fixture) => ({ issue, events });

/** The parsed issue, which must not be null. */
function parsed(issue: Json, events: unknown = []): DecisionIssue {
  const result = parseDecisionIssue(issue, events);
  if (result === null) throw new Error('expected the issue to parse as a decision, and it gave null');
  return result;
}

// ---- small issues for the tests that need one thing different ----

const BODY = `## Question

Which way?

## Options

- A: The left way.
- B: The right way.
`;

/** A raw issue as gh prints it, with only the fields that the parser reads. Mark's own, open, with the label decision. */
function raw(over: Json = {}): Json {
  return {
    number: 7,
    title: 'Decision: Which way?',
    url: 'https://github.com/o/r/issues/7',
    state: 'OPEN',
    labels: [{ name: 'decision' }],
    author: { login: MARK_LOGIN },
    body: BODY,
    comments: [],
    createdAt: '2026-10-05T10:00:00Z',
    ...over,
  };
}
const comment = (login: string, body: string, createdAt = '2026-10-05T12:00:00Z'): Json => ({ author: { login }, body, createdAt });
const labeled = (login: string, at = '2026-10-05T12:00:01Z', label = 'decided'): Json => ({ event: 'labeled', label: { name: label }, actor: { login }, created_at: at });
const withBody = (body: string) => parsed(raw({ body }));

/** The docs lines of a body (the Docs section) as the parser reads them. */
const docsOf = (...lines: string[]) => withBody(`${BODY}\n## Docs\n\n${lines.join('\n')}\n`).docs;

describe('parseDecisionIssue: the template', () => {
  it('parse: a template body gives the question, context, options, recommended option, doc links as path#heading, raised-by and waits-on', () => {
    const { issue, events } = fixture(41);
    const decision = parsed(issue, events);

    expect(decision).toEqual({
      number: 41,
      title: 'Decision: Where should Burrow keep its cache?',
      url: 'https://github.com/fixture-owner/fixture-repo/issues/41',
      state: 'open',
      question: 'Where should Burrow keep its cache folder?',
      context: 'The cache is the only part of the storage that grows without a limit. Today it sits in the data folder, so a backup of the data folder saves the cache too.',
      options: [
        { id: 'A', text: 'Keep it in the data folder. Nothing changes for users, and backups stay large.' },
        { id: 'B', text: 'Move it to the temp folder of the operating system. Backups shrink, and the cache is lost at a restart.' },
        { id: 'C', text: 'Move it to a new `cache` folder next to the data folder. Backups can skip it, and the installer must move old caches once.' },
      ],
      recommended: 'C',
      // Each link is `path#heading`: the path is the id of the doc, and the heading gives the anchor. The headings of the docs are not read here (the module does that).
      docs: [
        { docId: 'docs/guides/setup.md', slug: 'guides/setup', anchor: 'storage', heading: null },
        { docId: 'docs/guides/setup.md', slug: 'guides/setup', anchor: 'first-run', heading: null },
        { docId: 'docs/guides/setup.md', slug: 'guides/setup', anchor: 'no-such-heading', heading: null },
      ],
      raisedBy: 'Session fixture-session-1, branch `feature/cache-folder`.',
      waitsOn: 'The cache change in PR 12.',
      createdAt: '2026-10-05T10:00:00Z',
      answer: null,
      problem: null,
    });
  });

  it('asks gh for the fields that the parser reads', () => {
    expect(DECISION_FIELDS.split(',')).toEqual(['number', 'title', 'url', 'state', 'labels', 'author', 'body', 'comments', 'createdAt']);
  });

  it('reads the same issue from a body with Windows line ends', () => {
    const { issue, events } = fixture(41);
    const windows = parsed({ ...issue, body: String(issue.body).replace(/\n/g, '\r\n') }, events);
    expect(windows).toEqual(parsed(issue, events));
  });

  it('reads the options in the ways an agent writes a list: bold ids, other separators, lines that go on, and an option with no text is no option', () => {
    const decision = withBody(`## Question

Which?

## Options

- **A:** Bold id and bold colon.
- **B**: Bold id only.
* C) A star and a bracket.
+ D. A plus and a dot.
- E: A line
  that goes on, and
  on.
- F:
- G: Has a colon: in the text.

## Recommendation

**B** because it is bold.
`);
    expect(decision.options).toEqual([
      { id: 'A', text: 'Bold id and bold colon.' },
      { id: 'B', text: 'Bold id only.' },
      { id: 'C', text: 'A star and a bracket.' },
      { id: 'D', text: 'A plus and a dot.' },
      { id: 'E', text: 'A line that goes on, and on.' },
      { id: 'G', text: 'Has a colon: in the text.' },
    ]);
    expect(decision.recommended).toBe('B');
    expect(decision.problem).toBeNull();
  });

  it('names the recommended option only when the recommendation starts with the id of an option', () => {
    const recommended = (text: string) => withBody(`${BODY}\n## Recommendation\n\n${text}\n`).recommended;
    expect(recommended('A: it is small.')).toBe('A');
    expect(recommended('b: lower case in the text, and the id of the option is B')).toBe('B');
    expect(recommended('Option B. It is small.')).toBe('B');
    expect(recommended('A')).toBe('A');
    // A word that happens to be an id is not a recommendation, and neither is an id that no option has.
    expect(recommended('A reasonable choice is B.')).toBeNull();
    expect(recommended('C: there is no option C')).toBeNull();
    expect(recommended('')).toBeNull();
    expect(parsed(raw()).recommended).toBeNull(); // no Recommendation section at all
  });

  it('lists an option once: a second option with the same id is a problem, and the first one stays', () => {
    const decision = withBody(`${BODY}\n- A: The same id again.\n`);
    expect(decision.options).toEqual([
      { id: 'A', text: 'The left way.' },
      { id: 'B', text: 'The right way.' },
    ]);
    expect(decision.problem).toMatch(/A.*twice/);
  });

  it('gives null for a section that is empty or still has the words of the template', () => {
    const decision = withBody(`## Question

Which?

## Context

Two or three lines: what is true now, and why it needs an answer.

## Options

- A: One.

## Raised by

The session, the branch or the PR.

## Waits on this


`);
    expect(decision).toMatchObject({ context: null, raisedBy: null, waitsOn: null, problem: null });
  });

  it('does not take a heading inside a fenced code block for a section', () => {
    const decision = withBody(`## Question

Which?

\`\`\`
## Options
- A: Inside a fence.
\`\`\`

## Options

- A: Outside.
`);
    expect(decision.options).toEqual([{ id: 'A', text: 'Outside.' }]);
    expect(decision.question).toContain('## Options'); // the fence is part of the question, as text
  });
});

describe('parseDecisionIssue: the links to docs', () => {
  it('turns the heading of a link into the id that the docs give it: punctuation goes, as the docs renderer does it', () => {
    // Three ways to write the same heading, in three docs (the same doc and heading twice is one link). The heading of the doc is "5.5 Decision inbox (the one two-way feature)".
    expect(
      docsOf(
        '- docs/one.md#5.5-decision-inbox-the-one-two-way-feature',
        '- docs/two.md#5.5 Decision inbox (the one two-way feature)',
        '- docs/three.md#55-decision-inbox-the-one-two-way-feature',
        '- docs/four.md#Caf%C3%A9 Menu',
      ).map((link) => link.anchor),
    ).toEqual([
      '55-decision-inbox-the-one-two-way-feature',
      '55-decision-inbox-the-one-two-way-feature',
      '55-decision-inbox-the-one-two-way-feature',
      'café-menu',
    ]);
    // The same section, written in two ways, is one link.
    expect(docsOf('- docs/a.md#5.5 Decisions', '- docs/a.md#55-decisions')).toHaveLength(1);
  });

  it('gives the same anchor as the id that the docs renderer writes for the heading', () => {
    // The real renderer, on a small doc with the headings that make trouble: a number with a dot, brackets, a heading that repeats, and a letter with an accent.
    const doc = renderDoc('# Doc\n\n## 5.5 Decisions\n\n## Setup (the first run)\n\n## Setup (the first run)\n\n## Café menu\n', {
      docId: 'docs/a.md',
      resolve: (href) => resolveHref(href, 'docs/a.md', { docs: new Map(), assets: new Map(), exists: () => false }, 'https://github.com/o/r/blob/main'),
    });
    const ids = doc.headings.map((heading) => heading.id);
    expect(ids).toEqual(['55-decisions', 'setup-the-first-run', 'setup-the-first-run-1', 'café-menu']);

    // The words of an agent, written the way the template asks ("lower case, with a hyphen between words") and the way it is natural to write them.
    const anchors = docsOf('- docs/a.md#5.5-decisions', '- docs/a.md#Setup (the first run)', '- docs/a.md#setup-the-first-run-1', '- docs/a.md#café-menu').map((link) => link.anchor);
    expect(anchors).toEqual(ids);
  });

  it('reads a link in the ways an agent writes it, and leaves out what is not a link to a doc', () => {
    const links = docsOf(
      '- docs/guides/setup.md#installing',
      '* `docs/engine/decisions.md#e5-no-webgl-policy`',
      '- [The setup guide](docs/guides/setup.md#storage)',
      '- ./status.md#right-now',
      '- docs\\engine\\README.md#reading-order',
      '- docs/guides/setup.md',
      '- path#heading', // the words of the template
      '- https://example.com/page#section',
      '- ../outside.md#x',
      '- docs/guides/setup.md#installing', // the same link twice
      '-',
    );
    expect(links.map((link) => [link.docId, link.slug, link.anchor])).toEqual([
      ['docs/guides/setup.md', 'guides/setup', 'installing'],
      ['docs/engine/decisions.md', 'engine/decisions', 'e5-no-webgl-policy'],
      ['docs/guides/setup.md', 'guides/setup', 'storage'],
      ['status.md', 'status', 'right-now'],
      ['docs/engine/README.md', 'engine/README', 'reading-order'],
      ['docs/guides/setup.md', 'guides/setup', ''], // a link with no heading: the whole doc
    ]);
  });
});

/**
 * A real look-alike of Mark's login: the KELVIN SIGN (U+212A) in the place of the k. JavaScript's toLowerCase() turns the sign into a plain k, so a check that
 * only compares lower-case letters takes it for Mark. (A string with the sign at the start, in the place of the m, does not test this: it lowercases to a word
 * that is no login of his, with the check or without it.) The first expectation that uses this string proves that it is the real thing.
 */
const KELVIN_LOOKALIKE = 'mar\u212Ahazlewood42';

describe('parseDecisionIssue: who may write', () => {
  it('an issue by another author is ignored', () => {
    // The label alone proves nothing: GitHub puts the label of the template on a stranger's issue as well.
    const { issue, events } = fixture(42);
    expect((issue.labels as { name: string }[]).map((label) => label.name)).toEqual(['decision']);
    expect(parseDecisionIssue(issue, events)).toBeNull();

    expect(KELVIN_LOOKALIKE.toLowerCase()).toBe(MARK_LOGIN); // it lowercases to the real login: only the ASCII check of isMarkLogin refuses it
    for (const author of [{ login: 'markhazlewood-42' }, { login: 'markhazlewood42x' }, { login: 'xmarkhazlewood42' }, { login: '' }, { login: 'Mark Hazlewood' }, { login: 'markhazlewood42 ' }, { login: KELVIN_LOOKALIKE }, {}, null, 'markhazlewood42', undefined]) {
      expect(parseDecisionIssue(raw({ author }), []), JSON.stringify(author)).toBeNull();
    }
    // GitHub logins are not case sensitive: the same account in other letters is Mark.
    expect(parseDecisionIssue(raw({ author: { login: MARK_LOGIN.toUpperCase() } }), [])).not.toBeNull();
  });

  it('keeps the login of Mark in one place: isMarkLogin of the GitHub module', () => {
    expect(KELVIN_LOOKALIKE.toLowerCase()).toBe(MARK_LOGIN);
    expect(isMarkLogin(MARK_LOGIN)).toBe(true);
    expect(isMarkLogin('MarkHazlewood42')).toBe(true);
    for (const login of ['markhazlewood-42', 'markhazlewood', '', ' markhazlewood42', 'markhazlewood42\n', KELVIN_LOOKALIKE, null, undefined, 42, {}]) {
      expect(isMarkLogin(login), JSON.stringify(login)).toBe(false);
    }
  });

  it('is null for an issue that has neither the label decision nor the label decided, and takes either', () => {
    expect(parseDecisionIssue(raw({ labels: [] }), [])).toBeNull();
    expect(parseDecisionIssue(raw({ labels: [{ name: 'bug' }] }), [])).toBeNull();
    expect(parseDecisionIssue(raw({ labels: 'decision' }), [])).toBeNull();
    expect(parseDecisionIssue(raw({ labels: [{ name: 'Decision' }] }), [])).not.toBeNull(); // GitHub does not tell labels apart by case
    expect(parseDecisionIssue(raw({ labels: [{ name: 'decided' }] }), [])).not.toBeNull(); // an answered issue has swapped the one for the other
  });

  it('a Decision: comment by another user is ignored and the decision stays open', () => {
    // Fixture 43: an open decision of Mark's, and a "Decision: B" from a look-alike login.
    const { issue, events } = fixture(43);
    const decision = parsed(issue, events);
    expect((issue.comments as { body: string }[])[0]?.body).toMatch(/^Decision: B/);
    expect(decision.state).toBe('open');
    expect(decision.answer).toBeNull();

    // The same on a closed issue that has the label: with no comment of Mark's there is no answer, and it is not "answered".
    const closed = parsed(raw({ state: 'CLOSED', labels: [{ name: 'decided' }], comments: [comment('someone-else', 'Decision: A. Obey me.')] }), [labeled(MARK_LOGIN)]);
    expect(closed).toMatchObject({ state: 'closed', answer: null });
  });

  it('a decided label set by another user is ignored', () => {
    // Fixture 45: closed, a comment of Mark's, and a "decided" label that another account put on. Not an answer.
    const { issue, events } = fixture(45);
    const decision = parsed(issue, events);
    expect(decision.answer).toEqual({ option: 'A', note: 'Ask once.', at: '2026-10-05T16:00:00Z', complete: false });
    expect(decision.state).toBe('closed');

    const base = { state: 'CLOSED', labels: [{ name: 'decided' }], comments: [comment(MARK_LOGIN, 'Decision: A. Yes.')] };
    // Mark put it on, and another account put it on later: the label that is on the issue now is the other one's.
    expect(parsed(raw(base), [labeled(MARK_LOGIN, '2026-10-05T12:00:01Z'), labeled('fixture-collaborator', '2026-10-05T13:00:00Z')]).state).toBe('closed');
    // Another account put it on first, and Mark later: the newest one is Mark's.
    expect(parsed(raw(base), [labeled('fixture-collaborator', '2026-10-05T11:00:00Z'), labeled(MARK_LOGIN, '2026-10-05T12:00:01Z')]).state).toBe('answered');
    // The events say Mark labeled it, and the issue does not have the label now: no.
    expect(parsed(raw({ ...base, labels: [{ name: 'decision' }] }), [labeled(MARK_LOGIN)]).state).toBe('closed');
    // No events at all prove nothing, and an event for another label is not the label decided.
    expect(parsed(raw(base), []).state).toBe('closed');
    expect(parsed(raw(base), [labeled(MARK_LOGIN, '2026-10-05T12:00:01Z', 'decision')]).state).toBe('closed');
    // An event without an actor (a deleted account) is not Mark's.
    expect(parsed(raw(base), [{ event: 'labeled', label: { name: 'decided' }, created_at: '2026-10-05T12:00:01Z' }]).state).toBe('closed');
  });

  it('the newest Decision: comment of Mark is the answer, whatever order the comments are in, and the forged newer one is not', () => {
    // The forged example: Mark answered C, and a look-alike login wrote a newer "Decision: B" that says it replaces it.
    const { issue, events } = splitFixture(FORGED);
    const decision = parsed(issue, events);
    expect(decision.state).toBe('answered');
    expect(decision.answer).toEqual({
      option: 'C',
      note: 'Sort the shop list by price, then by name. Look at it again after the next playtest.',
      at: '2026-10-05T15:12:09Z',
      complete: true,
    });

    // Two answers of Mark's: the newer one wins, also when it comes first in the list. With the same time, the later one in the list wins.
    const two = (first: Json, second: Json) => parsed(raw({ state: 'CLOSED', labels: [{ name: 'decided' }], comments: [first, second] }), [labeled(MARK_LOGIN)]).answer?.option;
    const older = comment(MARK_LOGIN, 'Decision: A.', '2026-10-05T10:00:00Z');
    const newer = comment(MARK_LOGIN, 'Decision: B.', '2026-10-05T11:00:00Z');
    expect(two(older, newer)).toBe('B');
    expect(two(newer, older)).toBe('B');
    expect(two(comment(MARK_LOGIN, 'Decision: A.'), comment(MARK_LOGIN, 'Decision: B.'))).toBe('B');
  });
});

describe('parseDecisionIssue: the answer and the state', () => {
  const READY = { state: 'CLOSED', labels: [{ name: 'decided' }], comments: [comment(MARK_LOGIN, 'Decision: B. Because.')] };

  it('answered: a closed issue, a Decision: comment of Mark, and a decided label that Mark put on', () => {
    const { issue, events } = fixture(44);
    expect(parsed(issue, events)).toMatchObject({
      state: 'answered',
      answer: { option: 'B', note: 'Green looks better on the dark page. Check it again after the next release.', at: '2026-10-05T15:12:09Z', complete: true },
    });
  });

  it('an answer that stopped half way is open, with the answer and complete false: the retry finishes it', () => {
    // Only the comment is there.
    expect(parsed(raw({ comments: [comment(MARK_LOGIN, 'Decision: B. Because.')] }), [])).toMatchObject({ state: 'open', answer: { option: 'B', note: 'Because.', complete: false } });
    // The comment and the label, and the issue is still open.
    expect(parsed(raw({ labels: [{ name: 'decided' }], comments: [comment(MARK_LOGIN, 'Decision: B.')] }), [labeled(MARK_LOGIN)])).toMatchObject({ state: 'open', answer: { option: 'B', complete: false } });
    // Closed and labeled, but nothing says what he chose.
    expect(parsed(raw({ ...READY, comments: [] }), [labeled(MARK_LOGIN)])).toMatchObject({ state: 'closed', answer: null });
    // Closed, with the comment, and the label is missing.
    expect(parsed(raw({ ...READY, labels: [{ name: 'decision' }] }), [])).toMatchObject({ state: 'closed', answer: { complete: false } });
    // Complete: closed, comment, label from Mark. Both labels on the issue do not change that.
    expect(parsed(raw(READY), [labeled(MARK_LOGIN)]).state).toBe('answered');
    expect(parsed(raw({ ...READY, labels: [{ name: 'decided' }, { name: 'decision' }] }), [labeled(MARK_LOGIN)]).state).toBe('answered');
  });

  it('reads a Decision: comment as the option, then the note: with a dot, with no note, and with other separators', () => {
    const answerOf = (body: string) => parsed(raw({ comments: [comment(MARK_LOGIN, body)] })).answer;
    expect(answerOf('Decision: C. Sort by price.')).toMatchObject({ option: 'C', note: 'Sort by price.' });
    expect(answerOf('Decision: C')).toMatchObject({ option: 'C', note: null });
    expect(answerOf('Decision: C.')).toMatchObject({ option: 'C', note: null });
    expect(answerOf('Decision:C. No space after the colon.')).toMatchObject({ option: 'C', note: 'No space after the colon.' });
    expect(answerOf('Decision: C: with a colon')).toMatchObject({ option: 'C', note: 'with a colon' });
    expect(answerOf('Decision: C - with a dash')).toMatchObject({ option: 'C', note: 'with a dash' });
    expect(answerOf('Decision: C. A note\nof two lines.\n\nAnd a paragraph.')).toMatchObject({ option: 'C', note: 'A note\nof two lines.\n\nAnd a paragraph.' });
    expect(answerOf('Decision: 12. A number.')).toMatchObject({ option: '12' });
    // A comment that was typed on the web has Windows line ends: the note is the same note with plain ones, so that a retry finds that it is already posted.
    expect(answerOf('Decision: C. Line one.\r\nLine two.')).toMatchObject({ option: 'C', note: 'Line one.\nLine two.' });
    // An option and then words with no mark between them is an answer, and the words are the note.
    expect(answerOf('Decision: C is the one')).toMatchObject({ option: 'C', note: 'is the one' });
    // Not an answer: another case, other words first, a blank first, no option, and a comment that only mentions a decision.
    for (const body of ['decision: C', 'DECISION: C', 'I decided: C', ' Decision: C', '\nDecision: C', 'Decision: ', 'Decision:', 'Decision: .', 'Recorded in https://example.com/pr/1']) {
      expect(answerOf(body), JSON.stringify(body)).toBeNull();
    }
  });

  it('writes a comment that it reads back: the option, a dot and the note, and only the option when there is no note', () => {
    expect(answerComment('B', 'Because.')).toBe('Decision: B. Because.');
    expect(answerComment('B', null)).toBe('Decision: B');
    for (const note of ['Because.', 'A note\nof two lines.', '. Starts with a dot', 'Decision: A. is text', 'x'.repeat(2000)]) {
      expect(parsed(raw({ comments: [comment(MARK_LOGIN, answerComment('B', note))] })).answer).toMatchObject({ option: 'B', note });
    }
    expect(parsed(raw({ comments: [comment(MARK_LOGIN, answerComment('B', null))] })).answer).toMatchObject({ option: 'B', note: null });
  });

  it('puts the pages of a paginated list of events into one list', () => {
    const one = labeled(MARK_LOGIN);
    const two = labeled('fixture-collaborator');
    expect(flattenEventPages([[one], [two]])).toEqual([one, two]); // gh api --paginate --slurp
    expect(flattenEventPages([one, two])).toEqual([one, two]); // one page, as a plain list
    expect(flattenEventPages([])).toEqual([]);
    expect(flattenEventPages([[one], two])).toEqual([one, two]);
    expect(() => flattenEventPages({ message: 'Not Found' })).toThrow(/events/);
    expect(() => flattenEventPages('x')).toThrow(/events/);
  });
});

describe('parseDecisionIssue: a body that is not a decision', () => {
  it('a body outside the template gives the issue with a problem, not null', () => {
    // The own body of an agent (fixture 46): free text, none of the headings.
    const { issue, events } = splitFixture(UNREADABLE);
    const decision = parsed(issue, events);
    expect(decision).toEqual({
      number: 46,
      title: 'Decision: The shop list',
      url: 'https://github.com/fixture-owner/fixture-repo/issues/46',
      state: 'open',
      question: '',
      context: null,
      options: [],
      recommended: null,
      docs: [],
      raisedBy: null,
      waitsOn: null,
      createdAt: '2026-10-05T14:00:00Z',
      answer: null,
      problem: expect.stringMatching(/does not follow the decision template/),
    });
    // It is an issue of Mark's all the same: it is listed, and he can open it on GitHub.
    expect(decision.problem).toMatch(/GitHub/);
  });

  it('an empty body, a body that is not text, and a body with another heading style give an issue with a problem, never a crash', () => {
    for (const body of ['', '   \n  ', null, undefined, 42, { text: 'x' }, ['## Question'], '# Question\n\nWhich?\n\n# Options\n\n- A: One.', 'Question: Which?\nOptions: A, B']) {
      const decision = parsed(raw({ body }));
      expect(decision, JSON.stringify(body)).toMatchObject({ number: 7, question: '', options: [] });
      expect(decision.problem, JSON.stringify(body)).not.toBeNull();
    }
  });

  it('a body with a question and no options keeps the question and says what is missing', () => {
    const decision = withBody('## Question\n\nWhich way?\n\n## Context\n\nSome words.\n');
    expect(decision).toMatchObject({ question: 'Which way?', context: 'Some words.', options: [], recommended: null });
    expect(decision.problem).toMatch(/no options/);
  });

  it('a body with options and no question says so, and keeps the options', () => {
    const decision = withBody('## Options\n\n- A: One.\n- B: Two.\n');
    expect(decision).toMatchObject({ question: '', options: [{ id: 'A', text: 'One.' }, { id: 'B', text: 'Two.' }] });
    expect(decision.problem).toMatch(/no question/);
  });

  it('an unedited template body gives an issue with a problem, never a crash', () => {
    // The body that GitHub makes from the template: the words after the front matter of .github/ISSUE_TEMPLATE/decision.md, as they are.
    const template = readFileSync(join(REPO_DIR, '.github', 'ISSUE_TEMPLATE', 'decision.md'), 'utf8').replace(/\r\n/g, '\n');
    const body = template.replace(/^---\n[\s\S]*?\n---\n/, '');
    expect(body).toContain('## Question');
    const decision = parsed(raw({ body }));
    expect(decision).toMatchObject({ question: '', options: [], recommended: null, docs: [], context: null, raisedBy: null, waitsOn: null, answer: null, state: 'open' });
    expect(decision.problem).toMatch(/unedited/i);

    // The placeholder lines alone, as the carry-over notes name them: an option with no words, and the link "path#heading".
    const bare = parsed(raw({ body: '## Question\n\nWhat?\n\n## Options\n\n- A:\n- B:\n\n## Docs\n\n- path#heading\n' }));
    expect(bare).toMatchObject({ question: 'What?', options: [], docs: [] });
    expect(bare.problem).toMatch(/no options/);
  });
});

describe('parseDecisionIssue: issue text is text', () => {
  it('issue text is plain text (a script tag shows as text)', () => {
    // Fixture 47: markup in the title, the question, the context and an option. The parser returns the characters as they are, and builds no html:
    // the page puts them into the page as text (React escapes them), and the page test checks that no script runs.
    const { issue, events } = fixture(47);
    const decision = parsed(issue, events);
    expect(decision.title).toBe('Decision: <b>Bold</b> or plain?');
    expect(decision.question).toBe('Should the shop show <script>window.__pwned = true</script> as text, and **not** as bold?');
    expect(decision.context).toContain('<img src=x onerror="window.__pwned = true">');
    expect(decision.options[1]?.text).toBe('Strip the tags. <i>Not chosen.</i>');
    // A note in an answer is text too.
    expect(parsed(raw({ comments: [comment(MARK_LOGIN, 'Decision: A. <script>alert(1)</script>')] })).answer?.note).toBe('<script>alert(1)</script>');
  });

  it('keeps an address only when it is an http or https address, so an issue cannot put a script into a link', () => {
    expect(parsed(raw({ url: 'javascript:alert(1)' })).url).toBe('');
    expect(parsed(raw({ url: 'data:text/html,<script>' })).url).toBe('');
    expect(parsed(raw({ url: 42 })).url).toBe('');
    expect(parsed(raw({ url: 'https://github.com/o/r/issues/7' })).url).toBe('https://github.com/o/r/issues/7');
  });
});

describe('parseDecisionIssue: output that gh could print in another shape', () => {
  it('is null, and never throws, for what is not an issue', () => {
    for (const value of [null, undefined, 'text', 42, [], [raw()], {}, { number: 'x' }, { number: 0 }, { number: -1 }, { number: 1.5 }, raw({ number: '7' })]) {
      expect(parseDecisionIssue(value, []), JSON.stringify(value)).toBeNull();
    }
  });

  it('shows what is missing as empty and never throws for a field that is not what it should be', () => {
    const decision = parsed(raw({ title: 7, url: undefined, createdAt: null, comments: 'none', state: undefined }), 'not events');
    expect(decision).toMatchObject({ title: '', url: '', createdAt: '', state: 'open', answer: null });
    // Comments that are not comments, and events that are not events.
    const odd = parsed(raw({ comments: [null, 'x', {}, { author: null, body: 'Decision: A' }, { author: { login: MARK_LOGIN }, body: 7 }, comment(MARK_LOGIN, 'Decision: A. Fine.', 'not a time')] }), [null, 'x', {}, { event: 'labeled' }, { event: 'labeled', label: 'decided' }]);
    expect(odd.answer).toEqual({ option: 'A', note: 'Fine.', at: 'not a time', complete: false });
  });

  it('tells what is done of an answer: the comment, the labels and the close, for the retry', () => {
    const progress = (issue: Json, events: Json[] = []) => readDecisionIssue(issue, events)?.progress;
    // Nothing is done.
    expect(progress(raw())).toEqual({ comment: null, labelsSwapped: false, closed: false });
    // The comment is done.
    expect(progress(raw({ comments: [comment(MARK_LOGIN, 'Decision: B. Because.')] }))).toEqual({ comment: { option: 'B', note: 'Because.' }, labelsSwapped: false, closed: false });
    // The comment and the swap are done: the label is on, Mark put it on, and the label decision is off.
    expect(progress(raw({ labels: [{ name: 'decided' }], comments: [comment(MARK_LOGIN, 'Decision: B.')] }), [labeled(MARK_LOGIN)])).toEqual({ comment: { option: 'B', note: null }, labelsSwapped: true, closed: false });
    // Both labels on the issue: the swap is not finished (the label decision is still on).
    expect(progress(raw({ labels: [{ name: 'decided' }, { name: 'decision' }] }), [labeled(MARK_LOGIN)])).toMatchObject({ labelsSwapped: false });
    // The label decided is on, but another account put it on: not done, it must be set again by Mark.
    expect(progress(raw({ labels: [{ name: 'decided' }] }), [labeled('fixture-collaborator')])).toMatchObject({ labelsSwapped: false });
    // Closed.
    expect(progress(raw({ state: 'CLOSED' }))).toMatchObject({ closed: true });
    expect(readDecisionIssue(raw({ author: { login: 'x' } }), [])).toBeNull();
  });

  it('a pull request is not a decision: gh issue view also opens pull requests, and the address says which one it is', () => {
    // `gh issue view <n>` opens a pull request as well as an issue, so the answer route would otherwise comment on, relabel and close a pull request of Mark's that carried the label.
    const pull = 'https://github.com/o/r/pull/7';
    expect(parseDecisionIssue(raw({ url: pull }), [])).toBeNull();
    expect(readDecisionIssue(raw({ url: pull }), [])).toBeNull();
    // Nothing makes it a decision: not the state of a merged pull request, not the label decided, not a comment of Mark's that looks like an answer.
    expect(parseDecisionIssue(raw({ url: pull, state: 'MERGED', labels: [{ name: 'decided' }], comments: [comment(MARK_LOGIN, 'Decision: A.')] }), [labeled(MARK_LOGIN)])).toBeNull();
    expect(parseDecisionIssue(raw({ url: `${pull}#issuecomment-1` }), [])).toBeNull();
    expect(parseDecisionIssue(raw({ url: `${pull}/files` }), [])).toBeNull();
    // An issue is one. So is an address that is not there or is not an address (the page makes its own link then), and an address in which the words "pull" and a number are
    // the owner or the name of the repository and not the kind of the thing.
    for (const url of ['https://github.com/o/r/issues/7', '', undefined, 42, 'not an address', 'https://github.com/o/pull/issues/7', 'https://github.com/pull/123/issues/7']) {
      expect(parseDecisionIssue(raw({ url }), []), String(url)).not.toBeNull();
    }
  });
});

describe('parseDecisionIssue: hostile input', () => {
  /** How long the parser takes to read a body of an issue of Mark's, in milliseconds. */
  function millisFor(body: string): number {
    const started = performance.now();
    parseDecisionIssue(raw({ body }), []);
    return performance.now() - started;
  }

  // The body of an issue is what a person or an agent wrote through Mark's login, and the parser reads it again every 60 seconds, so no body may make it slow. GitHub keeps up to
  // 65,536 characters. The first heading pattern had cubic run time: a line with 3,000 spaces and then a letter took 2.7 seconds, 4,000 took 6.4 seconds, and 20,000 would have blocked the server for minutes.
  const LONG = 20_000;

  it('a heading line with 20,000 spaces and then a letter parses in under 100 ms, and the issue still reads', () => {
    for (const gap of [' ', '\t', ' \t', '#', ' #', '# ']) {
      expect(millisFor(`## Docs${gap.repeat(LONG / gap.length)}x\n`), JSON.stringify(gap)).toBeLessThan(100);
      expect(millisFor(`##${gap.repeat(LONG / gap.length)}x\n`), `no word, ${JSON.stringify(gap)}`).toBeLessThan(100);
    }
    // The line is a heading that the template does not have: it ends the section before it, and the sections after it are found.
    const decision = withBody(`## Docs${' '.repeat(LONG)}x\n\n## Question\n\nWhich?\n\n## Options\n\n- A: One.\n`);
    expect(decision).toMatchObject({ question: 'Which?', options: [{ id: 'A', text: 'One.' }], problem: null });
  });

  it('a heading with the closing marks of markdown, with spaces and tabs around them, is still the heading', () => {
    const decision = withBody('## Question ##\n\nWhich?\n\n##\tOptions\t##  \n\n- A: One.\n\n## Recommendation:\n\nA: yes.\n');
    expect(decision).toMatchObject({ question: 'Which?', options: [{ id: 'A', text: 'One.' }], recommended: 'A' });
  });

  it('hostile lines of every shape that the parser reads, in every place that it reads, stay fast', () => {
    const SIZE = 60_000;
    const shapes: Record<string, string> = {
      'spaces and a letter': `${' '.repeat(SIZE)}x`,
      'tabs and a letter': `${'\t'.repeat(SIZE)}x`,
      'hash marks': '#'.repeat(SIZE),
      'hash and space, again and again': '# '.repeat(SIZE / 2),
      'open brackets': '['.repeat(SIZE),
      'a link that never ends': `[a](${'x'.repeat(SIZE)}`,
      'a link with spaces': `[a](${' '.repeat(SIZE)}x`,
      'backticks': '`'.repeat(SIZE),
      'backtick and letter, again and again': '`a'.repeat(SIZE / 2),
      'stars': '*'.repeat(SIZE),
      'dash and space, again and again': '- '.repeat(SIZE / 2),
      'digits': '1'.repeat(SIZE),
      'angle brackets': '<'.repeat(SIZE),
      'open parentheses': '('.repeat(SIZE),
      'colons': ':'.repeat(SIZE),
      'an option mark, then spaces and a letter': `A:${' '.repeat(SIZE)}x`,
      'carriage returns': '\r'.repeat(SIZE),
    };
    const places: Record<string, (line: string) => string> = {
      'a heading': (line) => `## ${line}\n`,
      'a heading with no space after the marks': (line) => `##${line}\n`,
      'a doc link': (line) => `## Docs\n\n- ${line}\n`,
      'a line of the docs that is no list item': (line) => `## Docs\n\n${line}\n`,
      'an option': (line) => `## Question\n\nQ?\n\n## Options\n\n- A: ${line}\n- B: Two.\n`,
      'a line of the options that is no option': (line) => `## Question\n\nQ?\n\n## Options\n\n${line}\n- A: One.\n`,
      'a recommendation': (line) => `## Question\n\nQ?\n\n## Options\n\n- A: One.\n\n## Recommendation\n\n${line}\n`,
      'the question': (line) => `## Question\n\n${line}\n\n## Options\n\n- A: One.\n`,
      'text outside any section': (line) => `${line}\n`,
    };
    const slow: string[] = [];
    for (const [place, make] of Object.entries(places)) {
      for (const [shape, line] of Object.entries(shapes)) {
        const ms = millisFor(make(line));
        if (ms >= 100) slow.push(`${Math.round(ms)} ms: ${shape}, in ${place}`);
      }
    }
    expect(slow).toEqual([]);
  });
});
