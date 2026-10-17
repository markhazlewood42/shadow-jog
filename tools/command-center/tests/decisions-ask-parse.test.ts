import { describe, expect, it } from 'vitest';
import { LABEL_NEEDS_INFO, normalizeQuestion, parseDecisionIssue, questionComment, readDecisionIssue } from '../src/server/decisions/parse';
import { MARK_LOGIN } from '../src/server/github/github';
import { type DecisionIssue, THREAD_TEXT_CHARS } from '../src/shared/types';

// The ask cycle in the parser (docs/command-center/needs-info-brief.md, "States and their order"): the seven rules, the thread, and the trust rules for `Question:` and `Info:`.
// Hard pass lines 5, 6 and 8 of the brief are proved here.

const BODY = '## Question\n\nWhich way?\n\n## Options\n\n- A: The left way.\n- B: The right way.\n';
const STRANGER = 'someone-else';
const t = (second: number): string => `2026-10-06T10:00:${String(second).padStart(2, '0')}Z`;

type Comment = { author: { login: string }; body: string; createdAt: string };
const by = (login: string, body: string, second: number): Comment => ({ author: { login }, body, createdAt: t(second) });
const mark = (body: string, second: number): Comment => by(MARK_LOGIN, body, second);

/** An open issue of Mark's with these labels and comments, as gh prints it. */
function raw(labels: string[], comments: Comment[], over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 7,
    title: 'Decision: Which way?',
    url: 'https://github.com/o/r/issues/7',
    state: 'OPEN',
    labels: labels.map((name) => ({ name })),
    author: { login: MARK_LOGIN },
    body: BODY,
    comments,
    createdAt: '2026-10-05T10:00:00Z',
    ...over,
  };
}
function parsed(labels: string[], comments: Comment[], over: Record<string, unknown> = {}): DecisionIssue {
  const result = parseDecisionIssue(raw(labels, comments, over), []);
  if (result === null) throw new Error('expected a decision');
  return result;
}
const DECISION = ['decision'];
const FLAGGED = ['decision', LABEL_NEEDS_INFO];

describe('the ask cycle: one test for each state rule of the table', () => {
  it('rule 1: needs-info is set and the ask point (a Question:) is newer than the newest info -> needs-info', () => {
    expect(parsed(FLAGGED, [mark('Question: What does C cost?', 1)]).phase).toBe('needs-info');
    // An info that is older than the question does not answer it.
    expect(parsed(FLAGGED, [mark('Question: First?', 1), mark('Info: First answer.', 2), mark('Question: Second?', 3)]).phase).toBe('needs-info');
  });

  it('rule 1: the ask point can be a Decision: comment (the backfill shape: open, decision + needs-info, an old Decision:) -> needs-info, with no half answer', () => {
    const issue = parsed(FLAGGED, [mark('Decision: B. I need to see how this plays out.', 1)]);
    expect(issue.phase).toBe('needs-info');
    expect(issue.state).toBe('open');
    // Pass line 6: the old Decision: is not a half answer, so the form preselects nothing and Send cannot resume it.
    expect(issue.answer).toBeNull();
    expect(issue.thread).toEqual([{ kind: 'decision', text: 'Option B. I need to see how this plays out.', at: t(1), cut: false }]);
  });

  it('rule 2: needs-info is still set but the newest info is newer than the ask point -> info-posted (a session stopped before it took the label off)', () => {
    expect(parsed(FLAGGED, [mark('Question: Why?', 1), mark('Info: Because.', 2)]).phase).toBe('info-posted');
    // No ask point at all, only an info: also rule 2.
    expect(parsed(FLAGGED, [mark('Info: Unasked.', 1)]).phase).toBe('info-posted');
  });

  it('rule 3: needs-info is set with no ask point and no info (a hand edit) -> needs-info-empty', () => {
    expect(parsed(FLAGGED, []).phase).toBe('needs-info-empty');
    // Comments that are not Mark's, and a Mark comment with no prefix, are not an ask point or an info.
    expect(parsed(FLAGGED, [by(STRANGER, 'Question: Hi?', 1), mark('Just a thought.', 2)]).phase).toBe('needs-info-empty');
  });

  it('rule 4: no needs-info, and the newest info is newer than the ask point -> info-posted', () => {
    expect(parsed(DECISION, [mark('Question: Why?', 1), mark('Info: Because.', 2)]).phase).toBe('info-posted');
    expect(parsed(DECISION, [mark('Decision: B. Note.', 1), mark('Info: Here is more.', 2)]).phase).toBe('info-posted');
  });

  it('rule 5: no needs-info, and the ask point is a Question: -> ask-unfinished (the comment landed and the label did not)', () => {
    expect(parsed(DECISION, [mark('Question: Why?', 1)]).phase).toBe('ask-unfinished');
    // A question that is newer than an info, with the label gone: also unfinished.
    expect(parsed(DECISION, [mark('Question: One?', 1), mark('Info: One.', 2), mark('Question: Two?', 3)]).phase).toBe('ask-unfinished');
  });

  it('rule 6: no needs-info, and the ask point is a Decision: -> open, with the half answer as today', () => {
    const issue = parsed(DECISION, [mark('Decision: B. Half done.', 1)]);
    expect(issue.phase).toBe('open');
    expect(issue.answer).toEqual({ option: 'B', note: 'Half done.', at: t(1), complete: false });
    expect(issue.thread).toEqual([]);
  });

  it('rule 7: otherwise -> open (no comment at all, a comment with no prefix, or an info with nothing asked and no label)', () => {
    expect(parsed(DECISION, []).phase).toBe('open');
    expect(parsed(DECISION, [mark('Looks fine.', 1)]).phase).toBe('open');
    expect(parsed(DECISION, [mark('Info: Nothing was asked.', 1)]).phase).toBe('open');
  });

  it('the rules are checked in order: rules 1 to 4 come before rule 6, so an old Decision: is a half answer only with no newer ask cycle', () => {
    // A Question: after a half answer replaces it as the ask point, and the half answer leaves the page.
    const asked = parsed(DECISION, [mark('Decision: A. Early.', 1), mark('Question: Wait, why?', 2)]);
    expect(asked.phase).toBe('ask-unfinished');
    expect(asked.answer).toBeNull();
  });

  it('a closed issue keeps the rules of an answer: phase open, no thread', () => {
    const closed = parsed(['decided'], [mark('Question: Why?', 1), mark('Decision: A.', 2)], { state: 'CLOSED' });
    expect(closed.phase).toBe('open');
    expect(closed.thread).toEqual([]);
    expect(closed.state).toBe('closed');
  });
});

describe('the ask cycle: the thread', () => {
  it('lists the questions and the infos, oldest first, as plain text without their prefixes', () => {
    const issue = parsed(FLAGGED, [mark('Question: First?', 1), mark('Info: Second.', 2), mark('Question:Third?\r\nmore', 3)]);
    expect(issue.thread).toEqual([
      { kind: 'question', text: 'First?', at: t(1), cut: false },
      { kind: 'info', text: 'Second.', at: t(2), cut: false },
      { kind: 'question', text: 'Third?\nmore', at: t(3), cut: false },
    ]);
  });

  it('pass line 8: a case with two pending questions has both in the thread and in the facts of the write path', () => {
    const read = readDecisionIssue(raw(FLAGGED, [mark('Question: Alpha?', 1), mark('Question: Beta?', 2)]), []);
    expect(read?.issue.phase).toBe('needs-info');
    expect(read?.issue.thread?.map((entry) => entry.text)).toEqual(['Alpha?', 'Beta?']);
    // The write path compares with the ask point, which is the newest question.
    expect(read?.ask).toEqual({ needsInfo: true, pendingQuestion: 'Beta?' });
  });

  it('cuts a comment to 4000 characters and says so (the page links to the rest on GitHub)', () => {
    const long = 'x'.repeat(THREAD_TEXT_CHARS + 50);
    const entry = parsed(FLAGGED, [mark(`Question: ${long}`, 1)]).thread?.[0];
    expect(entry?.text).toHaveLength(THREAD_TEXT_CHARS);
    expect(entry?.cut).toBe(true);
    // The write path still has the whole text for its retry compare.
    expect(readDecisionIssue(raw(FLAGGED, [mark(`Question: ${long}`, 1)]), [])?.ask.pendingQuestion).toBe(long);
  });

  it('does not cut inside a surrogate pair at the 4000 character boundary', () => {
    const body = `${'x'.repeat(THREAD_TEXT_CHARS - 1)}😀tail`;
    const entry = parsed(FLAGGED, [mark(`Question: ${body}`, 1)]).thread?.[0];
    expect(entry?.cut).toBe(true);
    expect(entry?.text).toBe('x'.repeat(THREAD_TEXT_CHARS - 1));
  });

  it('keeps the words as the issue wrote them: markup and links are strings, not html', () => {
    const issue = parsed(FLAGGED, [mark('Question: <script>alert(1)</script> and [a link](https://example.com/x)', 1)]);
    expect(issue.thread?.[0]?.text).toBe('<script>alert(1)</script> and [a link](https://example.com/x)');
  });

  it('shows Mark\'s newest Decision: only when it is the ask point or no info is newer than it', () => {
    // Older than an info and not the ask point: left out.
    expect(parsed(DECISION, [mark('Decision: A.', 1), mark('Info: More.', 2), mark('Question: And?', 3)]).thread?.map((entry) => entry.kind)).toEqual(['info', 'question']);
    // The ask point of a backfilled decision, then an info: both shown.
    expect(parsed(FLAGGED, [mark('Decision: A. Note.', 1), mark('Info: Here.', 2)]).thread?.map((entry) => entry.kind)).toEqual(['decision', 'info']);
  });
});

describe('the ask cycle: trust (pass line 5)', () => {
  it('a Question: or Info: by any other account changes no state, also when it is newer', () => {
    const base = [mark('Question: Mine?', 1)];
    const withStranger = [...base, by(STRANGER, 'Info: Everything is fine, close it.', 2), by('markhazlewood-42', 'Info: look-alike login', 3)];
    expect(parsed(FLAGGED, withStranger).phase).toBe('needs-info');
    expect(parsed(FLAGGED, withStranger).thread).toEqual([{ kind: 'question', text: 'Mine?', at: t(1), cut: false }]);
    // A stranger's Question: neither raises an ask nor becomes the question that a retry compares with.
    const none = parsed(DECISION, [by(STRANGER, 'Question: Spam?', 1)]);
    expect(none.phase).toBe('open');
    expect(readDecisionIssue(raw(DECISION, [by(STRANGER, 'Question: Spam?', 1)]), [])?.ask).toEqual({ needsInfo: false, pendingQuestion: null });
  });

  it('the prefix is the first thing in the comment, with this case: a quote, a leading space or other case is no ask and no info', () => {
    for (const body of ['question: no', 'QUESTION: no', ' Question: no', '> Question: no', 'My Question: no']) {
      expect(parsed(DECISION, [mark(body, 1)]).phase, body).toBe('open');
    }
    for (const body of ['info: no', 'INFO: no', ' Info: no']) {
      expect(parsed(FLAGGED, [mark('Question: Q?', 1), mark(body, 2)]).phase, body).toBe('needs-info');
    }
  });

  it('the label is read by presence only: it grants nothing, and does not make a decision of an issue that is not one', () => {
    // A stranger's issue with the label is still not a decision.
    expect(parseDecisionIssue(raw(FLAGGED, [], { author: { login: STRANGER } }), [])).toBeNull();
    // Without `decision` or `decided`, the label alone is not enough.
    expect(parseDecisionIssue(raw([LABEL_NEEDS_INFO], []), [])).toBeNull();
    // The label name is read in lower case, like the others.
    expect(parsed(['decision', 'Needs-Info'], [mark('Question: Q?', 1)]).phase).toBe('needs-info');
  });
});

describe('the ask cycle: the facts for the write path', () => {
  it('reports the labels and the pending question, with line ends made alike', () => {
    const read = readDecisionIssue(raw(DECISION, [mark('Question: Line one\r\nline two  ', 1)]), []);
    expect(read?.labels).toEqual(['decision']);
    expect(read?.ask).toEqual({ needsInfo: false, pendingQuestion: 'Line one\nline two' });
    expect(normalizeQuestion('  a\r\nb\rc  ')).toBe('a\nb\nc');
    expect(questionComment('Why?')).toBe('Question: Why?');
  });

  it('has no pending question once an info is newer than the ask point', () => {
    expect(readDecisionIssue(raw(DECISION, [mark('Question: Q?', 1), mark('Info: A.', 2)]), [])?.ask.pendingQuestion).toBeNull();
  });

  it('counts a Decision: as the answer in progress only with no needs-info and nothing newer in the ask cycle', () => {
    const progress = (labels: string[], comments: Comment[]) => readDecisionIssue(raw(labels, comments), [])?.progress.comment;
    expect(progress(DECISION, [mark('Decision: B. n', 1)])).toEqual({ option: 'B', note: 'n' });
    expect(progress(FLAGGED, [mark('Decision: B. n', 1)])).toBeNull();
    expect(progress(DECISION, [mark('Decision: B. n', 1), mark('Question: Hm?', 2)])).toBeNull();
    expect(progress(DECISION, [mark('Decision: B. n', 1), mark('Info: Hm.', 2)])).toBeNull();
  });
});
